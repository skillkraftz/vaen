"use server";

import { createClient } from "@/lib/supabase/server";
import { processIntake } from "@/lib/intake-processor";
import { notifyDiscord } from "@/lib/discord";
import { revalidatePath } from "next/cache";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  Project,
  Asset,
  JobRecord,
  RequestRevision,
  SelectedModule,
  Quote,
  QuoteLine,
} from "@/lib/types";
import {
  REQUIRED_DRAFT_KEYS,
  deepMergeDraft,
  deepSetServer,
  validateDraftRequired,
  ensureDraftDefaults,
} from "@/lib/draft-helpers";
import type { ReviewManifest } from "./project-review-types";
import type { ProjectDiagnostics } from "./project-diagnostics-types";
import {
  readArtifactStatusFromDisk,
  readGeneratedFileFlags,
  readLocalScreenshotDataUrl,
} from "./project-artifact-helpers";
import {
  createRevisionAndSetCurrent,
  loadCurrentDraft,
} from "./project-revision-helpers";
import {
  categorizeFile,
  downloadRevisionAssetsToSite,
} from "./project-asset-helpers";
import { spawnWorker } from "./project-worker-helpers";
import {
  deleteReviewScreenshotAssets,
  removeGeneratedTargets,
} from "./project-recovery-helpers";
import { buildProjectDiagnostics } from "./project-diagnostics-helpers";
import {
  purgeProjectResources,
} from "./project-lifecycle-helpers";
import { allocateVariantIdentity } from "./project-variant-helpers";
import {
  getAuthoritativeSelectedModules,
  listCompatibleModules,
  normalizeSelectedModules,
  seedSelectedModulesFromRecommendations,
  selectedModulesEqual,
  syncDraftWithSelectedModules,
  validateSelectedModules,
} from "@/lib/module-selection";
import { calculateQuoteTotals } from "@/lib/quote-helpers";
import type { ModuleManifest } from "@vaen/module-registry";
import {
  buildQuoteLineDrafts,
  createContractFromQuote,
  expirePastDueQuotes,
  insertQuoteLines,
  loadPricingRows,
  recalculateQuote,
} from "./project-quote-helpers";

export type { ProjectDiagnostics } from "./project-diagnostics-types";

function getProjectTemplateId(
  project: Pick<Project, "recommendations">,
  draft: Record<string, unknown> | null,
) {
  const preferences = (draft?.preferences as Record<string, unknown> | undefined) ?? {};
  const draftTemplate = typeof preferences.template === "string" ? preferences.template : null;
  return draftTemplate ?? project.recommendations?.template.id ?? "service-core";
}

// ── Process intake ───────────────────────────────────────────────────

export async function processIntakeAction(projectId: string): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Load project
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  // Only process from intake_received or intake_needs_revision
  if (p.status !== "intake_received" && p.status !== "intake_needs_revision") {
    return { error: `Cannot process intake in status "${p.status}"` };
  }

  // Load assets
  const { data: assets } = await supabase
    .from("assets")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const assetList = (assets ?? []) as Asset[];

  // Run processing
  const result = processIntake(p, assetList);
  const selectedModules = seedSelectedModulesFromRecommendations(result.recommendations);
  const draftWithModules = syncDraftWithSelectedModules(result.draftRequest, selectedModules);

  // Transition: intake_received → intake_processing → intake_draft_ready
  // (processing is synchronous here, so we go straight to draft_ready)
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      status: "intake_draft_ready",
      client_summary: result.clientSummary,
      draft_request: draftWithModules,
      missing_info: result.missingInfo,
      recommendations: result.recommendations,
      selected_modules: selectedModules,
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  // Create revision from the processed draft
  await createRevisionAndSetCurrent(
    supabase, projectId, "intake_processor", draftWithModules,
    null, "Initial intake processing",
  );

  // Log events
  await supabase.from("project_events").insert([
    {
      project_id: projectId,
      event_type: "intake_processed",
      from_status: p.status,
      to_status: "intake_draft_ready",
      metadata: {
        missing_count: result.missingInfo.length,
        required_missing: result.missingInfo.filter((m) => m.severity === "required").length,
        template: result.recommendations.template.id,
        modules: result.recommendations.modules.map((m) => m.id),
        selected_modules: selectedModules.map((m) => m.id),
      },
    },
  ]);

  notifyDiscord(
    { name: p.name, slug: p.slug, id: p.id, contactEmail: p.contact_email, businessType: p.business_type },
    "intake_processed",
  );

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Approve intake ───────────────────────────────────────────────────

export async function approveIntakeAction(projectId: string): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  if (p.status !== "intake_draft_ready") {
    return { error: `Cannot approve intake in status "${p.status}"` };
  }

  // Validate from active revision (the single source of truth)
  let requestData: Record<string, unknown> | null = null;
  if (p.current_revision_id) {
    const { data: rev } = await supabase
      .from("project_request_revisions")
      .select("request_data")
      .eq("id", p.current_revision_id)
      .single();
    requestData = (rev?.request_data as Record<string, unknown>) ?? null;
  }
  // Legacy fallback for pre-migration projects
  if (!requestData) {
    requestData = (p.draft_request as Record<string, unknown>) ?? null;
  }
  if (!requestData) {
    return { error: "No request data found. Process the intake first." };
  }

  const services = Array.isArray(requestData.services) ? requestData.services : [];
  if (services.length === 0) {
    return { error: "Cannot approve: services list is empty. Add services before approving." };
  }

  if (!p.business_type) {
    return { error: "Cannot approve: business type is missing." };
  }

  if (!p.contact_email && !p.contact_phone) {
    return { error: "Cannot approve: at least one contact method (email or phone) is required." };
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update({ status: "intake_approved" })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "intake_approved",
    from_status: "intake_draft_ready",
    to_status: "intake_approved",
    metadata: { approved_by: user.id },
  });

  notifyDiscord(
    { name: p.name, slug: p.slug, id: p.id, contactEmail: p.contact_email, businessType: p.business_type },
    "intake_approved",
  );

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Request revision ─────────────────────────────────────────────────

