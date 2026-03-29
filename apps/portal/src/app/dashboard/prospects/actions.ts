"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  buildQuoteLineDrafts,
  getTemplateIdForQuote,
  loadPricingRows,
} from "../projects/[id]/project-quote-helpers";
import { getAuthoritativeSelectedModules } from "@/lib/module-selection";
import { analyzeProspectWebsite, normalizeWebsiteUrl } from "@/lib/prospect-analysis";
import { buildProspectEnrichmentRecord } from "@/lib/prospect-enrichment";
import {
  buildOutreachPackageRecord,
} from "@/lib/prospect-outreach";
import { calculateQuoteTotals } from "@/lib/quote-helpers";
import type {
  CampaignSequenceStep,
  Prospect,
  ProspectAutomationLevel,
  ProspectEnrichment,
  ProspectOutreachPackage,
  ProspectSiteAnalysis,
  Project,
  Quote,
  QuoteLine,
} from "@/lib/types";
import { readProspectSequenceState } from "@/lib/campaign-sequences";
import { buildCampaignSequenceState, buildPausedSequenceState } from "@/lib/sequence-execution";
import { createContinuationRequest, resolveContinuationRequest, listContinuationRequests, isContinuationEligible } from "@/lib/continuation-helpers";
import { buildProspectReplyUpdate } from "@/lib/reply-workflow";
import { asNullableString, buildInitialRequestSnapshot } from "../new/client-intake-helpers";
import { createRevisionAndSetCurrent } from "../projects/[id]/project-revision-helpers";
import {
  approveIntakeAction,
  exportToGeneratorAction,
  generateSiteAction,
  getQuotesForProjectAction,
  processIntakeAction,
  runReviewAction,
} from "../projects/[id]/actions";
import { loadCurrentDraft } from "../projects/[id]/project-revision-helpers";
import {
  executeProspectOutreachSend,
  loadLatestProspectOutreachPackage,
  readResendReadyAttachmentPaths,
} from "./prospect-send-helpers";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

async function allocateProspectProjectSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyName: string,
) {
  const baseSlug = slugify(companyName) || "prospect-project";
  let attempt = 0;

  while (attempt < 50) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const { data } = await supabase
      .from("projects")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (!data) return slug;
    attempt += 1;
  }

  throw new Error("Unable to allocate a unique project slug for this prospect.");
}

async function updateProspectAutomationMetadata(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prospect: Prospect,
  updates: Record<string, unknown>,
) {
  await supabase
    .from("prospects")
    .update({
      metadata: {
        ...(prospect.metadata ?? {}),
        ...updates,
      },
    })
    .eq("id", prospect.id);
}

