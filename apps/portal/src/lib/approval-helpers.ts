import "server-only";

import { revalidatePath } from "next/cache";
import { createClient } from "./supabase/server";
import type {
  ApprovalRequest,
  ApprovalRequestType,
  ApprovalStatus,
  Project,
  Quote,
  QuoteLine,
} from "./types";
import { calculateQuoteTotals } from "./quote-helpers";
import {
  canResolveApproval,
  getApprovalEffectiveStatus,
  getApprovalExpiryDate,
} from "./approval-model";
import { purgeProjectResources } from "@/app/dashboard/projects/[id]/project-lifecycle-helpers";
import { recalculateQuote } from "@/app/dashboard/projects/[id]/project-quote-helpers";
import { sendProspectOutreachAction } from "@/app/dashboard/prospects/actions";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function sortedIds(ids: string[]) {
  return [...new Set(ids)].sort();
}

function sameStringArray(left: string[], right: string[]) {
  return JSON.stringify(sortedIds(left)) === JSON.stringify(sortedIds(right));
}

function approvalContextMatches(
  requestType: ApprovalRequestType,
  existingContext: Record<string, unknown>,
  nextContext: Record<string, unknown>,
) {
  if (requestType === "large_discount") {
    return asString(existingContext.quote_id) === asString(nextContext.quote_id)
      && asNumber(existingContext.discount_cents) === asNumber(nextContext.discount_cents)
      && asNumber(existingContext.discount_percent) === asNumber(nextContext.discount_percent)
      && asString(existingContext.reason) === asString(nextContext.reason);
  }

  if (requestType === "batch_outreach") {
    return asString(existingContext.campaign_id) === asString(nextContext.campaign_id)
      && sameStringArray(asStringArray(existingContext.prospect_ids), asStringArray(nextContext.prospect_ids));
  }

  return asString(existingContext.project_id) === asString(nextContext.project_id)
    && asString(existingContext.project_slug) === asString(nextContext.project_slug);
}

async function countAdmins(supabase: PortalSupabase) {
  const { count } = await supabase
    .from("user_roles")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "admin");

  return count ?? 0;
}

export async function expirePendingApprovalRequests(supabase: PortalSupabase) {
  const now = new Date().toISOString();
  await supabase
    .from("approval_requests")
    .update({
      status: "expired",
      resolved_at: now,
      resolution_note: "Expired after 72 hours.",
    })
    .eq("status", "pending")
    .lt("expires_at", now);
}