export async function requestRevisionAction(
  projectId: string,
  reason: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("status")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };
  if (project.status !== "intake_draft_ready" && project.status !== "custom_quote_required") {
    return { error: `Cannot request revision in status "${project.status}"` };
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update({ status: "intake_needs_revision" })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "revision_requested",
    from_status: project.status,
    to_status: "intake_needs_revision",
    metadata: { reason, requested_by: user.id },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Mark custom quote required ───────────────────────────────────────

export async function markCustomQuoteAction(
  projectId: string,
  reason: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("status")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };
  if (project.status !== "intake_draft_ready") {
    return { error: `Cannot mark custom quote in status "${project.status}"` };
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update({ status: "custom_quote_required" })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "custom_quote_flagged",
    from_status: "intake_draft_ready",
    to_status: "custom_quote_required",
    metadata: { reason, flagged_by: user.id },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Export to generator ──────────────────────────────────────────────

/**
 * Write the approved client-request.json to the canonical target path
 * so the generator/worker can pick it up via `--target <slug>`.
 *
 * Writes to: generated/<slug>/client-request.json
 * (matching the resolveTarget() convention in @vaen/shared)
 */
export async function exportToGeneratorAction(projectId: string): Promise<{ error?: string; path?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  if (p.status !== "intake_approved") {
    return { error: `Can only export approved intakes. Current status: "${p.status}"` };
  }

  // Read from active revision — the single source of truth
  if (!p.current_revision_id) {
    return { error: "No active version found. Process the intake first." };
  }

  const { data: rev } = await supabase
    .from("project_request_revisions")
    .select("request_data")
    .eq("id", p.current_revision_id)
    .single();

  if (!rev?.request_data) {
    return { error: "Active version has no request data. Re-process the intake." };
  }

  const draft = { ...(rev.request_data as Record<string, unknown>) };

  // Ensure required fields exist (guard against past corruption)
  const missingFields = REQUIRED_DRAFT_KEYS.filter((key) => !(key in draft));
  if (missingFields.length > 0) {
    return { error: `Cannot export: active version is missing required fields: ${missingFields.join(", ")}. Re-process the intake to fix.` };
  }

  const services = Array.isArray(draft.services) ? draft.services : [];
  if (services.length === 0) {
    return { error: `Cannot export: services list is empty. Add services before exporting.` };
  }

  // Write client-request.json to the canonical target path
  const repoRoot = join(process.cwd(), "../..");
  const targetDir = join(repoRoot, "generated", p.slug);
  const targetPath = join(targetDir, "client-request.json");
  const siteDir = join(targetDir, "site");

  try {
    await mkdir(targetDir, { recursive: true });

    // Download revision-attached assets (or all project images) to site/public/images/
    const galleryImages = await downloadRevisionAssetsToSite(
      supabase, p.current_revision_id, siteDir,
    );

    // Inject gallery images into the request if assets were downloaded
    if (galleryImages.length > 0) {
      const content = (draft.content ?? {}) as Record<string, unknown>;
      content.galleryImages = galleryImages;
      draft.content = content;
    }

    await writeFile(targetPath, JSON.stringify(draft, null, 2) + "\n", "utf-8");
  } catch (err) {
    return { error: `Failed to write client-request.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Advance to intake_parsed (the next state after intake_approved)
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      status: "intake_parsed",
      last_exported_revision_id: p.current_revision_id,
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "exported_to_generator",
    from_status: "intake_approved",
    to_status: "intake_parsed",
    metadata: {
      output_path: targetPath,
      exported_by: user.id,
      request_source: "revision",
      revision_id: p.current_revision_id,
      asset_count: (draft.content as Record<string, unknown>)?.galleryImages
        ? ((draft.content as Record<string, unknown>).galleryImages as unknown[]).length
        : 0,
    },
  });

  notifyDiscord(
    { name: p.name, slug: p.slug, id: p.id, contactEmail: p.contact_email, businessType: p.business_type },
    "exported",
  );

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { path: targetPath };
}

// ── Update project fields ────────────────────────────────────────────

export async function updateProjectAction(
  projectId: string,
  fields: {
    business_type?: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    notes?: string | null;
    client_summary?: string | null;
  },
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error: updateError } = await supabase
    .from("projects")
    .update(fields)
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Draft request helpers ─────────────────────────────────────────────
// Pure logic in @/lib/draft-helpers — imported at top of file.

// ── Patch a single field in draft request (MERGE-BASED) ──────────────

/**
 * Server-side merge for individual field edits.
 * Loads current draft from DB, applies the patch at the given path,
 * validates required fields, and saves the merged result.
 *
 * Returns the full merged draft so the client can update its state.
 */
export async function patchDraftFieldAction(
  projectId: string,
  path: string[],
  value: unknown,
): Promise<{ error?: string; merged?: Record<string, unknown> }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("selected_modules, recommendations")
    .eq("id", projectId)
    .single();

  const { draft: current, revisionId: currentRevId, error: loadError } = await loadCurrentDraft(supabase, projectId);
  if (loadError) return { error: loadError };

  // Apply patch
  const patched = deepSetServer(current, path, value);
  const merged = syncDraftWithSelectedModules(
    patched,
    getAuthoritativeSelectedModules((project as Pick<Project, "selected_modules" | "recommendations"> | null) ?? {
      selected_modules: [],
      recommendations: null,
    }),
  );

  // Validate
  const validationError = validateDraftRequired(merged);
  if (validationError) return { error: validationError };

  // Create/update revision (debounce: update in-place if last user_edit is <30s old)
  try {
    const { data: recent } = await supabase
      .from("project_request_revisions")
      .select("id, source, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const isRecentEdit = recent?.source === "user_edit" &&
      Date.now() - new Date(recent.created_at).getTime() < 30_000;

    if (isRecentEdit && recent) {
      await supabase
        .from("project_request_revisions")
        .update({ request_data: merged })
        .eq("id", recent.id);
    } else {
      await createRevisionAndSetCurrent(
        supabase, projectId, "user_edit", merged,
        currentRevId, `Edited ${path.join(".")}`,
      );
    }
  } catch { /* pre-migration: silently skip */ }

  // Sync to legacy draft_request column
  await supabase
    .from("projects")
    .update({ draft_request: merged })
    .eq("id", projectId);

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { merged };
}

// ── Replace full draft request (for raw JSON editor) ─────────────────

/**
 * Full replacement of draft_request (used by raw JSON editor).
 * Merges with safe defaults and validates required fields before saving.
 */
export async function updateDraftRequestAction(
  projectId: string,
  draftRequest: Record<string, unknown>,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("selected_modules, recommendations")
    .eq("id", projectId)
    .single();

  // Load current from revision to merge with (preserves fields not in the incoming object)
  const { draft: current, revisionId: currentRevId, error: loadError } = await loadCurrentDraft(supabase, projectId);
  if (loadError) return { error: loadError };

  // Merge: incoming overrides current, but current fills gaps
  const merged = syncDraftWithSelectedModules(
    deepMergeDraft(current, draftRequest),
    getAuthoritativeSelectedModules((project as Pick<Project, "selected_modules" | "recommendations"> | null) ?? {
      selected_modules: [],
      recommendations: null,
    }),
  );

  // Validate
  const validationError = validateDraftRequired(merged);
  if (validationError) return { error: validationError };

  // Create revision as the primary store
  await createRevisionAndSetCurrent(
    supabase, projectId, "user_edit", merged,
    currentRevId, "Full draft replacement via JSON editor",
  );

  // Sync to legacy draft_request column
  await supabase
    .from("projects")
    .update({ draft_request: merged })
    .eq("id", projectId);

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── File management ──────────────────────────────────────────────────

/**
 * Upload files to an existing project. Works at any status.
 */
export async function uploadAssetsAction(
  projectId: string,
  formData: FormData,
): Promise<{ error?: string; uploaded: number }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", uploaded: 0 };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found", uploaded: 0 };

  const files = formData.getAll("files") as File[];
  let uploaded = 0;

  for (const file of files) {
    if (!file || file.size === 0) continue;

    const storagePath = `${user.id}/${projectId}/${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("intake-assets")
      .upload(storagePath, file, { upsert: true });

    if (uploadError) {
      console.error("Upload error:", uploadError.message);
      continue;
    }

    await supabase.from("assets").insert({
      project_id: projectId,
      file_name: file.name,
      file_type: file.type || "application/octet-stream",
      file_size: file.size,
      storage_path: storagePath,
      category: categorizeFile(file.type),
    });

    uploaded++;
  }

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "assets_uploaded",
    metadata: { count: uploaded, triggered_by: user.id },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { uploaded };
}

// ── Revision-asset linkage ───────────────────────────────────────────

/**
 * Attach an uploaded asset to a revision with a role.
 */
export async function attachAssetToRevisionAction(
  revisionId: string,
  assetId: string,
  role: string = "content",
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  try {
    const { error } = await supabase
      .from("revision_assets")
      .upsert({
        revision_id: revisionId,
        asset_id: assetId,
        role,
        sort_order: 0,
      });

    if (error) return { error: error.message };
    return {};
  } catch {
    return { error: "Revision assets table not available (migration pending)" };
  }
}

/**
 * Detach an asset from a revision.
 */
export async function detachAssetFromRevisionAction(
  revisionId: string,
  assetId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("revision_assets")
    .delete()
    .eq("revision_id", revisionId)
    .eq("asset_id", assetId);

  if (error) return { error: error.message };
  return {};
}

/**
 * List assets attached to a specific revision.
 */
export async function listRevisionAssetsAction(
  revisionId: string,
): Promise<{ assets: Array<{ asset_id: string; role: string; sort_order: number }>; error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { assets: [], error: "Not authenticated" };

  try {
    const { data, error } = await supabase
      .from("revision_assets")
      .select("asset_id, role, sort_order")
      .eq("revision_id", revisionId)
      .order("sort_order", { ascending: true });

    if (error) return { assets: [], error: error.message };
    return { assets: data ?? [] };
  } catch {
    return { assets: [], error: "Revision assets table not available" };
  }
}

/**
 * Get screenshots for a project, optionally filtered to a specific revision.
 * When revisionId is provided, only returns screenshots from that revision.
 */
export async function getScreenshotsForProjectAction(
  projectId: string,
  revisionId?: string | null,
): Promise<{
  screenshots: Array<{
    id: string;
    file_name: string;
    storage_path: string;
    source_job_id: string | null;
    request_revision_id: string | null;
    checksum_sha256: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  error?: string;
}> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { screenshots: [], error: "Not authenticated" };

  let query = supabase
    .from("assets")
    .select("id, file_name, storage_path, source_job_id, request_revision_id, checksum_sha256, metadata, created_at")
    .eq("project_id", projectId)
    .eq("asset_type", "review_screenshot")
    .order("created_at", { ascending: false });

  if (revisionId) {
    query = query.eq("request_revision_id", revisionId);
  }

  const { data, error } = await query;

  if (error) return { screenshots: [], error: error.message };
  return { screenshots: data ?? [] };
}

/**
 * Get a signed URL for a screenshot stored in Supabase.
 */
export async function getScreenshotUrlAction(
  storagePath: string,
): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase.storage
    .from("review-screenshots")
    .createSignedUrl(storagePath, 3600);

  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

export async function getAssetUrlAction(
  assetId: string,
  storagePath: string,
): Promise<{ error?: string; url?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase.storage
    .from("intake-assets")
    .createSignedUrl(storagePath, 3600); // 1 hour

  if (error) return { error: error.message };
  return { url: data.signedUrl };
}

export async function deleteAssetAction(
  assetId: string,
  projectId: string,
  storagePath: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Delete from storage
  const { error: storageError } = await supabase.storage
    .from("intake-assets")
    .remove([storagePath]);

  if (storageError) {
    console.error("Storage delete error:", storageError.message);
    // Continue to delete DB record even if storage fails
  }

  // Delete DB record
  const { error: dbError } = await supabase
    .from("assets")
    .delete()
    .eq("id", assetId);

  if (dbError) return { error: dbError.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Phase 3A: Worker-delegated automation ────────────────────────────

/**
 * Generate a site from the exported client-request.json.
 * Creates a job record and spawns the worker — does NOT block.
 */
export async function generateSiteAction(
  projectId: string,
): Promise<{ error?: string; jobId?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  const allowedStatuses = [
    "intake_parsed",
    "awaiting_review",
    "template_selected",
    "workspace_generated",
    "build_failed",
    "review_ready",
  ];
  if (!allowedStatuses.includes(p.status)) {
    return { error: `Cannot generate in status "${p.status}". Export intake first.` };
  }

  // ── Always rewrite client-request.json from active revision ──────
  // This is the critical fix: the disk file must always reflect the
  // active revision at the moment of dispatch, not whatever was last
  // manually exported.
  if (!p.current_revision_id) {
    return { error: "No active version found. Process the intake first." };
  }

  const { data: rev } = await supabase
    .from("project_request_revisions")
    .select("request_data")
    .eq("id", p.current_revision_id)
    .single();

  if (!rev?.request_data) {
    return { error: "Active version has no request data. Re-process the intake." };
  }

  const revisionData = syncDraftWithSelectedModules(
    { ...(rev.request_data as Record<string, unknown>) },
    getAuthoritativeSelectedModules(p),
  );
  const repoRoot = join(process.cwd(), "../..");
  const targetDir = join(repoRoot, "generated", p.slug);
  const clientRequestPath = join(targetDir, "client-request.json");
  const siteDir = join(targetDir, "site");

  try {
    await mkdir(targetDir, { recursive: true });

    // Download revision-attached assets to site/public/images/
    const galleryImages = await downloadRevisionAssetsToSite(
      supabase, p.current_revision_id, siteDir,
    );
    if (galleryImages.length > 0) {
      const content = (revisionData.content ?? {}) as Record<string, unknown>;
      content.galleryImages = galleryImages;
      revisionData.content = content;
    }

    await writeFile(clientRequestPath, JSON.stringify(revisionData, null, 2) + "\n", "utf-8");
    console.log(`[generate] Wrote client-request.json from revision ${p.current_revision_id} for ${p.slug}`);
  } catch (err) {
    return { error: `Failed to write client-request.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Update exported revision pointer
  await supabase
    .from("projects")
    .update({ last_exported_revision_id: p.current_revision_id })
    .eq("id", projectId);

  // Create job record with canonical paths for traceability
  const { data: job, error: insertErr } = await supabase
    .from("jobs")
    .insert({
      project_id: projectId,
      job_type: "generate",
      status: "pending",
      payload: {
        triggered_by: user.id,
        target_slug: p.slug,
        input_path: `generated/${p.slug}/client-request.json`,
        site_path: `generated/${p.slug}/site`,
        revision_id: p.current_revision_id ?? undefined,
      },
    })
    .select("id")
    .single();

  if (insertErr || !job) {
    return { error: `Failed to create job: ${insertErr?.message}` };
  }

  // Log that we're dispatching
  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "job_dispatched",
    from_status: p.status,
    to_status: p.status,
    metadata: { job_id: job.id, job_type: "generate", triggered_by: user.id },
  });

  // Spawn the worker (fire-and-forget)
  spawnWorker(job.id);

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { jobId: job.id };
}

/**
 * Run the review (build + screenshot capture) for a generated site.
 * Creates a job record and spawns the worker — does NOT block.
 */
export async function runReviewAction(
  projectId: string,
): Promise<{ error?: string; jobId?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  const allowedStatuses = [
    "workspace_generated",
    "build_failed",
    "review_ready",
  ];
  if (!allowedStatuses.includes(p.status)) {
    return { error: `Cannot run review in status "${p.status}". Generate site first.` };
  }

  // Create job record with canonical paths for traceability
  const { data: job, error: insertErr } = await supabase
    .from("jobs")
    .insert({
      project_id: projectId,
      job_type: "review",
      status: "pending",
      payload: {
        triggered_by: user.id,
        target_slug: p.slug,
        site_path: `generated/${p.slug}/site`,
        revision_id: p.current_revision_id ?? undefined,
      },
    })
    .select("id")
    .single();

  if (insertErr || !job) {
    return { error: `Failed to create job: ${insertErr?.message}` };
  }

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "job_dispatched",
    from_status: p.status,
    to_status: p.status,
    metadata: { job_id: job.id, job_type: "review", triggered_by: user.id },
  });

  // Spawn the worker (fire-and-forget)
  spawnWorker(job.id);

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { jobId: job.id };
}

// ── Job status queries ───────────────────────────────────────────────

/**
 * Get the most recent jobs for a project (latest first).
 */
export async function getProjectJobsAction(
  projectId: string,
): Promise<JobRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(10);

  return (data ?? []) as JobRecord[];
}

/**
 * Get the current workflow snapshot for a project.
 * Used by the client after background jobs finish so the UI can
 * converge on the latest status/revision without depending on a single refresh.
 */
export async function getProjectWorkflowSnapshotAction(
  projectId: string,
): Promise<{
  status: string | null;
  lastReviewedRevisionId: string | null;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("status, last_reviewed_revision_id")
    .eq("id", projectId)
    .single();

  return {
    status: data?.status ?? null,
    lastReviewedRevisionId: data?.last_reviewed_revision_id ?? null,
  };
}

export async function listModulesForTemplateAction(
  templateId: string,
): Promise<{ modules: Array<Pick<ModuleManifest, "id" | "name" | "description" | "status" | "configSchema">>; error?: string }> {
  try {
    const modules = listCompatibleModules(templateId).map((module) => ({
      id: module.id,
      name: module.name,
      description: module.description,
      status: module.status,
      configSchema: module.configSchema,
    }));
    return { modules };
  } catch (error) {
    return { modules: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateModulesAction(
  projectId: string,
  modules: SelectedModule[],
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;
  if (p.status === "intake_received" || p.status === "intake_processing") {
    return { error: "Modules can be changed after intake processing completes." };
  }

  const { draft: currentDraft, revisionId: currentRevisionId, error: loadError } = await loadCurrentDraft(supabase, projectId);
  if (loadError) return { error: loadError };

  const templateId = getProjectTemplateId(p, currentDraft);
  const normalizedModules = normalizeSelectedModules(modules);
  const validationError = validateSelectedModules(templateId, normalizedModules);
  if (validationError) return { error: validationError };

  const previousModules = getAuthoritativeSelectedModules(p);
  if (selectedModulesEqual(previousModules, normalizedModules)) {
    return {};
  }

  const syncedDraft = syncDraftWithSelectedModules(currentDraft, normalizedModules);

  const revisionId = await createRevisionAndSetCurrent(
    supabase,
    projectId,
    "user_edit",
    syncedDraft,
    currentRevisionId,
    "Updated module selection",
  );

  const previousIds = previousModules.map((module) => module.id);
  const nextIds = normalizedModules.map((module) => module.id);
  const removed = previousIds.filter((id) => !nextIds.includes(id));
  const added = nextIds.filter((id) => !previousIds.includes(id));

  const { error: updateError } = await supabase
    .from("projects")
    .update({
      selected_modules: normalizedModules,
      draft_request: syncedDraft,
      last_exported_revision_id: null,
      last_generated_revision_id: null,
      last_reviewed_revision_id: null,
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  await removeGeneratedTargets(p.slug, [
    ["client-request.json"],
    ["artifacts", "prompt.txt"],
    ["artifacts", "screenshots"],
  ]);
  await deleteReviewScreenshotAssets(supabase, projectId);

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "modules_updated",
    from_status: p.status,
    to_status: p.status,
    metadata: {
      triggered_by: user.id,
      template_id: templateId,
      previous_modules: previousIds,
      selected_modules: nextIds,
      added_modules: added,
      removed_modules: removed,
      revision_id: revisionId,
      invalidated: ["export", "generate", "review", "screenshots"],
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

export async function getQuotesForProjectAction(
  projectId: string,
): Promise<{ quotes: Array<Quote & { lines: QuoteLine[] }>; error?: string }> {
  const supabase = await createClient();
  try {
    await expirePastDueQuotes(supabase, projectId);
  } catch {
    // keep reads resilient if expiry maintenance fails
  }

  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("*, lines:quote_lines(*)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) return { quotes: [], error: error.message };
  return { quotes: (quotes ?? []) as Array<Quote & { lines: QuoteLine[] }> };
}

export async function createQuoteAction(
  projectId: string,
): Promise<{ error?: string; quoteId?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*, client:clients(name, contact_email)")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project & { client?: { name: string | null; contact_email: string | null } | null };
  const { draft, revisionId, error: draftError } = await loadCurrentDraft(supabase, projectId);
  if (draftError) return { error: draftError };
  if (!revisionId) return { error: "Create a revision before creating a quote." };

  const templateId = getProjectTemplateId(p, draft);
  const selectedModules = getAuthoritativeSelectedModules(p);
  let lineDrafts;
  try {
    const pricing = await loadPricingRows(supabase, [templateId, ...selectedModules.map((module) => module.id)]);
    lineDrafts = buildQuoteLineDrafts({ templateId, selectedModules, pricing });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const initialTotals = calculateQuoteTotals({ lines: lineDrafts, discountCents: 0 });

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      project_id: projectId,
      revision_id: revisionId,
      template_id: templateId,
      selected_modules_snapshot: selectedModules,
      status: "draft",
      setup_subtotal_cents: initialTotals.setupSubtotalCents,
      recurring_subtotal_cents: initialTotals.recurringSubtotalCents,
      discount_cents: 0,
      discount_percent: null,
      discount_reason: null,
      setup_total_cents: initialTotals.setupTotalCents,
      recurring_total_cents: initialTotals.recurringTotalCents,
      valid_days: 30,
      valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      client_name: p.client?.name ?? p.name,
      client_email: p.client?.contact_email ?? p.contact_email,
      notes: null,
      metadata: {
        selected_modules: selectedModules.map((module) => module.id),
      },
    })
    .select("id")
    .single();

  if (quoteError || !quote) {
    return { error: quoteError?.message ?? "Failed to create quote." };
  }

  try {
    await insertQuoteLines(supabase, quote.id, lineDrafts);
    await recalculateQuote(supabase, quote.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "quote_created",
    from_status: p.status,
    to_status: p.status,
    metadata: {
      quote_id: quote.id,
      revision_id: revisionId,
      template_id: templateId,
      selected_modules: selectedModules.map((module) => module.id),
      created_by: user.id,
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { quoteId: quote.id };
}

export async function updateQuoteLineAction(
  lineId: string,
  updates: {
    label?: string;
    description?: string | null;
    setup_price_cents?: number;
    recurring_price_cents?: number;
    quantity?: number;
  },
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: line } = await supabase
    .from("quote_lines")
    .select("*, quote:quotes(id, project_id, status)")
    .eq("id", lineId)
    .single();

  if (!line) return { error: "Quote line not found." };
  const quoteRef = Array.isArray(line.quote) ? line.quote[0] : line.quote;
  if (!quoteRef || quoteRef.status !== "draft") return { error: "Only draft quote lines can be edited." };

  const nextUpdate = {
    ...(updates.label !== undefined ? { label: updates.label.trim() || line.label } : {}),
    ...(updates.description !== undefined ? { description: updates.description } : {}),
    ...(updates.setup_price_cents !== undefined ? { setup_price_cents: Math.max(0, Math.round(Number.isFinite(updates.setup_price_cents) ? updates.setup_price_cents : 0)) } : {}),
    ...(updates.recurring_price_cents !== undefined ? { recurring_price_cents: Math.max(0, Math.round(Number.isFinite(updates.recurring_price_cents) ? updates.recurring_price_cents : 0)) } : {}),
    ...(updates.quantity !== undefined ? { quantity: Math.max(1, Math.round(updates.quantity)) } : {}),
  };

  const { error } = await supabase
    .from("quote_lines")
    .update(nextUpdate)
    .eq("id", lineId);

  if (error) return { error: error.message };

  await recalculateQuote(supabase, quoteRef.id);
  revalidatePath(`/dashboard/projects/${quoteRef.project_id}`);
  return {};
}

export async function addQuoteLineAction(
  quoteId: string,
  line: {
    label: string;
    description?: string | null;
    setup_price_cents?: number;
    recurring_price_cents?: number;
  },
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const [{ data: quote }, { data: lines }] = await Promise.all([
    supabase.from("quotes").select("id, project_id, status").eq("id", quoteId).single(),
    supabase.from("quote_lines").select("sort_order").eq("quote_id", quoteId).order("sort_order", { ascending: false }).limit(1),
  ]);

  if (!quote) return { error: "Quote not found." };
  if (quote.status !== "draft") return { error: "Only draft quotes can be edited." };

  const nextSort = (lines?.[0]?.sort_order ?? 0) + 1;
  const { error } = await supabase
    .from("quote_lines")
    .insert({
      quote_id: quoteId,
      line_type: "addon",
      reference_id: null,
      label: line.label.trim() || "Custom line item",
      description: line.description ?? null,
      setup_price_cents: Math.max(0, Math.round(Number.isFinite(line.setup_price_cents ?? 0) ? (line.setup_price_cents ?? 0) : 0)),
      recurring_price_cents: Math.max(0, Math.round(Number.isFinite(line.recurring_price_cents ?? 0) ? (line.recurring_price_cents ?? 0) : 0)),
      quantity: 1,
      sort_order: nextSort,
    });

  if (error) return { error: error.message };
  await recalculateQuote(supabase, quoteId);
  revalidatePath(`/dashboard/projects/${quote.project_id}`);
  return {};
}

export async function transitionQuoteAction(
  quoteId: string,
  newStatus: "sent" | "accepted" | "rejected",
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: quote } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .single();

  if (!quote) return { error: "Quote not found." };
  const quoteRow = quote as Quote;

  const allowedTransitions: Record<Quote["status"], Array<"sent" | "accepted" | "rejected">> = {
    draft: ["sent", "rejected"],
    sent: ["accepted", "rejected"],
    accepted: [],
    rejected: [],
    expired: [],
  };

  if (!allowedTransitions[quoteRow.status].includes(newStatus)) {
    return { error: `Cannot transition quote from "${quoteRow.status}" to "${newStatus}".` };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, client_id, status")
    .eq("id", quoteRow.project_id)
    .single();

  if (!project) return { error: "Project not found." };

  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "sent" && !quoteRow.valid_until) {
    updates.valid_until = new Date(Date.now() + quoteRow.valid_days * 24 * 60 * 60 * 1000).toISOString();
  }

  const { error: updateError } = await supabase
    .from("quotes")
    .update(updates)
    .eq("id", quoteId);

  if (updateError) return { error: updateError.message };

  if (newStatus === "accepted") {
    try {
      await createContractFromQuote(supabase, { ...quoteRow, status: "accepted" }, project as Pick<Project, "id" | "client_id">);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }

    await supabase
      .from("quotes")
      .update({ status: "expired" })
      .eq("project_id", quoteRow.project_id)
      .neq("id", quoteId)
      .in("status", ["draft", "sent"]);
  }

  await supabase.from("project_events").insert({
    project_id: quoteRow.project_id,
    event_type: `quote_${newStatus}`,
    from_status: (project as { status: string }).status,
    to_status: (project as { status: string }).status,
    metadata: {
      quote_id: quoteId,
      previous_quote_status: quoteRow.status,
      next_quote_status: newStatus,
      triggered_by: user.id,
    },
  });

  revalidatePath(`/dashboard/projects/${quoteRow.project_id}`);
  return {};
}

export async function removeQuoteLineAction(
  lineId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: line } = await supabase
    .from("quote_lines")
    .select("id, line_type, quote:quotes(id, project_id, status)")
    .eq("id", lineId)
    .single();

  if (!line) return { error: "Quote line not found." };
  const quoteRef = Array.isArray(line.quote) ? line.quote[0] : line.quote;
  if (!quoteRef || quoteRef.status !== "draft") return { error: "Only draft quotes can be edited." };
  if (line.line_type !== "addon") return { error: "Only addon lines can be removed." };

  const { error } = await supabase.from("quote_lines").delete().eq("id", lineId);
  if (error) return { error: error.message };

  await recalculateQuote(supabase, quoteRef.id);
  revalidatePath(`/dashboard/projects/${quoteRef.project_id}`);
  return {};
}

export async function setQuoteDiscountAction(
  quoteId: string,
  discount: { percent?: number | null; cents?: number | null; reason: string | null },
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, project_id, status")
    .eq("id", quoteId)
    .single();

  if (!quote) return { error: "Quote not found." };
  if (quote.status !== "draft") return { error: "Only draft quotes can be discounted." };

  try {
    await recalculateQuote(supabase, quoteId, {
      discountPercent: discount.percent ?? null,
      discountCents: discount.cents ?? null,
      reason: discount.reason,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  await supabase.from("project_events").insert({
    project_id: quote.project_id,
    event_type: "quote_discount_applied",
    metadata: {
      quote_id: quoteId,
      discount_cents: discount.cents ?? null,
      discount_percent: discount.percent ?? null,
      reason: discount.reason,
      applied_by: user.id,
    },
  });

  revalidatePath(`/dashboard/projects/${quote.project_id}`);
  return {};
}

/**
 * Get a single job by ID.
 */
export async function getJobStatusAction(
  jobId: string,
): Promise<JobRecord | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  return (data as JobRecord) ?? null;
}

// ── Artifact status + screenshots ────────────────────────────────────

/**
 * Check what artifacts exist on disk for a target slug.
 */
export async function getArtifactStatusAction(
  slug: string,
): Promise<{
  hasClientRequest: boolean;
  hasWorkspace: boolean;
  hasSiteBuild: boolean;
  hasScreenshots: boolean;
  screenshotCount: number;
  screenshotNames: string[];
  screenshotManifest: ReviewManifest | null;
}> {
  return readArtifactStatusFromDisk(slug);
}

/**
 * Read a screenshot file and return it as a base64 data URL.
 * Used by the inline screenshot viewer.
 */
export async function getScreenshotAction(
  slug: string,
  filename: string,
): Promise<{ error?: string; dataUrl?: string }> {
  return readLocalScreenshotDataUrl(slug, filename);
}

// ── Recovery: Re-export draft to disk from any status ────────────────

/**
 * Writes the current draft_request to generated/<slug>/client-request.json
 * so the generator can pick it up. Works from ANY status.
 *
 * Unlike exportToGeneratorAction (which requires intake_approved and
 * advances status to intake_parsed), this is a pure data-repair action:
 * it validates the draft, writes to disk, and does NOT change status.
 *
 * Data flow:
 *   READ:  projects.draft_request (Supabase)
 *   WRITE: generated/<slug>/client-request.json (filesystem)
 *   LOG:   project_events.re_exported (Supabase)
 */
export async function reExportAction(
  projectId: string,
): Promise<{ error?: string; path?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  // Read from active revision — the single source of truth
  if (!p.current_revision_id) {
    return { error: "No active version found. Re-process the intake first." };
  }

  const { data: rev } = await supabase
    .from("project_request_revisions")
    .select("request_data")
    .eq("id", p.current_revision_id)
    .single();

  if (!rev?.request_data) {
    return { error: "Active version has no request data. Re-process the intake." };
  }

  const request = syncDraftWithSelectedModules(
    { ...(rev.request_data as Record<string, unknown>) },
    getAuthoritativeSelectedModules(p),
  );

  // Validate request integrity
  const missingFields = REQUIRED_DRAFT_KEYS.filter((key) => !(key in request));
  if (missingFields.length > 0) {
    return { error: `Cannot export: active version is missing required fields: ${missingFields.join(", ")}. Re-process the intake to fix.` };
  }

  const services = Array.isArray(request.services) ? request.services : [];
  if (services.length === 0) {
    return { error: "Cannot export: services list is empty. Add services before exporting." };
  }

  // Write to canonical target path
  const repoRoot = join(process.cwd(), "../..");
  const targetDir = join(repoRoot, "generated", p.slug);
  const targetPath = join(targetDir, "client-request.json");
  const siteDir = join(targetDir, "site");

  try {
    await mkdir(targetDir, { recursive: true });

    // Download revision-attached assets to site/public/images/
    const galleryImages = await downloadRevisionAssetsToSite(
      supabase, p.current_revision_id, siteDir,
    );

    if (galleryImages.length > 0) {
      const content = (request.content ?? {}) as Record<string, unknown>;
      content.galleryImages = galleryImages;
      request.content = content;
    }

    await writeFile(targetPath, JSON.stringify(request, null, 2) + "\n", "utf-8");
  } catch (err) {
    return { error: `Failed to write client-request.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  console.log(`[re-export] project=${projectId} slug=${p.slug} status=${p.status} source=revision path=${targetPath}`);

  // Update exported revision pointer
  if (p.current_revision_id) {
    await supabase
      .from("projects")
      .update({ last_exported_revision_id: p.current_revision_id })
      .eq("id", projectId);
  }

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "re_exported",
    from_status: p.status,
    to_status: p.status,
    metadata: {
      output_path: targetPath,
      triggered_by: user.id,
      request_source: "revision",
      revision_id: p.current_revision_id,
      request_keys: Object.keys(request),
      services_count: services.length,
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { path: targetPath };
}

// ── Recovery: Re-process intake from any status ──────────────────────

/**
 * Re-runs intake processing on an existing project to repair corrupted
 * or stale derived data (draft, missing-info, recommendations, summary).
 *
 * Works from ANY status. Does NOT change the project status.
 * Fresh draft is merged with existing user edits (user edits win).
 */
export async function reprocessIntakeAction(
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  const { data: assets } = await supabase
    .from("assets")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const assetList = (assets ?? []) as Asset[];

  // Run intake processing to get fresh derived data
  const result = processIntake(p, assetList);

  // Merge: fresh draft as base, existing user edits override
  const existingDraft = (p.draft_request as Record<string, unknown>) ?? {};
  const merged = deepMergeDraft(result.draftRequest, existingDraft);

  // Ensure safe defaults are present
  const seededModules = getAuthoritativeSelectedModules({
    selected_modules: p.selected_modules,
    recommendations: p.recommendations ?? result.recommendations,
  });
  const fallbackSeed = seededModules.length > 0 ? seededModules : seedSelectedModulesFromRecommendations(result.recommendations);
  const finalDraft = syncDraftWithSelectedModules(ensureDraftDefaults(merged), fallbackSeed);

  console.log(`[reprocess] project=${projectId} status=${p.status}`,
    `\n  fresh keys: [${Object.keys(result.draftRequest).join(", ")}]`,
    `\n  existing keys: [${Object.keys(existingDraft).join(", ")}]`,
    `\n  merged keys: [${Object.keys(finalDraft).join(", ")}]`);

  const { error: updateError } = await supabase
    .from("projects")
    .update({
      // Do NOT change status — this is a data repair
      client_summary: result.clientSummary,
      draft_request: finalDraft, // legacy sync
      missing_info: result.missingInfo,
      recommendations: result.recommendations,
      selected_modules: fallbackSeed,
      // Invalidate downstream pointers — the new revision hasn't been
      // exported/generated/reviewed yet, so those artifacts are stale
      last_exported_revision_id: null,
      last_generated_revision_id: null,
      last_reviewed_revision_id: null,
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  // Create revision from reprocessed draft
  await createRevisionAndSetCurrent(
    supabase, projectId, "intake_processor", finalDraft,
    p.current_revision_id, "Re-processed intake (merged with existing edits)",
  );

  // Clean stale disk artifacts that no longer match the active revision
  await removeGeneratedTargets(p.slug, [
    ["client-request.json"],
    ["artifacts", "prompt.txt"],
    ["artifacts", "screenshots"],
  ]);

  await deleteReviewScreenshotAssets(supabase, projectId);

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "intake_reprocessed",
    from_status: p.status,
    to_status: p.status,
    metadata: {
      triggered_by: user.id,
      reason: "manual recovery",
      merged_keys: Object.keys(finalDraft),
      services_count: Array.isArray(finalDraft.services) ? (finalDraft.services as unknown[]).length : 0,
      selected_modules: fallbackSeed.map((m) => m.id),
      invalidated: ["export", "generate", "review", "screenshots"],
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Recovery: Reset status to draft ready ────────────────────────────

/**
 * Resets the project status to intake_draft_ready so the user can
 * re-approve and re-export. Useful for stuck projects.
 */
export async function resetToDraftAction(
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  // Clear downstream DB state that is no longer trustworthy
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      status: "intake_draft_ready",
      final_request: null,
      // Clear downstream revision pointers (keep current_revision_id)
      last_exported_revision_id: null,
      last_generated_revision_id: null,
      last_reviewed_revision_id: null,
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  // Clean downstream artifacts on disk
  await removeGeneratedTargets(p.slug, [
    ["client-request.json"],
    ["artifacts", "screenshots"],
    ["artifacts", "validation.json"],
    ["artifacts", "prompt.txt"],
    ["site", "public", "images"],
    ["site", ".next"],
  ]);

  await deleteReviewScreenshotAssets(supabase, projectId);

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "status_reset",
    from_status: p.status,
    to_status: "intake_draft_ready",
    metadata: {
      triggered_by: user.id,
      reason: "manual reset to draft",
      cleared: ["client-request.json", "screenshots", "screenshot_assets", "validation", "build_cache", "site_images"],
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Project diagnostics ──────────────────────────────────────────────

export async function getProjectDiagnosticsAction(
  projectId: string,
  slug: string,
): Promise<ProjectDiagnostics> {
  const supabase = await createClient();

  // Load project + assets in parallel
  const [
    { data: project },
    { data: assets },
    { data: events },
    { data: jobs },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).single(),
    supabase.from("assets").select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
    supabase.from("project_events").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
    supabase.from("jobs").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(20),
  ]);

  const p = project as Project | null;
  const assetList = (assets ?? []) as Asset[];
  const eventList = (events ?? []) as Array<{ event_type: string; created_at: string }>;
  const jobList = (jobs ?? []) as JobRecord[];

  const fileDiag = await readGeneratedFileFlags(slug);

  return buildProjectDiagnostics(
    supabase,
    projectId,
    p,
    assetList,
    eventList,
    jobList,
    fileDiag,
  );
}

// ── Phase 3B: Export prompt.txt ──────────────────────────────────────

/**
 * Generate and write prompt.txt — a single artifact containing everything
 * needed for Codex/OpenClaw to produce a polished client-request.json.
 *
 * Writes to: generated/<slug>/artifacts/prompt.txt
 */
export async function exportPromptAction(
  projectId: string,
): Promise<{ error?: string; path?: string; content?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  // Read from active revision (single source of truth)
  let draft: Record<string, unknown> | null = null;
  let promptSource: "revision" | "draft_request" = "revision";
  if (p.current_revision_id) {
    const { data: rev } = await supabase
      .from("project_request_revisions")
      .select("request_data")
      .eq("id", p.current_revision_id)
      .single();
    draft = (rev?.request_data as Record<string, unknown>) ?? null;
  }
  // Legacy fallback (pre-migration projects only)
  if (!draft) {
    draft = (p.draft_request as Record<string, unknown>) ?? null;
    promptSource = "draft_request";
  }
  if (!draft) {
    return { error: "No request data found. Process the intake first." };
  }

  console.log(`[prompt-export] project=${projectId} source=${promptSource} revision=${p.current_revision_id ?? "none"}`);

  // Validate draft has minimum required fields
  const missingFields = REQUIRED_DRAFT_KEYS.filter((key) => !(key in draft));
  if (missingFields.length > 0) {
    return { error: `Cannot export prompt: draft is missing required fields: ${missingFields.join(", ")}` };
  }

  // Generate the prompt
  const { generatePrompt } = await import("@/lib/generate-prompt");

  const promptContent = generatePrompt({
    project: {
      name: p.name,
      slug: p.slug,
      businessType: p.business_type,
      contactName: p.contact_name,
      contactEmail: p.contact_email,
      contactPhone: p.contact_phone,
      notes: p.notes,
    },
    draftRequest: draft,
    recommendations: p.recommendations as {
      template: { id: string; name: string; reasoning: string };
      modules: Array<{ id: string; name: string; reasoning: string }>;
    } | null,
    selectedModules: getAuthoritativeSelectedModules(p),
    clientSummary: p.client_summary,
    missingInfo: p.missing_info as Array<{ field: string; severity: string; hint: string }> | null,
  });

  // Write prompt.txt to artifacts dir
  const repoRoot = join(process.cwd(), "../..");
  const artifactsDir = join(repoRoot, "generated", p.slug, "artifacts");
  const promptPath = join(artifactsDir, "prompt.txt");

  try {
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(promptPath, promptContent, "utf-8");
  } catch (err) {
    return { error: `Failed to write prompt.txt: ${err instanceof Error ? err.message : String(err)}` };
  }

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "prompt_exported",
    from_status: p.status,
    to_status: p.status,
    metadata: {
      output_path: promptPath,
      triggered_by: user.id,
      prompt_length: promptContent.length,
      request_source: promptSource,
      revision_id: p.current_revision_id ?? null,
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { path: promptPath, content: promptContent };
}

// ── Phase 3B: Import final client-request.json ──────────────────────

/**
 * Import an AI-improved client-request.json as the canonical generation input.
 * Validates against the schema, stores in DB as final_request, and writes
 * to disk so the generator can use it.
 */
export async function importFinalRequestAction(
  projectId: string,
  jsonContent: string,
): Promise<{ error?: string; validationErrors?: string[] }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;

  // Parse the JSON
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (err) {
    return { error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "Expected a JSON object, not an array or primitive." };
  }

  // Validate required structure
  const errors: string[] = [];
  if (parsed.version !== "1.0.0") {
    errors.push(`version must be "1.0.0", got "${parsed.version ?? "missing"}"`);
  }
  if (!parsed.business || typeof parsed.business !== "object") {
    errors.push("missing required field: business");
  } else {
    const biz = parsed.business as Record<string, unknown>;
    if (!biz.name) errors.push("missing required field: business.name");
    if (!biz.type) errors.push("missing required field: business.type");
  }
  if (!parsed.contact || typeof parsed.contact !== "object") {
    errors.push("missing required field: contact");
  }
  if (!Array.isArray(parsed.services)) {
    errors.push("missing required field: services (must be an array)");
  } else if (parsed.services.length === 0) {
    errors.push("services array must not be empty");
  }

  if (errors.length > 0) {
    return { error: "Validation failed", validationErrors: errors };
  }

  const syncedParsed = syncDraftWithSelectedModules(parsed, getAuthoritativeSelectedModules(p));

  // Create revision as the primary store (revision is the source of truth)
  await createRevisionAndSetCurrent(
    supabase, projectId, "ai_import", syncedParsed,
    p.current_revision_id, "AI-improved import from Codex/OpenClaw",
  );

  // Sync to legacy draft_request column (final_request no longer used)
  await supabase
    .from("projects")
    .update({ draft_request: syncedParsed })
    .eq("id", projectId);

  // Also write to disk as the canonical client-request.json for the generator
  const repoRoot = join(process.cwd(), "../..");
  const targetDir = join(repoRoot, "generated", p.slug);
  const targetPath = join(targetDir, "client-request.json");

  try {
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, JSON.stringify(syncedParsed, null, 2) + "\n", "utf-8");
  } catch (err) {
    return { error: `Saved to DB but failed to write to disk: ${err instanceof Error ? err.message : String(err)}` };
  }

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "final_request_imported",
    from_status: p.status,
    to_status: p.status,
    metadata: {
      triggered_by: user.id,
      output_path: targetPath,
      services_count: (syncedParsed.services as unknown[]).length,
      selected_modules: getAuthoritativeSelectedModules(p).map((m) => m.id),
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Phase 3B: Check which request source is canonical ────────────────

export async function getRequestSourceAction(
  projectId: string,
): Promise<{ source: "revision" | "draft" | "none"; hasRevision: boolean; hasDraft: boolean }> {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("current_revision_id, draft_request")
    .eq("id", projectId)
    .single();

  if (!project) return { source: "none", hasRevision: false, hasDraft: false };

  const hasRevision = project.current_revision_id !== null;
  const hasDraft = project.draft_request !== null;

  return {
    source: hasRevision ? "revision" : hasDraft ? "draft" : "none",
    hasRevision,
    hasDraft,
  };
}

// ── Revision CRUD actions ────────────────────────────────────────────

/**
 * List all revisions for a project, most recent first.
 */
export async function listRevisionsAction(
  projectId: string,
): Promise<{ revisions: RequestRevision[]; error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { revisions: [], error: "Not authenticated" };

  try {
    const { data, error } = await supabase
      .from("project_request_revisions")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) return { revisions: [], error: error.message };
    return { revisions: (data ?? []) as RequestRevision[] };
  } catch {
    return { revisions: [], error: "Revisions table not available (migration pending)" };
  }
}

/**
 * Set a specific revision as the current/active one.
 */
export async function setActiveRevisionAction(
  projectId: string,
  revisionId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Verify the revision belongs to this project
  const { data: rev, error: revErr } = await supabase
    .from("project_request_revisions")
    .select("id, project_id, request_data")
    .eq("id", revisionId)
    .single();

  if (revErr || !rev) return { error: "Revision not found" };
  if (rev.project_id !== projectId) return { error: "Revision does not belong to this project" };

  // Update project pointer + sync legacy column
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      current_revision_id: revisionId,
      draft_request: rev.request_data,
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "revision_activated",
    from_status: null,
    to_status: null,
    metadata: { revision_id: revisionId, triggered_by: user.id },
  });

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── Project lifecycle operations ────────────────────────────────────

export async function duplicateProjectAction(
  projectId: string,
  variantLabel?: string | null,
): Promise<{ error?: string; projectId?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const sourceProject = project as Project;
  const { draft, revisionId, error: draftError } = await loadCurrentDraft(supabase, projectId);
  if (draftError) return { error: draftError };
  const selectedModules = getAuthoritativeSelectedModules(sourceProject);
  const syncedDraft = syncDraftWithSelectedModules(draft, selectedModules);

  const identity = await allocateVariantIdentity(supabase, {
    id: sourceProject.id,
    name: sourceProject.name,
    slug: sourceProject.slug,
    variant_of: sourceProject.variant_of,
  }, variantLabel ?? null);

  const { data: duplicatedProject, error: insertError } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      client_id: sourceProject.client_id,
      variant_of: identity.lineageRootId,
      variant_label: identity.variantLabel,
      name: identity.name,
      slug: identity.slug,
      status: "intake_draft_ready",
      contact_name: sourceProject.contact_name,
      contact_email: sourceProject.contact_email,
      contact_phone: sourceProject.contact_phone,
      business_type: sourceProject.business_type,
      notes: sourceProject.notes,
      client_summary: sourceProject.client_summary,
      draft_request: syncedDraft,
      selected_modules: selectedModules,
      missing_info: sourceProject.missing_info,
      recommendations: sourceProject.recommendations,
      final_request: null,
      current_revision_id: null,
      last_exported_revision_id: null,
      last_generated_revision_id: null,
      last_reviewed_revision_id: null,
    })
    .select("id, slug")
    .single();

  if (insertError || !duplicatedProject) {
    return { error: insertError?.message ?? "Failed to duplicate project." };
  }

  const duplicatedRevisionId = await createRevisionAndSetCurrent(
    supabase,
    duplicatedProject.id,
    "manual",
    syncedDraft,
    null,
    `Duplicated from ${sourceProject.slug}`,
  );

  await supabase.from("project_events").insert([
    {
      project_id: sourceProject.id,
      event_type: "project_variant_created",
      from_status: sourceProject.status,
      to_status: sourceProject.status,
      metadata: {
        created_project_id: duplicatedProject.id,
        created_slug: duplicatedProject.slug,
        variant_label: identity.variantLabel,
        source_revision_id: revisionId,
        selected_modules: selectedModules.map((module) => module.id),
        triggered_by: user.id,
      },
    },
    {
      project_id: duplicatedProject.id,
      event_type: "project_duplicated",
      from_status: null,
      to_status: "intake_draft_ready",
      metadata: {
        source_project_id: sourceProject.id,
        source_slug: sourceProject.slug,
        source_revision_id: revisionId,
        variant_of: identity.lineageRootId,
        variant_label: identity.variantLabel,
        selected_modules: selectedModules.map((module) => module.id),
        duplicated_revision_id: duplicatedRevisionId,
        triggered_by: user.id,
      },
    },
  ]);

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/dashboard/projects/${duplicatedProject.id}`);
  return { projectId: duplicatedProject.id };
}

export async function archiveProjectAction(
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("id, status, archived_at")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };
  if (project.archived_at) return {};

  const { error } = await supabase
    .from("projects")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: user.id,
    })
    .eq("id", projectId);

  if (error) return { error: error.message };

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "project_archived",
    from_status: project.status,
    to_status: project.status,
    metadata: { archived_by: user.id },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

export async function restoreProjectAction(
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("id, status, archived_at")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };
  if (!project.archived_at) return {};

  const { error } = await supabase
    .from("projects")
    .update({
      archived_at: null,
      archived_by: null,
    })
    .eq("id", projectId);

  if (error) return { error: error.message };

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "project_restored",
    from_status: project.status,
    to_status: project.status,
    metadata: { restored_by: user.id },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

export async function purgeProjectAction(
  projectId: string,
  confirmSlug: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const p = project as Project;
  if (confirmSlug.trim() !== p.slug) {
    return { error: "Slug confirmation does not match." };
  }

  await purgeProjectResources(supabase, user.id, p);

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return {};
}

export async function bulkArchiveProjectsAction(
  projectIds: string[],
): Promise<{ error?: string; count?: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return { error: "No projects selected." };

  const { data: projects } = await supabase
    .from("projects")
    .select("id, status, archived_at")
    .in("id", ids);

  const active = (projects ?? []).filter((project) => !project.archived_at);
  if (active.length === 0) return { count: 0 };

  const { error } = await supabase
    .from("projects")
    .update({ archived_at: new Date().toISOString(), archived_by: user.id })
    .in("id", active.map((project) => project.id));

  if (error) return { error: error.message };

  await supabase.from("project_events").insert(
    active.map((project) => ({
      project_id: project.id,
      event_type: "project_archived",
      from_status: project.status,
      to_status: project.status,
      metadata: { archived_by: user.id, source: "dashboard_bulk" },
    })),
  );

  revalidatePath("/dashboard");
  return { count: active.length };
}

export async function bulkRestoreProjectsAction(
  projectIds: string[],
): Promise<{ error?: string; count?: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return { error: "No projects selected." };

  const { data: projects } = await supabase
    .from("projects")
    .select("id, status, archived_at")
    .in("id", ids);

  const archived = (projects ?? []).filter((project) => !!project.archived_at);
  if (archived.length === 0) return { count: 0 };

  const { error } = await supabase
    .from("projects")
    .update({ archived_at: null, archived_by: null })
    .in("id", archived.map((project) => project.id));

  if (error) return { error: error.message };

  await supabase.from("project_events").insert(
    archived.map((project) => ({
      project_id: project.id,
      event_type: "project_restored",
      from_status: project.status,
      to_status: project.status,
      metadata: { restored_by: user.id, source: "dashboard_bulk" },
    })),
  );

  revalidatePath("/dashboard");
  return { count: archived.length };
}

export async function bulkPurgeProjectsAction(
  projectIds: string[],
  confirmationPhrase: string,
): Promise<{ error?: string; count?: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return { error: "No projects selected." };

  const expected = `DELETE ${ids.length} PROJECT${ids.length === 1 ? "" : "S"}`;
  if (confirmationPhrase.trim() !== expected) {
    return { error: `Confirmation phrase must exactly match "${expected}".` };
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .in("id", ids);

  const records = (projects ?? []) as Project[];
  for (const project of records) {
    await purgeProjectResources(supabase, user.id, project);
    const { error } = await supabase.from("projects").delete().eq("id", project.id);
    if (error) return { error: error.message };
  }

  revalidatePath("/dashboard");
  return { count: records.length };
}
