"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { processIntake } from "@/lib/intake-processor";
import {
  getAuthoritativeSelectedModules,
  seedSelectedModulesFromRecommendations,
  syncDraftWithSelectedModules,
} from "@/lib/module-selection";
import { analyzeProspectWebsite, normalizeWebsiteUrl } from "@/lib/prospect-analysis";
import type { Prospect, ProspectSiteAnalysis, Project } from "@/lib/types";
import { asNullableString, buildInitialRequestSnapshot } from "../new/client-intake-helpers";
import { createRevisionAndSetCurrent } from "../projects/[id]/project-revision-helpers";

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
  options?: { autoProcess?: boolean },
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

  let finalProject = createdProject as Project;

  if (options?.autoProcess) {
    const processed = processIntake(finalProject, []);
    const selectedModules = seedSelectedModulesFromRecommendations(processed.recommendations);
    const syncedDraft = syncDraftWithSelectedModules(processed.draftRequest, selectedModules);

    await supabase
      .from("projects")
      .update({
        status: "intake_draft_ready",
        client_summary: processed.clientSummary,
        draft_request: syncedDraft,
        missing_info: processed.missingInfo,
        recommendations: processed.recommendations,
        selected_modules: selectedModules,
      })
      .eq("id", createdProject.id);

    await createRevisionAndSetCurrent(
      supabase,
      createdProject.id,
      "intake_processor",
      syncedDraft,
      null,
      "Prospect auto-processing snapshot",
    );

    finalProject = {
      ...finalProject,
      status: "intake_draft_ready",
      selected_modules: selectedModules,
    };

    await supabase.from("project_events").insert({
      project_id: createdProject.id,
      event_type: "intake_processed",
      from_status: "intake_received",
      to_status: "intake_draft_ready",
      metadata: {
        source: "prospect_auto_process",
        prospect_id: p.id,
        selected_modules: selectedModules.map((module) => module.id),
      },
    });
  }

  await supabase
    .from("prospects")
    .update({
      status: "converted",
      converted_client_id: clientId,
      converted_project_id: createdProject.id,
      metadata: {
        ...(p.metadata ?? {}),
        auto_processed: !!options?.autoProcess,
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
      auto_processed: !!options?.autoProcess,
      current_modules: getAuthoritativeSelectedModules(finalProject).map((module) => module.id),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/prospects");
  revalidatePath(`/dashboard/prospects/${prospectId}`);
  return { projectId: createdProject.id, clientId };
}
