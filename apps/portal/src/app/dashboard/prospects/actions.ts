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
import {
  buildOutreachPackageRecord,
} from "@/lib/prospect-outreach";
import { calculateQuoteTotals } from "@/lib/quote-helpers";
import {
  buildOutreachSendBody,
  computeNextFollowUpDate,
  getProspectSendReadiness,
  isDuplicateSendBlocked,
} from "@/lib/outreach-execution";
import { sendEmailViaResend } from "@/lib/resend";
import { getOutreachConfigReadiness } from "@/lib/outreach-config";
import type {
  OutreachSend,
  Prospect,
  ProspectAutomationLevel,
  ProspectOutreachPackage,
  ProspectSiteAnalysis,
  Project,
  Quote,
  QuoteLine,
} from "@/lib/types";
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

export async function generateOutreachPackageAction(
  prospectId: string,
): Promise<{ error?: string; packageId?: string }> {
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

  let { data: packages } = await supabase
    .from("prospect_outreach_packages")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!packages || packages.length === 0) {
    const generated = await generateOutreachPackageAction(prospectId);
    if (generated.error) return { error: generated.error };
    ({ data: packages } = await supabase
      .from("prospect_outreach_packages")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(1));
  }

  const latestPackage = ((packages ?? [])[0] ?? null) as ProspectOutreachPackage | null;
  if (!latestPackage) return { error: "No outreach package available yet." };

  const resendReady = (latestPackage.package_data?.resend_ready as Record<string, unknown> | undefined) ?? {};
  return {
    subject: latestPackage.email_subject ?? (typeof resendReady.subject === "string" ? resendReady.subject : undefined),
    body: latestPackage.email_body ?? (typeof resendReady.body === "string" ? resendReady.body : undefined),
    attachmentPaths: Array.isArray(resendReady.attachment_paths)
      ? resendReady.attachment_paths.filter((item): item is string => typeof item === "string")
      : [],
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

  const [{ data: prospect }, { data: packages }] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", prospectId).single(),
    supabase
      .from("prospect_outreach_packages")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (!prospect) return { error: "Prospect not found." };
  const p = prospect as Prospect;
  const latestPackage = ((packages ?? [])[0] ?? null) as ProspectOutreachPackage | null;
  const configReadiness = getOutreachConfigReadiness();

  const readiness = getProspectSendReadiness({
    prospect: p,
    outreachPackage: latestPackage,
    configReadiness,
  });
  if (!readiness.ready) {
    if (latestPackage?.email_subject && latestPackage?.email_body && p.contact_email) {
      const { data: blockedRow } = await supabase
        .from("outreach_sends")
        .insert({
          prospect_id: p.id,
          outreach_package_id: latestPackage.id,
          client_id: p.converted_client_id,
          project_id: p.converted_project_id,
          campaign_id: p.campaign_id ?? null,
          recipient_email: p.contact_email,
          subject: latestPackage.email_subject,
          body: latestPackage.email_body,
          attachment_links: [],
          status: "blocked",
          provider: "resend",
          error_message: readiness.issues.join(" "),
        })
        .select("id")
        .single();

      return { error: readiness.issues.join(" "), sendId: blockedRow?.id };
    }
    return { error: readiness.issues.join(" ") };
  }

  const priorSends = (
    await supabase
      .from("outreach_sends")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(10)
  ).data ?? [];

  const blocked = isDuplicateSendBlocked({
    sends: priorSends as OutreachSend[],
    recipientEmail: p.contact_email!,
    subject: latestPackage!.email_subject!,
  });

  if (blocked) {
    const { data: blockedRow } = await supabase
      .from("outreach_sends")
      .insert({
        prospect_id: p.id,
        outreach_package_id: latestPackage!.id,
        client_id: p.converted_client_id,
        project_id: p.converted_project_id,
        campaign_id: p.campaign_id ?? null,
        recipient_email: p.contact_email!,
        subject: latestPackage!.email_subject!,
        body: latestPackage!.email_body!,
        attachment_links: [],
        status: "blocked",
        provider: "resend",
        error_message: "Blocked duplicate send within the safety window.",
      })
      .select("id")
      .single();

    return { error: "A matching outreach email was already sent recently.", sendId: blockedRow?.id };
  }

  const projectUrl = p.converted_project_id && configReadiness.values.portalUrl
    ? `${configReadiness.values.portalUrl}/dashboard/projects/${p.converted_project_id}`
    : null;

  const attachmentPaths = await prepareProspectEmailDraftAction(prospectId);
  if (attachmentPaths.error) return { error: attachmentPaths.error };

  const screenshotLinks: string[] = [];
  for (const storagePath of attachmentPaths.attachmentPaths ?? []) {
    const { data } = await supabase.storage
      .from("review-screenshots")
      .createSignedUrl(storagePath, 7 * 24 * 60 * 60);
    if (data?.signedUrl) screenshotLinks.push(data.signedUrl);
  }

  const sendBody = buildOutreachSendBody({
    body: latestPackage!.email_body!,
    projectUrl,
    screenshotLinks,
  });

  const { data: sendRow, error: sendInsertError } = await supabase
    .from("outreach_sends")
    .insert({
      prospect_id: p.id,
      outreach_package_id: latestPackage!.id,
      client_id: p.converted_client_id,
      project_id: p.converted_project_id,
      campaign_id: p.campaign_id ?? null,
      recipient_email: p.contact_email!,
      subject: latestPackage!.email_subject!,
      body: sendBody,
      attachment_links: screenshotLinks,
      status: "pending",
      provider: "resend",
    })
    .select("id")
    .single();

  if (sendInsertError || !sendRow) {
    return { error: sendInsertError?.message ?? "Failed to create outreach send record." };
  }

  const resendResult = await sendEmailViaResend({
    to: p.contact_email!,
    subject: latestPackage!.email_subject!,
    text: sendBody,
  });

  const sentAt = new Date();
  if (!resendResult.ok) {
    await supabase
      .from("outreach_sends")
      .update({
        status: "failed",
        error_message: resendResult.error ?? "Unknown Resend error.",
      })
      .eq("id", sendRow.id);

    return { error: resendResult.error ?? "Failed to send outreach email.", sendId: sendRow.id };
  }

  await supabase
    .from("outreach_sends")
    .update({
      status: "sent",
      provider_message_id: resendResult.messageId ?? null,
      sent_at: sentAt.toISOString(),
    })
    .eq("id", sendRow.id);

  await supabase
    .from("prospects")
    .update({
      outreach_status: "sent",
      last_outreach_sent_at: sentAt.toISOString(),
      next_follow_up_due_at: computeNextFollowUpDate(sentAt, p.follow_up_count ?? 0),
      follow_up_count: (p.follow_up_count ?? 0) + 1,
      metadata: {
        ...(p.metadata ?? {}),
        latest_outreach_send_id: sendRow.id,
      },
    })
    .eq("id", p.id);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${prospectId}`);
  return { sendId: sendRow.id };
}