async function runProspectAutomationLevel(params: {
  prospect: Prospect;
  projectId: string;
  level: ProspectAutomationLevel;
}) {
  const supabase = await createClient();
  const progress: Array<{ step: string; ok: boolean; error?: string; jobId?: string }> = [];
  let blockedReason: string | null = null;
  let latestJobId: string | null = null;

  if (params.level === "convert_only") {
    return { progress, blockedReason, latestJobId };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("status")
    .eq("id", params.projectId)
    .single();

  let currentStatus = project?.status ?? null;
  if (!currentStatus) {
    return { progress, blockedReason: "Project not found for automation.", latestJobId };
  }

  if (currentStatus === "intake_received" || currentStatus === "intake_needs_revision") {
    const processResult = await processIntakeAction(params.projectId);
    progress.push({ step: "process_intake", ok: !processResult.error, error: processResult.error });
    if (processResult.error) {
      return { progress, blockedReason: processResult.error, latestJobId };
    }
    currentStatus = "intake_draft_ready";
  }

  if (params.level === "process_intake") {
    return { progress, blockedReason, latestJobId };
  }

  if (currentStatus === "intake_draft_ready" || currentStatus === "custom_quote_required") {
    const approveResult = await approveIntakeAction(params.projectId);
    progress.push({ step: "approve_intake", ok: !approveResult.error, error: approveResult.error });
    if (approveResult.error) {
      return {
        progress,
        blockedReason: `Automation stopped before export: ${approveResult.error}`,
        latestJobId,
      };
    }
    currentStatus = "intake_approved";
  }

  if (currentStatus === "intake_approved") {
    const exportResult = await exportToGeneratorAction(params.projectId);
    progress.push({ step: "export_to_generator", ok: !exportResult.error, error: exportResult.error });
    if (exportResult.error) {
      return { progress, blockedReason: exportResult.error, latestJobId };
    }
    currentStatus = "intake_parsed";
  }

  if (params.level === "export_to_generator") {
    return { progress, blockedReason, latestJobId };
  }

  if (["intake_parsed", "awaiting_review", "template_selected", "workspace_generated", "build_failed", "review_ready"].includes(currentStatus)) {
    if (["intake_parsed", "awaiting_review", "template_selected"].includes(currentStatus)) {
      const generateResult = await generateSiteAction(params.projectId);
      progress.push({
        step: "generate_site",
        ok: !generateResult.error,
        error: generateResult.error,
        jobId: generateResult.jobId,
      });
      if (generateResult.error) {
        return { progress, blockedReason: generateResult.error, latestJobId };
      }
      latestJobId = generateResult.jobId ?? null;
      currentStatus = "build_in_progress";
    }
  } else {
    return { progress, blockedReason: `Current project status "${currentStatus}" cannot continue automation.`, latestJobId };
  }

  if (params.level === "generate_site") {
    return { progress, blockedReason, latestJobId };
  }

  if (currentStatus === "workspace_generated" || currentStatus === "build_failed" || currentStatus === "review_ready") {
    const reviewResult = await runReviewAction(params.projectId);
    progress.push({
      step: "review_site",
      ok: !reviewResult.error,
      error: reviewResult.error,
      jobId: reviewResult.jobId,
    });
    if (reviewResult.error) {
      return { progress, blockedReason: reviewResult.error, latestJobId };
    }
    latestJobId = reviewResult.jobId ?? latestJobId;
    return { progress, blockedReason, latestJobId };
  }

  blockedReason = "Generate job dispatched. Review automation is waiting for site generation to complete.";

  // Create continuation request so the operator sees an actionable item after generate completes
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  if (currentUser) {
    await createContinuationRequest(supabase, {
      prospectId: params.prospect.id,
      projectId: params.projectId,
      campaignId: params.prospect.campaign_id ?? null,
      userId: currentUser.id,
      requestType: "pending_review",
      context: {
        automation_level: params.level,
        generate_job_id: latestJobId,
        created_reason: "review_site automation blocked by in-progress generation",
      },
    });
  }

  return { progress, blockedReason, latestJobId };
}

async function buildProspectPricingEstimate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  project: Project,
) {
  const { draft, error } = await loadCurrentDraft(supabase, project.id);
  if (error) return null;
  const templateId = getTemplateIdForQuote(project, draft);
  const selectedModules = getAuthoritativeSelectedModules(project);
  const pricing = await loadPricingRows(supabase, [templateId, ...selectedModules.map((module) => module.id)]);
  const lines = buildQuoteLineDrafts({ templateId, selectedModules, pricing });
  const totals = calculateQuoteTotals({ lines, discountCents: 0 });
  return {
    templateId,
    setupTotalCents: totals.setupTotalCents,
    recurringTotalCents: totals.recurringTotalCents,
  };
}

async function loadLatestProspectEnrichment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prospectId: string,
) {
  const { data } = await supabase
    .from("prospect_enrichments")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false })
    .limit(1);

  return ((data ?? [])[0] ?? null) as ProspectEnrichment | null;
}

