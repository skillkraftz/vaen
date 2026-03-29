import type { createClient } from "./supabase/server";
import type {
  ContinuationRequest,
  ContinuationRequestStatus,
  ContinuationRequestType,
} from "./types";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

/* ── Create ─────────────────────────────────────────────────────── */

export async function createContinuationRequest(
  supabase: PortalSupabase,
  params: {
    prospectId: string;
    projectId: string;
    campaignId?: string | null;
    userId: string;
    requestType: ContinuationRequestType;
    context?: Record<string, unknown>;
  },
): Promise<{ id: string } | { error: string }> {
  // Avoid duplicates: only one pending request per prospect + type
  const { data: existing } = await supabase
    .from("continuation_requests")
    .select("id")
    .eq("prospect_id", params.prospectId)
    .eq("request_type", params.requestType)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    return { id: existing.id };
  }

  const { data, error } = await supabase
    .from("continuation_requests")
    .insert({
      prospect_id: params.prospectId,
      project_id: params.projectId,
      campaign_id: params.campaignId ?? null,
      user_id: params.userId,
      request_type: params.requestType,
      context: params.context ?? {},
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Failed to create continuation request." };
  }

  return { id: data.id };
}

/* ── Resolve ────────────────────────────────────────────────────── */

export async function resolveContinuationRequest(
  supabase: PortalSupabase,
  params: {
    requestId: string;
    status: ContinuationRequestStatus;
    resolvedBy: string;
    resolutionNote?: string | null;
  },
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("continuation_requests")
    .update({
      status: params.status,
      resolved_at: new Date().toISOString(),
      resolved_by: params.resolvedBy,
      resolution_note: params.resolutionNote ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.requestId)
    .eq("status", "pending");

  if (error) {
    return { error: error.message };
  }
  return {};
}

/* ── Query ──────────────────────────────────────────────────────── */

export async function listContinuationRequests(
  supabase: PortalSupabase,
  options?: {
    prospectId?: string;
    projectId?: string;
    campaignId?: string;
    status?: ContinuationRequestStatus;
    limit?: number;
  },
): Promise<ContinuationRequest[]> {
  let query = supabase
    .from("continuation_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (options?.prospectId) query = query.eq("prospect_id", options.prospectId);
  if (options?.projectId) query = query.eq("project_id", options.projectId);
  if (options?.campaignId) query = query.eq("campaign_id", options.campaignId);
  if (options?.status) query = query.eq("status", options.status);
  if (options?.limit) query = query.limit(options.limit);

  const { data } = await query;
  return (data ?? []) as ContinuationRequest[];
}

/* ── Eligibility check ──────────────────────────────────────────── */

export function isContinuationEligible(
  projectStatus: string,
  requestType: ContinuationRequestType,
): boolean {
  if (requestType === "pending_review") {
    // Review can proceed when the project has finished generating
    return projectStatus === "workspace_generated" || projectStatus === "review_ready";
  }
  return false;
}

export function getContinuationBlockedReason(
  projectStatus: string,
  requestType: ContinuationRequestType,
): string | null {
  if (requestType === "pending_review") {
    if (projectStatus === "build_in_progress") {
      return "Generation is still in progress.";
    }
    if (projectStatus === "build_failed") {
      return "Generation failed. Fix the build before continuing to review.";
    }
  }
  return null;
}