export async function listVisibleApprovalRequests(
  supabase: PortalSupabase,
  options?: {
    statuses?: ApprovalStatus[];
    limit?: number;
    requestType?: ApprovalRequestType;
  },
) {
  await expirePendingApprovalRequests(supabase);

  let query = supabase
    .from("approval_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 100);

  if (options?.requestType) {
    query = query.eq("request_type", options.requestType);
  }
  if (options?.statuses?.length === 1) {
    query = query.eq("status", options.statuses[0]);
  } else if (options?.statuses && options.statuses.length > 1) {
    query = query.in("status", options.statuses);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ApprovalRequest[];
}

export async function createApprovalRequestRecord(
  supabase: PortalSupabase,
  params: {
    requestType: ApprovalRequestType;
    requestedBy: string;
    context: Record<string, unknown>;
  },
) {
  await expirePendingApprovalRequests(supabase);

  const pending = await listVisibleApprovalRequests(supabase, {
    statuses: ["pending"],
    requestType: params.requestType,
    limit: 50,
  });

  const existing = pending.find((item) =>
    item.requested_by === params.requestedBy
    && approvalContextMatches(params.requestType, item.context, params.context),
  );

  if (existing) {
    return { request: existing, created: false };
  }

  const expiresAt = getApprovalExpiryDate().toISOString();
  const { data, error } = await supabase
    .from("approval_requests")
    .insert({
      request_type: params.requestType,
      requested_by: params.requestedBy,
      context: params.context,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create approval request.");
  }

  return { request: data as ApprovalRequest, created: true };
}

async function executeLargeDiscountApproval(
  supabase: PortalSupabase,
  request: ApprovalRequest,
  resolverId: string,
) {
  const quoteId = asString(request.context.quote_id);
  const reason = asString(request.context.reason);
  const expectedSubtotal = asNumber(request.context.subtotal_cents);
  const discountPercent = asNumber(request.context.discount_percent);
  const discountCents = asNumber(request.context.discount_cents);

  if (!quoteId) {
    return { ok: false as const, stale: true, message: "Approval context is missing quote_id." };
  }

  const [{ data: quote }, { data: lines }] = await Promise.all([
    supabase.from("quotes").select("*").eq("id", quoteId).single(),
    supabase.from("quote_lines").select("*").eq("quote_id", quoteId).order("sort_order", { ascending: true }),
  ]);

  if (!quote) {
    return { ok: false as const, stale: true, message: "Quote no longer exists." };
  }

  const quoteRow = quote as Quote;
  if (quoteRow.status !== "draft") {
    return { ok: false as const, stale: true, message: "Quote is no longer in draft status." };
  }

  const currentSubtotal = calculateQuoteTotals({
    lines: (lines ?? []) as QuoteLine[],
    discountCents: 0,
  }).setupSubtotalCents;

  if (expectedSubtotal != null && currentSubtotal !== expectedSubtotal) {
    return { ok: false as const, stale: true, message: "Quote subtotal changed after approval was requested." };
  }

  await recalculateQuote(
    supabase,
    quoteId,
    {
      discountPercent,
      discountCents,
      reason,
    },
    {
      role: "admin",
      approvalGranted: true,
      discountApprovedBy: resolverId,
    },
  );

  await supabase.from("project_events").insert({
    project_id: quoteRow.project_id,
    event_type: "quote_discount_approved",
    metadata: {
      quote_id: quoteId,
      discount_cents: discountCents,
      discount_percent: discountPercent,
      reason,
      approved_by: resolverId,
      approval_request_id: request.id,
    },
  });

  revalidatePath(`/dashboard/projects/${quoteRow.project_id}`);
  return {
    ok: true as const,
    summary: {
      quote_id: quoteId,
      project_id: quoteRow.project_id,
      discount_percent: discountPercent,
      discount_cents: discountCents,
    },
  };
}

async function executeBatchOutreachApproval(
  supabase: PortalSupabase,
  request: ApprovalRequest,
) {
  const prospectIds = sortedIds(asStringArray(request.context.prospect_ids));
  const campaignId = asString(request.context.campaign_id);
  if (prospectIds.length === 0) {
    return { ok: false as const, stale: true, message: "Approval context is missing prospect_ids." };
  }

  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, campaign_id")
    .in("id", prospectIds);

  const currentProspects = prospects ?? [];
  if (currentProspects.length !== prospectIds.length) {
    return { ok: false as const, stale: true, message: "One or more selected prospects no longer exist." };
  }

  if (campaignId && currentProspects.some((prospect) => prospect.campaign_id !== campaignId)) {
    return { ok: false as const, stale: true, message: "Selected prospects no longer match the original campaign selection." };
  }

  const results: Array<{ prospectId: string; status: "sent" | "blocked" | "failed"; message: string }> = [];

  for (const prospectId of prospectIds) {
    const send = await sendProspectOutreachAction(prospectId, { confirm: true });
    let status: "sent" | "blocked" | "failed" = "sent";
    let message = send.error ?? "Outreach sent.";

    if (send.sendId) {
      const { data: sendRow } = await supabase
        .from("outreach_sends")
        .select("status, error_message")
        .eq("id", send.sendId)
        .single();

      if (sendRow) {
        status = sendRow.status as "sent" | "blocked" | "failed";
        message = sendRow.error_message ?? message;
      } else if (send.error) {
        status = "failed";
      }
    } else if (send.error) {
      status = "failed";
    }

    results.push({ prospectId, status, message });
  }

  if (campaignId) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("metadata")
      .eq("id", campaignId)
      .single();
    await supabase
      .from("campaigns")
      .update({
        last_activity_at: new Date().toISOString(),
        metadata: {
          ...(((campaign?.metadata ?? {}) as Record<string, unknown>)),
          last_approved_batch_send_at: new Date().toISOString(),
        },
      })
      .eq("id", campaignId);
    revalidatePath(`/dashboard/campaigns/${campaignId}`);
  }

  revalidatePath("/dashboard/prospects");
  revalidatePath("/dashboard/campaigns");

  return {
    ok: true as const,
    summary: {
      sent: results.filter((result) => result.status === "sent").length,
      blocked: results.filter((result) => result.status === "blocked").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    },
  };
}

async function executeProjectPurgeApproval(
  supabase: PortalSupabase,
  request: ApprovalRequest,
  resolverId: string,
) {
  const projectId = asString(request.context.project_id);
  const projectSlug = asString(request.context.project_slug);

  if (!projectId || !projectSlug) {
    return { ok: false as const, stale: true, message: "Approval context is missing project information." };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) {
    return { ok: false as const, stale: true, message: "Project no longer exists." };
  }

  const record = project as Project;
  if (record.slug !== projectSlug) {
    return { ok: false as const, stale: true, message: "Project slug changed after the purge request was created." };
  }

  await purgeProjectResources(supabase, resolverId, record);
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) {
    return { ok: false as const, stale: false, message: error.message };
  }

  revalidatePath("/dashboard");
  return {
    ok: true as const,
    summary: {
      project_id: projectId,
      project_slug: projectSlug,
    },
  };
}

export async function resolveApprovalRequestRecord(
  supabase: PortalSupabase,
  params: {
    requestId: string;
    decision: "approved" | "rejected";
    resolverId: string;
    resolutionNote?: string | null;
  },
) {
  await expirePendingApprovalRequests(supabase);

  const { data, error } = await supabase
    .from("approval_requests")
    .select("*")
    .eq("id", params.requestId)
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Approval request not found." };
  }

  const request = data as ApprovalRequest;
  const effectiveStatus = getApprovalEffectiveStatus(request);
  if (effectiveStatus === "expired") {
    await supabase
      .from("approval_requests")
      .update({
        status: "expired",
        resolved_at: new Date().toISOString(),
        resolution_note: request.resolution_note ?? "Expired after 72 hours.",
      })
      .eq("id", request.id);
    return { error: "Approval request has expired.", request: { ...request, status: "expired" as const } };
  }

  if (effectiveStatus !== "pending") {
    return { error: `Approval request is already ${effectiveStatus}.`, request: { ...request, status: effectiveStatus } };
  }

  const adminCount = await countAdmins(supabase);
  const selfApproval = canResolveApproval({
    requestedBy: request.requested_by,
    resolverId: params.resolverId,
    adminCount,
  });

  if (!selfApproval.allowed) {
    return { error: "Self-approval is blocked when more than one admin exists." };
  }

  if (params.decision === "rejected") {
    const resolutionNote = [params.resolutionNote?.trim(), selfApproval.soleAdminFallback ? "Self-approved (sole admin) fallback not used; request rejected." : null]
      .filter(Boolean)
      .join(" ");

    const { data: rejected, error: rejectError } = await supabase
      .from("approval_requests")
      .update({
        status: "rejected",
        resolved_by: params.resolverId,
        resolved_at: new Date().toISOString(),
        resolution_note: resolutionNote || null,
      })
      .eq("id", request.id)
      .select("*")
      .single();

    if (rejectError || !rejected) {
      return { error: rejectError?.message ?? "Failed to reject approval request." };
    }
    return { request: rejected as ApprovalRequest };
  }

  let execution:
    | { ok: true; summary: Record<string, unknown> }
    | { ok: false; stale: boolean; message: string };

  if (request.request_type === "large_discount") {
    execution = await executeLargeDiscountApproval(supabase, request, params.resolverId);
  } else if (request.request_type === "batch_outreach") {
    execution = await executeBatchOutreachApproval(supabase, request);
  } else {
    execution = await executeProjectPurgeApproval(supabase, request, params.resolverId);
  }

  if (!execution.ok) {
    const failureStatus: ApprovalStatus = execution.stale ? "rejected" : "rejected";
    const resolutionNote = [
      params.resolutionNote?.trim(),
      execution.stale ? `Stale approval context: ${execution.message}` : execution.message,
      selfApproval.soleAdminFallback ? "Self-approved (sole admin)." : null,
    ].filter(Boolean).join(" ");

    const { data: rejected, error: rejectError } = await supabase
      .from("approval_requests")
      .update({
        status: failureStatus,
        resolved_by: params.resolverId,
        resolved_at: new Date().toISOString(),
        resolution_note: resolutionNote,
      })
      .eq("id", request.id)
      .select("*")
      .single();

    if (rejectError || !rejected) {
      return { error: rejectError?.message ?? execution.message };
    }

    return {
      error: execution.message,
      request: rejected as ApprovalRequest,
      stale: execution.stale,
    };
  }

  const approvalContext = {
    ...(request.context ?? {}),
    execution_result: execution.summary,
  };
  const resolutionNote = [
    params.resolutionNote?.trim(),
    selfApproval.soleAdminFallback ? "Self-approved (sole admin)." : null,
  ].filter(Boolean).join(" ");

  const { data: approved, error: approveError } = await supabase
    .from("approval_requests")
    .update({
      status: "approved",
      resolved_by: params.resolverId,
      resolved_at: new Date().toISOString(),
      resolution_note: resolutionNote || null,
      context: approvalContext,
    })
    .eq("id", request.id)
    .select("*")
    .single();

  if (approveError || !approved) {
    return { error: approveError?.message ?? "Failed to approve request." };
  }

  return {
    request: approved as ApprovalRequest,
    execution: execution.summary,
  };
}