export async function createProspectAction(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const companyName = (formData.get("companyName") as string | null)?.trim();
  const websiteUrl = normalizeWebsiteUrl((formData.get("websiteUrl") as string | null) ?? "");
  const contactName = asNullableString(formData.get("contactName"));
  const contactEmail = asNullableString(formData.get("contactEmail"));
  const contactPhone = asNullableString(formData.get("contactPhone"));
  const notes = asNullableString(formData.get("notes"));
  const source = asNullableString(formData.get("source"));
  const campaign = asNullableString(formData.get("campaign"));

  if (!companyName || !websiteUrl) {
    return { error: "Company name and website URL are required." };
  }

  const { data, error } = await supabase
    .from("prospects")
    .insert({
      user_id: user.id,
      company_name: companyName,
      website_url: websiteUrl,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      notes,
      source,
      campaign,
      status: "new",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Failed to create prospect." };
  }

  redirect(`/dashboard/prospects/${data.id}`);
}

export async function analyzeProspectAction(
  prospectId: string,
): Promise<{ error?: string; analysisId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: prospect } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .single();

  if (!prospect) return { error: "Prospect not found." };

  const p = prospect as Prospect;
  await supabase
    .from("prospects")
    .update({ status: "researching" })
    .eq("id", prospectId);

  const result = await analyzeProspectWebsite(p.website_url);
  const nextStatus = result.ok ? "ready_for_outreach" : "analyzed";

  const { data: analysis, error: analysisError } = await supabase
    .from("prospect_site_analyses")
    .insert({
      prospect_id: prospectId,
      status: result.ok ? "completed" : "failed",
      analysis_source: "server_fetch",
      site_title: result.siteTitle,
      meta_description: result.metaDescription,
      primary_h1: result.primaryH1,
      content_excerpt: result.contentExcerpt,
      structured_output: result.structuredOutput,
      raw_html_excerpt: result.rawHtmlExcerpt,
      error_message: result.errorMessage ?? null,
    })
    .select("id")
    .single();

  if (analysisError || !analysis) {
    return { error: analysisError?.message ?? "Failed to store prospect analysis." };
  }

  await supabase
    .from("prospects")
    .update({
      status: nextStatus,
      website_url: result.normalizedUrl,
      outreach_summary: result.outreachSummary ?? p.outreach_summary ?? null,
      metadata: {
        ...(p.metadata ?? {}),
        latest_analysis_id: analysis.id,
        analysis_source: "server_fetch",
        analysis_status: result.ok ? "completed" : "failed",
      },
    })
    .eq("id", prospectId);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${prospectId}`);
  return { analysisId: analysis.id };
}

export async function convertProspectAction(
  prospectId: string,
  options?: { automationLevel?: ProspectAutomationLevel },
): Promise<{ error?: string; projectId?: string; clientId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: prospect } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .single();

  if (!prospect) return { error: "Prospect not found." };
  const p = prospect as Prospect;

  const automationLevel = options?.automationLevel ?? "convert_only";

  if (p.converted_project_id) {
    return { error: "Prospect has already been converted into a project." };
  }

  let clientId = p.converted_client_id;
  if (!clientId) {
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .insert({
        user_id: user.id,
        source_prospect_id: p.id,
        name: p.company_name,
        contact_name: p.contact_name,
        contact_email: p.contact_email,
        contact_phone: p.contact_phone,
        notes: p.notes,
        metadata: {
          source: p.source,
          campaign: p.campaign,
        },
      })
      .select("id")
      .single();

    if (clientError || !client) {
      return { error: clientError?.message ?? "Failed to create client from prospect." };
    }
    clientId = client.id;
  }

  if (!clientId) return { error: "Failed to create client from prospect." };

  const slug = await allocateProspectProjectSlug(supabase, p.company_name);
  const initialSnapshot = buildInitialRequestSnapshot({
    name: p.company_name,
    businessType: null,
    contactName: p.contact_name,
    contactEmail: p.contact_email,
    contactPhone: p.contact_phone,
    notes: p.notes ?? p.outreach_summary,
    websiteUrl: p.website_url,
    source: p.source,
    campaign: p.campaign,
    outreachSummary: p.outreach_summary,
    sourceProspectId: p.id,
  });

  const { data: createdProject, error: projectError } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      source_prospect_id: p.id,
      client_id: clientId,
      name: p.company_name,
      slug,
      status: "intake_received",
      contact_name: p.contact_name,
      contact_email: p.contact_email,
      contact_phone: p.contact_phone,
      business_type: null,
      notes: p.notes ?? p.outreach_summary,
      metadata: {
        source: "prospect_conversion",
        prospect_id: p.id,
        source_url: p.website_url,
      },
      draft_request: initialSnapshot,
    })
    .select("*")
    .single();

  if (projectError || !createdProject) {
    return { error: projectError?.message ?? "Failed to create project from prospect." };
  }

  await createRevisionAndSetCurrent(
    supabase,
    createdProject.id,
    "manual",
    initialSnapshot,
    null,
    "Initial prospect conversion snapshot",
  );

  const automation = await runProspectAutomationLevel({
    prospect: p,
    projectId: createdProject.id,
    level: automationLevel,
  });

  const { data: refreshedProject } = await supabase
    .from("projects")
    .select("*")
    .eq("id", createdProject.id)
    .single();

  const finalProject = (refreshedProject ?? createdProject) as Project;

  await supabase
    .from("prospects")
    .update({
      status: "converted",
      converted_client_id: clientId,
      converted_project_id: createdProject.id,
      metadata: {
        ...(p.metadata ?? {}),
        automation_level: automationLevel,
        automation_progress: automation.progress,
        automation_blocked_reason: automation.blockedReason,
        automation_latest_job_id: automation.latestJobId,
      },
    })
    .eq("id", prospectId);

  await supabase.from("project_events").insert({
    project_id: createdProject.id,
    event_type: "prospect_converted",
    from_status: finalProject.status,
    to_status: finalProject.status,
    metadata: {
      prospect_id: p.id,
      converted_by: user.id,
      automation_level: automationLevel,
      current_modules: getAuthoritativeSelectedModules(finalProject).map((module) => module.id),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${prospectId}`);
  return { projectId: createdProject.id, clientId };
}

