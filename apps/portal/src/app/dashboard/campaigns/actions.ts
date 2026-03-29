"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CAMPAIGN_STATUSES, previewProspectImportRows } from "@/lib/prospect-campaigns";
import { requireRole } from "@/lib/user-role-server";
import { createApprovalRequestRecord } from "@/lib/approval-helpers";
import {
  canRemoveCampaignStep,
  getLockedCampaignStepCounts,
  normalizeCampaignSequenceStepInput,
  sortCampaignSequenceSteps,
  validateCampaignSequenceSteps,
  type CampaignSequenceStepInput,
} from "@/lib/campaign-sequences";
import type { Campaign, CampaignSequenceStep, OutreachSend, Prospect } from "@/lib/types";
import {
  analyzeProspectAction,
  continueProspectAutomationAction,
  convertProspectAction,
  generateOutreachPackageAction,
  sendProspectOutreachAction,
} from "../prospects/actions";
import type { ProspectAutomationLevel } from "@/lib/types";

async function requireCampaignOwner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
  userId: string,
) {
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .single();

  return data as Campaign | null;
}

async function getCampaignProspects(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
) {
  const { data } = await supabase
    .from("prospects")
    .select("id, metadata")
    .eq("campaign_id", campaignId);

  return (data ?? []) as Array<Pick<Prospect, "id" | "metadata">>;
}

async function getSequenceLockCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
) {
  const prospects = await getCampaignProspects(supabase, campaignId);
  return getLockedCampaignStepCounts(prospects);
}

async function touchCampaign(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
  metadataUpdates?: Record<string, unknown>,
) {
  if (!campaignId) return;
  const { data: existing } = await supabase
    .from("campaigns")
    .select("metadata")
    .eq("id", campaignId)
    .single();

  await supabase
    .from("campaigns")
    .update({
      last_activity_at: new Date().toISOString(),
      metadata: {
        ...(((existing?.metadata ?? {}) as Record<string, unknown>)),
        ...(metadataUpdates ?? {}),
      },
    })
    .eq("id", campaignId);
}

export async function createCampaignAction(input: {
  name: string;
  description?: string | null;
  status?: Campaign["status"];
}): Promise<{ error?: string; campaignId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const name = input.name.trim();
  if (!name) return { error: "Campaign name is required." };

  const status = input.status && CAMPAIGN_STATUSES.includes(input.status)
    ? input.status
    : "draft";

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      name,
      description: input.description?.trim() || null,
      status,
      metadata: {},
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Failed to create campaign." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath("/dashboard/campaigns");
  return { campaignId: data.id };
}

export async function updateCampaignStatusAction(
  campaignId: string,
  status: Campaign["status"],
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!CAMPAIGN_STATUSES.includes(status)) return { error: "Invalid campaign status." };

  const campaign = await requireCampaignOwner(supabase, campaignId, user.id);
  if (!campaign) return { error: "Campaign not found." };

  const { error } = await supabase
    .from("campaigns")
    .update({
      status,
      last_activity_at: new Date().toISOString(),
      metadata: {
        ...(campaign.metadata ?? {}),
        last_status_change_to: status,
      },
    })
    .eq("id", campaignId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/campaigns");
  revalidatePath(`/dashboard/campaigns/${campaignId}`);
  return {};
}

export async function listCampaignSequenceStepsAction(
  campaignId: string,
): Promise<{
  error?: string;
  steps?: CampaignSequenceStep[];
  lockedStepCounts?: Record<number, number>;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const campaign = await requireCampaignOwner(supabase, campaignId, user.id);
  if (!campaign) return { error: "Campaign not found." };

  const [{ data: steps, error }, lockedCounts] = await Promise.all([
    supabase
      .from("campaign_sequence_steps")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("step_number", { ascending: true }),
    getSequenceLockCounts(supabase, campaignId),
  ]);

  if (error) return { error: error.message };

  return {
    steps: (steps ?? []) as CampaignSequenceStep[],
    lockedStepCounts: Object.fromEntries(lockedCounts.entries()),
  };
}

export async function saveCampaignSequenceAction(
  campaignId: string,
  steps: CampaignSequenceStepInput[],
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const campaign = await requireCampaignOwner(supabase, campaignId, user.id);
  if (!campaign) return { error: "Campaign not found." };

  const normalized = sortCampaignSequenceSteps(steps.map(normalizeCampaignSequenceStepInput));
  const validation = validateCampaignSequenceSteps(normalized);
  if (!validation.valid) return { error: validation.error };

  const [{ data: existingSteps, error: existingError }, lockedCounts] = await Promise.all([
    supabase
      .from("campaign_sequence_steps")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("step_number", { ascending: true }),
    getSequenceLockCounts(supabase, campaignId),
  ]);

  if (existingError) return { error: existingError.message };
  const currentSteps = (existingSteps ?? []) as CampaignSequenceStep[];

  for (const step of currentSteps) {
    if (!canRemoveCampaignStep(step.step_number, lockedCounts)) {
      const incoming = normalized.find((item) => item.step_number === step.step_number);
      if (!incoming) {
        return { error: `Step ${step.step_number} is locked and cannot be removed.` };
      }
      if (
        incoming.label !== step.label
        || incoming.delay_days !== step.delay_days
        || (incoming.subject_template ?? null) !== (step.subject_template ?? null)
        || (incoming.body_template ?? null) !== (step.body_template ?? null)
      ) {
        return { error: `Step ${step.step_number} is locked and cannot be edited.` };
      }
    }
  }

  const lockedNumbers = new Set(
    currentSteps
      .filter((step) => !canRemoveCampaignStep(step.step_number, lockedCounts))
      .map((step) => step.step_number),
  );
  const editableExistingIds = currentSteps
    .filter((step) => !lockedNumbers.has(step.step_number))
    .map((step) => step.id);

  if (editableExistingIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("campaign_sequence_steps")
      .delete()
      .in("id", editableExistingIds);
    if (deleteError) return { error: deleteError.message };
  }

  const editableSteps = normalized.filter((step) => !lockedNumbers.has(step.step_number));
  if (editableSteps.length > 0) {
    const { error: insertError } = await supabase
      .from("campaign_sequence_steps")
      .insert(editableSteps.map((step) => ({
        campaign_id: campaignId,
        step_number: step.step_number,
        label: step.label,
        delay_days: step.delay_days,
        subject_template: step.subject_template ?? null,
        body_template: step.body_template ?? null,
      })));
    if (insertError) return { error: insertError.message };
  }

  await touchCampaign(supabase, campaignId, {
    last_sequence_update_at: new Date().toISOString(),
    sequence_step_count: normalized.length,
  });

  revalidatePath(`/dashboard/campaigns/${campaignId}`);
  revalidatePath("/dashboard/campaigns");
  return {};
}

export async function deleteCampaignSequenceStepAction(
  campaignId: string,
  stepNumber: number,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const campaign = await requireCampaignOwner(supabase, campaignId, user.id);
  if (!campaign) return { error: "Campaign not found." };
  if (stepNumber < 1 || stepNumber > 5) return { error: "Step number must be between 1 and 5." };

  const lockedCounts = await getSequenceLockCounts(supabase, campaignId);
  if (!canRemoveCampaignStep(stepNumber, lockedCounts)) {
    return { error: `Step ${stepNumber} is locked and cannot be removed.` };
  }

  const { error } = await supabase
    .from("campaign_sequence_steps")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("step_number", stepNumber);

  if (error) return { error: error.message };

  await touchCampaign(supabase, campaignId, {
    last_sequence_update_at: new Date().toISOString(),
    deleted_step_number: stepNumber,
  });

  revalidatePath(`/dashboard/campaigns/${campaignId}`);
  revalidatePath("/dashboard/campaigns");
  return {};
}