export async function continueProspectAutomationAction(
  prospectId: string,
  level: ProspectAutomationLevel,
): Promise<{ error?: string; latestJobId?: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: prospect } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .single();
  if (!prospect) return { error: "Prospect not found." };
  const p = prospect as Prospect;
  if (!p.converted_project_id) return { error: "Convert the prospect before running automation." };

  const automation = await runProspectAutomationLevel({
    prospect: p,
    projectId: p.converted_project_id,
    level,
  });

  await updateProspectAutomationMetadata(supabase, p, {
    automation_level: level,
    automation_progress: automation.progress,
    automation_blocked_reason: automation.blockedReason,
    automation_latest_job_id: automation.latestJobId,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${prospectId}`);
  return { latestJobId: automation.latestJobId };
}

export async function continuePendingReviewAction(
  continuationRequestId: string,
): Promise<{ error?: string; jobId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const requests = await listContinuationRequests(supabase, { status: "pending" });
  const request = requests.find((r) => r.id === continuationRequestId);
  if (!request) return { error: "Continuation request not found or already resolved." };

  const { data: project } = await supabase
    .from("projects")
    .select("status")
    .eq("id", request.project_id)
    .single();

  if (!project) return { error: "Linked project not found." };

  if (!isContinuationEligible(project.status, request.request_type)) {
    // Mark as blocked if the project can't continue
    if (project.status === "build_failed") {
      await resolveContinuationRequest(supabase, {
        requestId: request.id,
        status: "blocked",
        resolvedBy: user.id,
        resolutionNote: `Build failed. Project status: ${project.status}`,
      });
      return { error: `Cannot continue: project build failed.` };
    }
    return { error: `Project is not ready for review yet (status: ${project.status}).` };
  }

  const reviewResult = await runReviewAction(request.project_id);
  if (reviewResult.error) {
    return { error: reviewResult.error };
  }

  await resolveContinuationRequest(supabase, {
    requestId: request.id,
    status: "completed",
    resolvedBy: user.id,
    resolutionNote: `Review job dispatched: ${reviewResult.jobId ?? "unknown"}`,
  });

  // Update prospect automation metadata
  const { data: prospect } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", request.prospect_id)
    .single();

  if (prospect) {
    const p = prospect as Prospect;
    await updateProspectAutomationMetadata(supabase, p, {
      automation_blocked_reason: null,
      automation_latest_job_id: reviewResult.jobId,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${request.prospect_id}`);
  if (request.campaign_id) {
    revalidatePath(`/dashboard/campaigns/${request.campaign_id}`);
  }
  return { jobId: reviewResult.jobId };
}

export async function pauseProspectSequenceAction(
  prospectId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: prospect } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .single();
  if (!prospect) return { error: "Prospect not found." };

  const p = prospect as Prospect;
  if (!p.campaign_id) return { error: "Prospect is not assigned to a campaign sequence." };

  const { data: steps } = await supabase
    .from("campaign_sequence_steps")
    .select("*")
    .eq("campaign_id", p.campaign_id)
    .order("step_number", { ascending: true });

  const sequenceState = buildPausedSequenceState({
    sequenceSteps: (steps ?? []) as CampaignSequenceStep[],
    existingState: readProspectSequenceState(p.metadata),
    pausedReason: "manual",
  });

  await supabase
    .from("prospects")
    .update({
      metadata: {
        ...(p.metadata ?? {}),
        sequence_state: sequenceState,
      },
    })
    .eq("id", prospectId);

  revalidatePath(`/dashboard/prospects/${prospectId}`);
  revalidatePath("/dashboard/campaigns");
  if (p.campaign_id) revalidatePath(`/dashboard/campaigns/${p.campaign_id}`);
  return {};
}