export async function assignProspectsToCampaignAction(params: {
  prospectIds: string[];
  campaignId: string | null;
}): Promise<{ error?: string; assignedCount?: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (params.prospectIds.length === 0) return { error: "Select at least one prospect." };

  let campaign: Campaign | null = null;
  if (params.campaignId) {
    campaign = await requireCampaignOwner(supabase, params.campaignId, user.id);
    if (!campaign) return { error: "Campaign not found." };
  }

  const { error } = await supabase
    .from("prospects")
    .update({
      campaign_id: campaign?.id ?? null,
      campaign: campaign?.name ?? null,
    })
    .in("id", params.prospectIds)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  if (campaign) {
    await touchCampaign(supabase, campaign.id, {
      last_assignment_count: params.prospectIds.length,
    });
  }

  revalidatePath("/dashboard/prospects");
  if (campaign) revalidatePath(`/dashboard/campaigns/${campaign.id}`);
  return { assignedCount: params.prospectIds.length };
}

export async function importProspectsAction(params: {
  rawText: string;
  campaignId?: string | null;
  createCampaignName?: string | null;
  defaultSource?: string | null;
}): Promise<{
  error?: string;
  campaignId?: string | null;
  summary?: {
    total: number;
    imported: number;
    invalid: number;
    duplicates: number;
  };
  rows?: Array<{
    rowNumber: number;
    companyName: string;
    websiteUrl: string;
    status: "imported" | "invalid" | "duplicate";
    message: string;
  }>;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  let campaignId = params.campaignId ?? null;
  if (!campaignId && params.createCampaignName?.trim()) {
    const created = await createCampaignAction({
      name: params.createCampaignName.trim(),
      status: "draft",
    });
    if (created.error) return { error: created.error };
    campaignId = created.campaignId ?? null;
  }

  let selectedCampaign: Campaign | null = null;
  if (campaignId) {
    selectedCampaign = await requireCampaignOwner(supabase, campaignId, user.id);
    if (!selectedCampaign) return { error: "Campaign not found." };
  }

  const [{ data: existingProspects }, { data: campaigns }] = await Promise.all([
    supabase.from("prospects").select("website_url").eq("user_id", user.id),
    supabase.from("campaigns").select("id, name").eq("user_id", user.id),
  ]);

  const preview = previewProspectImportRows({
    rawText: params.rawText,
    existingProspects: ((existingProspects ?? []) as Array<Pick<Prospect, "website_url">>),
  });

  const campaignByName = new Map(
    ((campaigns ?? []) as Array<Pick<Campaign, "id" | "name">>)
      .map((campaign) => [campaign.name.trim().toLowerCase(), campaign]),
  );

  const rows = preview.rows.map((row) => {
    if (!row.valid) {
      return {
        rowNumber: row.rowNumber,
        companyName: row.company_name,
        websiteUrl: row.website_url,
        status: row.duplicate_reason ? "duplicate" as const : "invalid" as const,
        message: row.duplicate_reason ?? row.errors.join(" "),
      };
    }

    return {
      rowNumber: row.rowNumber,
      companyName: row.company_name,
      websiteUrl: row.normalized_website_url ?? row.website_url,
      status: "imported" as const,
      message: "Ready to import",
    };
  });

  const validRows = preview.rows.filter((row) => row.valid);
  if (validRows.length === 0) {
    return {
      error: "No valid rows to import.",
      campaignId,
      summary: {
        total: preview.summary.total,
        imported: 0,
        invalid: preview.summary.invalid,
        duplicates: preview.summary.duplicates,
      },
      rows,
    };
  }

  const insertRows = validRows.map((row) => {
    const matchedCampaign = selectedCampaign
      ?? (row.campaign ? campaignByName.get(row.campaign.trim().toLowerCase()) ?? null : null);

    return {
      user_id: user.id,
      company_name: row.company_name,
      website_url: row.normalized_website_url ?? row.website_url,
      contact_name: row.contact_name,
      contact_email: row.contact_email,
      contact_phone: row.contact_phone,
      notes: row.notes,
      source: row.source ?? params.defaultSource?.trim() ?? "bulk_import",
      campaign: matchedCampaign?.name ?? row.campaign,
      campaign_id: matchedCampaign?.id ?? null,
      status: "new",
      metadata: {
        import_row_number: row.rowNumber,
        import_source: "bulk_import",
      },
    };
  });

  const { error } = await supabase.from("prospects").insert(insertRows);
  if (error) return { error: error.message };

  const resolvedCampaignIds = Array.from(new Set(insertRows.map((row) => row.campaign_id).filter((value): value is string => !!value)));
  for (const resolvedCampaignId of resolvedCampaignIds) {
    await touchCampaign(supabase, resolvedCampaignId, {
      last_import_count: insertRows.filter((row) => row.campaign_id === resolvedCampaignId).length,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath("/dashboard/campaigns");
  resolvedCampaignIds.forEach((resolvedCampaignId) => revalidatePath(`/dashboard/campaigns/${resolvedCampaignId}`));

  return {
    campaignId,
    summary: {
      total: preview.summary.total,
      imported: validRows.length,
      invalid: preview.summary.invalid,
      duplicates: preview.summary.duplicates,
    },
    rows,
  };
}

export async function batchGenerateCampaignPackagesAction(params: {
  prospectIds: string[];
}): Promise<{
  error?: string;
  results?: Array<{ prospectId: string; status: "ready" | "failed"; message: string }>;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (params.prospectIds.length === 0) return { error: "Select at least one prospect." };

  const results: Array<{ prospectId: string; status: "ready" | "failed"; message: string }> = [];
  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, campaign_id")
    .in("id", params.prospectIds)
    .eq("user_id", user.id);

  for (const prospect of (prospects ?? []) as Array<Pick<Prospect, "id" | "campaign_id">>) {
    const generated = await generateOutreachPackageAction(prospect.id);
    results.push({
      prospectId: prospect.id,
      status: generated.error ? "failed" : "ready",
      message: generated.error ?? "Outreach package prepared.",
    });

    if (prospect.campaign_id) {
      await touchCampaign(supabase, prospect.campaign_id, {
        last_batch_package_run_at: new Date().toISOString(),
      });
    }
  }

  revalidatePath("/dashboard/prospects");
  revalidatePath("/dashboard/campaigns");
  return { results };
}

export async function batchAnalyzeCampaignProspectsAction(params: {
  prospectIds: string[];
}): Promise<{
  error?: string;
  summary?: { succeeded: number; skipped: number; failed: number };
  results?: Array<{ prospectId: string; status: "succeeded" | "skipped" | "failed"; message: string; analysisId?: string }>;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (params.prospectIds.length === 0) return { error: "Select at least one prospect." };

  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, campaign_id, website_url, status")
    .in("id", params.prospectIds)
    .eq("user_id", user.id);

  const results: Array<{ prospectId: string; status: "succeeded" | "skipped" | "failed"; message: string; analysisId?: string }> = [];
  const touchedCampaignIds = new Set<string>();

  for (const prospect of (prospects ?? []) as Array<Pick<Prospect, "id" | "campaign_id" | "website_url" | "status">>) {
    if (!prospect.website_url?.trim()) {
      results.push({
        prospectId: prospect.id,
        status: "skipped",
        message: "Website URL is missing.",
      });
      continue;
    }

    const analyzed = await analyzeProspectAction(prospect.id);
    results.push({
      prospectId: prospect.id,
      status: analyzed.error ? "failed" : "succeeded",
      message: analyzed.error ?? "Website analysis completed.",
      analysisId: analyzed.analysisId,
    });
    if (prospect.campaign_id) touchedCampaignIds.add(prospect.campaign_id);
  }

  for (const campaignId of touchedCampaignIds) {
    await touchCampaign(supabase, campaignId, {
      last_batch_analysis_at: new Date().toISOString(),
    });
    revalidatePath(`/dashboard/campaigns/${campaignId}`);
  }

  revalidatePath("/dashboard/prospects");
  revalidatePath("/dashboard/campaigns");

  return {
    summary: {
      succeeded: results.filter((item) => item.status === "succeeded").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      failed: results.filter((item) => item.status === "failed").length,
    },
    results,
  };
}

export async function batchConvertCampaignProspectsAction(params: {
  prospectIds: string[];
  automationLevel?: ProspectAutomationLevel;
}): Promise<{
  error?: string;
  summary?: { succeeded: number; skipped: number; failed: number };
  results?: Array<{ prospectId: string; status: "converted" | "skipped" | "failed"; message: string; projectId?: string; clientId?: string }>;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (params.prospectIds.length === 0) return { error: "Select at least one prospect." };

  const level = params.automationLevel ?? "convert_only";
  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, campaign_id, converted_project_id")
    .in("id", params.prospectIds)
    .eq("user_id", user.id);

  const results: Array<{ prospectId: string; status: "converted" | "skipped" | "failed"; message: string; projectId?: string; clientId?: string }> = [];
  const touchedCampaignIds = new Set<string>();

  for (const prospect of (prospects ?? []) as Array<Pick<Prospect, "id" | "campaign_id" | "converted_project_id">>) {
    if (prospect.converted_project_id) {
      results.push({
        prospectId: prospect.id,
        status: "skipped",
        message: "Prospect has already been converted.",
        projectId: prospect.converted_project_id,
      });
      continue;
    }

    const converted = await convertProspectAction(prospect.id, { automationLevel: level });
    results.push({
      prospectId: prospect.id,
      status: converted.error ? "failed" : "converted",
      message: converted.error ?? "Prospect converted successfully.",
      projectId: converted.projectId,
      clientId: converted.clientId,
    });
    if (prospect.campaign_id) touchedCampaignIds.add(prospect.campaign_id);
  }

  for (const campaignId of touchedCampaignIds) {
    await touchCampaign(supabase, campaignId, {
      last_batch_convert_at: new Date().toISOString(),
      last_batch_convert_level: level,
    });
    revalidatePath(`/dashboard/campaigns/${campaignId}`);
  }

  revalidatePath("/dashboard/prospects");
  revalidatePath("/dashboard/campaigns");

  return {
    summary: {
      succeeded: results.filter((item) => item.status === "converted").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      failed: results.filter((item) => item.status === "failed").length,
    },
    results,
  };
}

export async function batchRunCampaignAutomationAction(params: {
  prospectIds: string[];
  level: ProspectAutomationLevel;
}): Promise<{
  error?: string;
  summary?: { succeeded: number; skipped: number; failed: number };
  results?: Array<{ prospectId: string; status: "succeeded" | "skipped" | "failed"; message: string; latestJobId?: string | null }>;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (params.prospectIds.length === 0) return { error: "Select at least one prospect." };

  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, campaign_id, converted_project_id")
    .in("id", params.prospectIds)
    .eq("user_id", user.id);

  const results: Array<{ prospectId: string; status: "succeeded" | "skipped" | "failed"; message: string; latestJobId?: string | null }> = [];
  const touchedCampaignIds = new Set<string>();

  for (const prospect of (prospects ?? []) as Array<Pick<Prospect, "id" | "campaign_id" | "converted_project_id">>) {
    if (!prospect.converted_project_id) {
      const converted = await convertProspectAction(prospect.id, { automationLevel: params.level });
      results.push({
        prospectId: prospect.id,
        status: converted.error ? "failed" : "succeeded",
        message: converted.error ?? "Prospect converted and automation advanced successfully.",
      });
    } else {
      const automation = await continueProspectAutomationAction(prospect.id, params.level);
      results.push({
        prospectId: prospect.id,
        status: automation.error ? "failed" : "succeeded",
        message: automation.error ?? "Automation advanced successfully.",
        latestJobId: automation.latestJobId ?? null,
      });
    }
    if (prospect.campaign_id) touchedCampaignIds.add(prospect.campaign_id);
  }

  for (const campaignId of touchedCampaignIds) {
    await touchCampaign(supabase, campaignId, {
      last_batch_automation_at: new Date().toISOString(),
      last_batch_automation_level: params.level,
    });
    revalidatePath(`/dashboard/campaigns/${campaignId}`);
  }

  revalidatePath("/dashboard/prospects");
  revalidatePath("/dashboard/campaigns");

  return {
    summary: {
      succeeded: results.filter((item) => item.status === "succeeded").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      failed: results.filter((item) => item.status === "failed").length,
    },
    results,
  };
}

export async function batchSendCampaignOutreachAction(params: {
  prospectIds: string[];
  confirmPhrase: string;
  campaignId?: string | null;
}): Promise<{
  error?: string;
  approval_required?: boolean;
  request_id?: string;
  summary?: { sent: number; blocked: number; failed: number };
  results?: Array<{ prospectId: string; status: "sent" | "blocked" | "failed"; message: string }>;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const roleCheck = await requireRole("sales");
  if (!roleCheck.ok) return { error: roleCheck.error };
  if (params.prospectIds.length === 0) return { error: "Select at least one prospect." };
  if (params.prospectIds.length > 20) {
    const { request } = await createApprovalRequestRecord(supabase, {
      requestType: "batch_outreach",
      requestedBy: user.id,
      context: {
        campaign_id: params.campaignId ?? null,
        campaign_name: null,
        prospect_count: params.prospectIds.length,
        prospect_ids: [...new Set(params.prospectIds.filter(Boolean))],
        requester_email: user.email ?? null,
      },
    });
    return {
      approval_required: true,
      request_id: request.id,
    };
  }

  const expectedPhrase = `SEND ${params.prospectIds.length} EMAIL${params.prospectIds.length === 1 ? "" : "S"}`;
  if (params.confirmPhrase.trim() !== expectedPhrase) {
    return { error: `Confirmation phrase must match "${expectedPhrase}".` };
  }

  const results: Array<{ prospectId: string; status: "sent" | "blocked" | "failed"; message: string }> = [];
  const campaignIds = new Set<string>();

  for (const prospectId of params.prospectIds) {
    const send = await sendProspectOutreachAction(prospectId, { confirm: true });
    let status: "sent" | "blocked" | "failed" = "sent";
    let message = send.error ?? "Outreach sent.";

    if (send.sendId) {
      const { data: sendRow } = await supabase
        .from("outreach_sends")
        .select("status, error_message, campaign_id")
        .eq("id", send.sendId)
        .single();

      if (sendRow) {
        status = sendRow.status as "sent" | "blocked" | "failed";
        message = sendRow.error_message ?? message;
        if (sendRow.campaign_id) campaignIds.add(sendRow.campaign_id);
      } else if (send.error) {
        status = "failed";
      }
    } else if (send.error) {
      status = "failed";
    }

    results.push({ prospectId, status, message });
  }

  for (const campaignId of campaignIds) {
    await touchCampaign(supabase, campaignId, {
      last_batch_send_at: new Date().toISOString(),
    });
    revalidatePath(`/dashboard/campaigns/${campaignId}`);
  }

  revalidatePath("/dashboard/prospects");
  revalidatePath("/dashboard/campaigns");

  return {
    summary: {
      sent: results.filter((result) => result.status === "sent").length,
      blocked: results.filter((result) => result.status === "blocked").length,
      failed: results.filter((result) => result.status === "failed").length,
    },
    results,
  };
}