export async function resumeProspectSequenceAction(
  prospectId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: prospect } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .single();
  if (!prospect) return { error: "Prospect not found." };

  const p = prospect as Prospect;
  if (!p.campaign_id) return { error: "Prospect is not assigned to a campaign sequence." };

  const { data: steps } = await supabase
    .from("campaign_sequence_steps")
    .select("*")
    .eq("campaign_id", p.campaign_id)
    .order("step_number", { ascending: true });

  const sequenceState = buildCampaignSequenceState({
    sequenceSteps: (steps ?? []) as CampaignSequenceStep[],
    existingState: readProspectSequenceState(p.metadata),
  });

  await supabase
    .from("prospects")
    .update({
      metadata: {
        ...(p.metadata ?? {}),
        sequence_state: {
          ...sequenceState,
          paused: false,
          paused_reason: null,
        },
      },
    })
    .eq("id", prospectId);

  revalidatePath(`/dashboard/prospects/${prospectId}`);
  revalidatePath("/dashboard/campaigns");
  if (p.campaign_id) revalidatePath(`/dashboard/campaigns/${p.campaign_id}`);
  return {};
}

export async function markProspectRepliedAction(
  prospectId: string,
  params?: {
    replyNote?: string | null;
    replySummary?: string | null;
    outreachSendId?: string | null;
  },
): Promise<{ error?: string; replyEventId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: prospect } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .single();
  if (!prospect) return { error: "Prospect not found." };

  const p = prospect as Prospect;
  const trimmedNote = params?.replyNote?.trim() || null;
  const trimmedSummary = params?.replySummary?.trim() || null;

  let linkedSendId = params?.outreachSendId ?? null;
  if (linkedSendId) {
    const { data: send } = await supabase
      .from("outreach_sends")
      .select("id")
      .eq("id", linkedSendId)
      .eq("prospect_id", prospectId)
      .maybeSingle();
    if (!send) {
      return { error: "Selected outreach send does not belong to this prospect." };
    }
  } else {
    const { data: latestSend } = await supabase
      .from("outreach_sends")
      .select("id")
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    linkedSendId = latestSend?.id ?? null;
  }

  const { data: steps } = p.campaign_id
    ? await supabase
        .from("campaign_sequence_steps")
        .select("*")
        .eq("campaign_id", p.campaign_id)
        .order("step_number", { ascending: true })
    : { data: [] };

  const prospectPatch = buildProspectReplyUpdate({
    prospect: p,
    sequenceSteps: (steps ?? []) as CampaignSequenceStep[],
    replySummary: trimmedSummary,
    outreachSendId: linkedSendId,
  });

  const { data: replyEvent, error: replyEventError } = await supabase
    .from("prospect_reply_events")
    .insert({
      prospect_id: prospectId,
      outreach_send_id: linkedSendId,
      user_id: user.id,
      reply_note: trimmedNote,
      reply_summary: trimmedSummary,
      metadata: {
        previous_outreach_status: p.outreach_status ?? "draft",
        sequence_paused: true,
      },
    })
    .select("id")
    .single();

  if (replyEventError || !replyEvent) {
    return { error: replyEventError?.message ?? "Failed to record reply event." };
  }

  const { error: prospectUpdateError } = await supabase
    .from("prospects")
    .update({
      ...prospectPatch,
      metadata: {
        ...prospectPatch.metadata,
        latest_reply_event_id: replyEvent.id,
      },
    })
    .eq("id", prospectId);

  if (prospectUpdateError) {
    return { error: prospectUpdateError.message };
  }

  if (linkedSendId) {
    const { data: sendRow } = await supabase
      .from("outreach_sends")
      .select("provider_metadata")
      .eq("id", linkedSendId)
      .maybeSingle();

    await supabase
      .from("outreach_sends")
      .update({
        provider_metadata: {
          ...((sendRow?.provider_metadata as Record<string, unknown> | null) ?? {}),
          reply: {
            reply_event_id: replyEvent.id,
            recorded_at: new Date().toISOString(),
            recorded_by: user.id,
            summary: trimmedSummary,
          },
        },
      })
      .eq("id", linkedSendId);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${prospectId}`);
  if (p.campaign_id) {
    revalidatePath("/dashboard/campaigns");
    revalidatePath(`/dashboard/campaigns/${p.campaign_id}`);
  }

  return { replyEventId: replyEvent.id };
}

export async function generateProspectEnrichmentAction(
  prospectId: string,
): Promise<{ error?: string; enrichmentId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const [{ data: prospect }, { data: analyses }] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", prospectId).single(),
    supabase.from("prospect_site_analyses").select("*").eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(1),
  ]);
  if (!prospect) return { error: "Prospect not found." };

  const p = prospect as Prospect;
  const analysis = ((analyses ?? [])[0] ?? null) as ProspectSiteAnalysis | null;

  const project = p.converted_project_id
    ? ((await supabase.from("projects").select("*").eq("id", p.converted_project_id).single()).data as Project | null)
    : null;

  const quoteResult = project ? await getQuotesForProjectAction(project.id) : { quotes: [] as Array<Quote & { lines: QuoteLine[] }> };
  const latestQuote = quoteResult.quotes[0] ?? null;

  let quoteForEnrichment = latestQuote;
  if (!quoteForEnrichment && project) {
    const estimate = await buildProspectPricingEstimate(supabase, project).catch(() => null);
    if (estimate) {
      quoteForEnrichment = {
        id: "estimate",
        project_id: project.id,
        quote_number: 0,
        revision_id: project.current_revision_id,
        template_id: estimate.templateId,
        selected_modules_snapshot: getAuthoritativeSelectedModules(project),
        status: "draft",
        setup_subtotal_cents: estimate.setupTotalCents,
        recurring_subtotal_cents: estimate.recurringTotalCents,
        discount_cents: 0,
        discount_percent: null,
        discount_reason: null,
        discount_approved_by: null,
        setup_total_cents: estimate.setupTotalCents,
        recurring_total_cents: estimate.recurringTotalCents,
        valid_days: 30,
        valid_until: null,
        client_name: p.company_name,
        client_email: p.contact_email,
        notes: null,
        metadata: { estimated: true },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        lines: [],
      };
    }
  }

  const enrichment = buildProspectEnrichmentRecord({
    prospect: p,
    analysis,
    project,
    quote: quoteForEnrichment,
  });

  const { data: createdEnrichment, error } = await supabase
    .from("prospect_enrichments")
    .insert(enrichment)
    .select("id")
    .single();

  if (error || !createdEnrichment) {
    return { error: error?.message ?? "Failed to generate prospect enrichment." };
  }

  await supabase
    .from("prospects")
    .update({
      metadata: {
        ...(p.metadata ?? {}),
        latest_enrichment_id: createdEnrichment.id,
      },
    })
    .eq("id", prospectId);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${prospectId}`);
  return { enrichmentId: createdEnrichment.id };
}

export async function generateOutreachPackageAction(
  prospectId: string,
): Promise<{ error?: string; packageId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const [{ data: prospect }, { data: analyses }, latestEnrichment] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", prospectId).single(),
    supabase.from("prospect_site_analyses").select("*").eq("prospect_id", prospectId).order("created_at", { ascending: false }).limit(1),
    loadLatestProspectEnrichment(supabase, prospectId),
  ]);
  if (!prospect) return { error: "Prospect not found." };

  const p = prospect as Prospect;
  const analysis = ((analyses ?? [])[0] ?? null) as ProspectSiteAnalysis | null;

  const project = p.converted_project_id
    ? ((await supabase.from("projects").select("*").eq("id", p.converted_project_id).single()).data as Project | null)
    : null;

  const quoteResult = project ? await getQuotesForProjectAction(project.id) : { quotes: [] as Array<Quote & { lines: QuoteLine[] }> };
  const latestQuote = quoteResult.quotes[0] ?? null;

  const screenshots = project
    ? (
        await supabase
          .from("assets")
          .select("storage_path")
          .eq("project_id", project.id)
          .eq("asset_type", "review_screenshot")
          .order("created_at", { ascending: false })
      ).data ?? []
    : [];

  const jobs = project
    ? (
        await supabase
          .from("jobs")
          .select("status")
          .eq("project_id", project.id)
          .order("created_at", { ascending: false })
          .limit(1)
      ).data ?? []
    : [];

  let quoteForPackage = latestQuote;
  if (!quoteForPackage && project) {
    const estimate = await buildProspectPricingEstimate(supabase, project).catch(() => null);
    if (estimate) {
      quoteForPackage = {
        id: "estimate",
        project_id: project.id,
        quote_number: 0,
        revision_id: project.current_revision_id,
        template_id: estimate.templateId,
        selected_modules_snapshot: getAuthoritativeSelectedModules(project),
        status: "draft",
        setup_subtotal_cents: estimate.setupTotalCents,
        recurring_subtotal_cents: estimate.recurringTotalCents,
        discount_cents: 0,
        discount_percent: null,
        discount_reason: null,
        discount_approved_by: null,
        setup_total_cents: estimate.setupTotalCents,
        recurring_total_cents: estimate.recurringTotalCents,
        valid_days: 30,
        valid_until: null,
        client_name: p.company_name,
        client_email: p.contact_email,
        notes: null,
        metadata: { estimated: true },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        lines: [],
      };
    }
  }

  const packageRecord = buildOutreachPackageRecord({
    prospect: p,
    enrichment: latestEnrichment,
    analysis,
    project,
    quote: quoteForPackage,
    screenshotCount: screenshots.length,
    screenshotPaths: screenshots.map((item) => item.storage_path),
    latestJobStatus: jobs[0]?.status ?? null,
    automationLevel: (p.metadata?.automation_level as ProspectAutomationLevel | undefined) ?? "convert_only",
  });

  const { data: createdPackage, error } = await supabase
    .from("prospect_outreach_packages")
    .insert({
      prospect_id: p.id,
      client_id: p.converted_client_id,
      project_id: p.converted_project_id,
      quote_id: latestQuote?.id ?? null,
      status: packageRecord.status,
      package_data: packageRecord.packageData,
      offer_summary: packageRecord.offerSummary,
      email_subject: packageRecord.emailSubject,
      email_body: packageRecord.emailBody,
    })
    .select("id")
    .single();

  if (error || !createdPackage) {
    return { error: error?.message ?? "Failed to generate outreach package." };
  }

  await supabase
    .from("prospects")
    .update({
      outreach_summary: packageRecord.offerSummary,
      outreach_status: "ready",
      metadata: {
        ...(p.metadata ?? {}),
        latest_outreach_package_id: createdPackage.id,
        outreach_package_ready: true,
      },
    })
    .eq("id", prospectId);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${prospectId}`);
  return { packageId: createdPackage.id };
}

export async function prepareProspectEmailDraftAction(
  prospectId: string,
): Promise<{ error?: string; subject?: string; body?: string; attachmentPaths?: string[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  let latestPackage = await loadLatestProspectOutreachPackage(supabase, prospectId);

  if (!latestPackage) {
    const generated = await generateOutreachPackageAction(prospectId);
    if (generated.error) return { error: generated.error };
    latestPackage = await loadLatestProspectOutreachPackage(supabase, prospectId);
  }

  if (!latestPackage) return { error: "No outreach package available yet." };

  const resendReady = (latestPackage.package_data?.resend_ready as Record<string, unknown> | undefined) ?? {};
  return {
    subject: latestPackage.email_subject ?? (typeof resendReady.subject === "string" ? resendReady.subject : undefined),
    body: latestPackage.email_body ?? (typeof resendReady.body === "string" ? resendReady.body : undefined),
    attachmentPaths: readResendReadyAttachmentPaths(latestPackage),
  };
}

export async function sendProspectOutreachAction(
  prospectId: string,
  options?: { confirm?: boolean },
): Promise<{ error?: string; sendId?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!options?.confirm) return { error: "Send confirmation is required." };

  const [{ data: prospect }, latestPackage] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", prospectId).single(),
    loadLatestProspectOutreachPackage(supabase, prospectId),
  ]);

  if (!prospect) return { error: "Prospect not found." };
  const p = prospect as Prospect;
  const result = await executeProspectOutreachSend({
    supabase,
    prospect: p,
    outreachPackage: latestPackage,
    confirm: options?.confirm === true,
  });
  return {
    error: result.error,
    sendId: result.sendId,
  };
}
