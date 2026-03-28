"use server";

import { createClient } from "@/lib/supabase/server";
import { processIntake, detectMissingInfo } from "@/lib/intake-processor";
import { notifyDiscord } from "@/lib/discord";
import { revalidatePath } from "next/cache";
import { writeFile, mkdir, access, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { spawn, execSync } from "node:child_process";
import type { Project, Asset, JobRecord, RequestRevision } from "@/lib/types";
import type { RevisionSource } from "@/lib/revision-helpers";
import { isRevisionStale } from "@/lib/revision-helpers";
import {
  REQUIRED_DRAFT_KEYS,
  DRAFT_DEFAULTS,
  deepMergeDraft,
  deepSetServer,
  validateDraftRequired,
  ensureDraftDefaults,
} from "@/lib/draft-helpers";

// ── Revision helpers (internal) ──────────────────────────────────────

/**
 * Create a revision and set it as the current one.
 * Silently skips if the revisions table doesn't exist yet (pre-migration).
 */
async function createRevisionAndSetCurrent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  source: RevisionSource,
  requestData: Record<string, unknown>,
  parentRevisionId?: string | null,
  summary?: string | null,
): Promise<string | null> {
  try {
    const { data: rev, error } = await supabase
      .from("project_request_revisions")
      .insert({
        project_id: projectId,
        source,
        request_data: requestData,
        parent_revision_id: parentRevisionId ?? null,
        summary: summary ?? null,
      })
      .select("id")
      .single();

    if (error || !rev) return null;

    await supabase
      .from("projects")
      .update({ current_revision_id: rev.id })
      .eq("id", projectId);

    return rev.id;
  } catch {
    // Table may not exist yet (pre-migration) — silently skip
    return null;
  }
}

/**
 * Download assets attached to a revision from Supabase storage into
 * generated/<slug>/site/public/images/ so the generated site can serve them.
 * Returns an array of gallery image entries for client-request.json.
 */
async function downloadRevisionAssetsToSite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  revisionId: string | null,
  projectId: string,
  siteDir: string,
): Promise<Array<{ url: string; alt: string }>> {
  if (!revisionId) return [];

  const imagesDir = join(siteDir, "public", "images");

  // Clean previous images
  await rm(imagesDir, { recursive: true, force: true });
  await mkdir(imagesDir, { recursive: true });

  // Get attached image assets for this revision
  let attachedAssetIds: string[] = [];
  try {
    const { data: revAssets } = await supabase
      .from("revision_assets")
      .select("asset_id, role, sort_order")
      .eq("revision_id", revisionId)
      .order("sort_order", { ascending: true });

    attachedAssetIds = (revAssets ?? []).map((ra) => ra.asset_id);
  } catch {
    // revision_assets table may not exist yet
  }

  // Only use explicitly attached images — no silent fallback
  let assets: Array<{ id: string; file_name: string; storage_path: string; category: string }> = [];
  if (attachedAssetIds.length > 0) {
    const { data } = await supabase
      .from("assets")
      .select("id, file_name, storage_path, category")
      .in("id", attachedAssetIds);
    assets = (data ?? []).filter((a) => a.category === "image");
  }

  const galleryImages: Array<{ url: string; alt: string }> = [];

  for (const asset of assets) {
    try {
      const { data, error } = await supabase.storage
        .from("intake-assets")
        .download(asset.storage_path);

      if (error || !data) {
        console.error(`Failed to download asset ${asset.file_name}:`, error?.message);
        continue;
      }

      const localPath = join(imagesDir, asset.file_name);
      const buffer = Buffer.from(await data.arrayBuffer());
      await writeFile(localPath, buffer);

      galleryImages.push({
        url: `/images/${asset.file_name}`,
        alt: asset.file_name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
      });
    } catch (err) {
      console.error(`Error downloading asset ${asset.file_name}:`, err);
    }
  }

  return galleryImages;
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

  // Transition: intake_received → intake_processing → intake_draft_ready
  // (processing is synchronous here, so we go straight to draft_ready)
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      status: "intake_draft_ready",
      client_summary: result.clientSummary,
      draft_request: result.draftRequest,
      missing_info: result.missingInfo,
      recommendations: result.recommendations,
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  // Create revision from the processed draft
  await createRevisionAndSetCurrent(
    supabase, projectId, "intake_processor", result.draftRequest,
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
      supabase, p.current_revision_id, projectId, siteDir,
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

/**
 * Load the current request data from the active revision.
 * Falls back to draft_request only for pre-migration projects.
 */
async function loadCurrentDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<{ draft: Record<string, unknown>; revisionId: string | null; error?: string }> {
  const { data: project, error } = await supabase
    .from("projects")
    .select("current_revision_id, draft_request")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    return { draft: { ...DRAFT_DEFAULTS }, revisionId: null, error: error?.message ?? "Project not found" };
  }

  // Primary: load from active revision
  if (project.current_revision_id) {
    try {
      const { data: rev } = await supabase
        .from("project_request_revisions")
        .select("request_data")
        .eq("id", project.current_revision_id)
        .single();
      if (rev?.request_data) {
        return {
          draft: ensureDraftDefaults(rev.request_data as Record<string, unknown>),
          revisionId: project.current_revision_id,
        };
      }
    } catch { /* fall through to legacy */ }
  }

  // Legacy fallback for pre-migration projects
  const existing = (project.draft_request as Record<string, unknown>) ?? {};
  return { draft: ensureDraftDefaults(existing), revisionId: null };
}

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

  const { draft: current, revisionId: currentRevId, error: loadError } = await loadCurrentDraft(supabase, projectId);
  if (loadError) return { error: loadError };

  // Apply patch
  const merged = deepSetServer(current, path, value);

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

  // Load current from revision to merge with (preserves fields not in the incoming object)
  const { draft: current, revisionId: currentRevId, error: loadError } = await loadCurrentDraft(supabase, projectId);
  if (loadError) return { error: loadError };

  // Merge: incoming overrides current, but current fills gaps
  const merged = deepMergeDraft(current, draftRequest);

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

function categorizeFile(mimeType: string): string {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/") || mimeType === "application/pdf") return "document";
  return "general";
}

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
    created_at: string;
  }>;
  error?: string;
}> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { screenshots: [], error: "Not authenticated" };

  let query = supabase
    .from("assets")
    .select("id, file_name, storage_path, source_job_id, request_revision_id, created_at")
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
 * Spawn the worker process to execute a job.
 * Rebuilds worker + generator dist before spawning so the worker
 * always runs the latest compiled code (prevents split-brain where
 * TypeScript source is fixed but dist is stale).
 */
function spawnWorker(jobId: string): void {
  const repoRoot = join(process.cwd(), "../..");

  // Rebuild worker and generator to ensure compiled code matches source.
  // Fast (~1-2s for tsc on small packages). Blocks the server action
  // briefly, but guarantees the spawned process uses fresh code.
  try {
    execSync(
      "pnpm --filter @vaen/worker --filter @vaen/generator build",
      { cwd: repoRoot, stdio: "pipe", timeout: 30_000 },
    );
  } catch (err) {
    // Log but don't fail — stale dist is better than no worker at all.
    console.error("[portal] Pre-spawn build failed:", err instanceof Error ? err.message : err);
  }

  const workerScript = join(repoRoot, "apps", "worker", "dist", "run-job.js");

  const child = spawn("node", [workerScript, jobId], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      // Pass Supabase creds to the worker (service role for DB access)
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });

  child.unref();
}

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

  const revisionData = { ...(rev.request_data as Record<string, unknown>) };
  const repoRoot = join(process.cwd(), "../..");
  const targetDir = join(repoRoot, "generated", p.slug);
  const clientRequestPath = join(targetDir, "client-request.json");
  const siteDir = join(targetDir, "site");

  try {
    await mkdir(targetDir, { recursive: true });

    // Download revision-attached assets to site/public/images/
    const galleryImages = await downloadRevisionAssetsToSite(
      supabase, p.current_revision_id, projectId, siteDir,
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
}> {
  const repoRoot = join(process.cwd(), "../..");
  const result = {
    hasClientRequest: false,
    hasWorkspace: false,
    hasSiteBuild: false,
    hasScreenshots: false,
    screenshotCount: 0,
    screenshotNames: [] as string[],
  };

  try {
    await access(join(repoRoot, "generated", slug, "client-request.json"));
    result.hasClientRequest = true;
  } catch { /* noop */ }

  try {
    await access(join(repoRoot, "generated", slug, "site", "config.json"));
    result.hasWorkspace = true;
  } catch { /* noop */ }

  try {
    await access(join(repoRoot, "generated", slug, "site", ".next"));
    result.hasSiteBuild = true;
  } catch { /* noop */ }

  try {
    const dir = join(repoRoot, "generated", slug, "artifacts", "screenshots");
    const files = await readdir(dir);
    const pngs = files.filter((f) => f.endsWith(".png")).sort();
    result.hasScreenshots = pngs.length > 0;
    result.screenshotCount = pngs.length;
    result.screenshotNames = pngs;
  } catch { /* noop */ }

  return result;
}

/**
 * Read a screenshot file and return it as a base64 data URL.
 * Used by the inline screenshot viewer.
 */
export async function getScreenshotAction(
  slug: string,
  filename: string,
): Promise<{ error?: string; dataUrl?: string }> {
  // Sanitize filename to prevent path traversal
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe.endsWith(".png")) {
    return { error: "Invalid filename" };
  }

  const repoRoot = join(process.cwd(), "../..");
  const filepath = join(repoRoot, "generated", slug, "artifacts", "screenshots", safe);

  try {
    const data = await readFile(filepath);
    const b64 = data.toString("base64");
    return { dataUrl: `data:image/png;base64,${b64}` };
  } catch {
    return { error: "Screenshot not found" };
  }
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

  const request = { ...(rev.request_data as Record<string, unknown>) };

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
      supabase, p.current_revision_id, projectId, siteDir,
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
  const finalDraft = ensureDraftDefaults(merged);

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
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  // Create revision from reprocessed draft
  await createRevisionAndSetCurrent(
    supabase, projectId, "intake_processor", finalDraft,
    p.current_revision_id, "Re-processed intake (merged with existing edits)",
  );

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
  const repoRoot = join(process.cwd(), "../..");
  const generatedDir = join(repoRoot, "generated", p.slug);
  const cleanTargets = [
    join(generatedDir, "client-request.json"),
    join(generatedDir, "artifacts", "screenshots"),
    join(generatedDir, "artifacts", "validation.json"),
    join(generatedDir, "artifacts", "prompt.txt"),
    join(generatedDir, "site", "public", "images"),
    join(generatedDir, "site", ".next"),
  ];
  for (const target of cleanTargets) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
  }

  // Delete screenshot asset records from DB (they point to stale data)
  await supabase
    .from("assets")
    .delete()
    .eq("project_id", projectId)
    .eq("asset_type", "review_screenshot");

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

export interface ProjectDiagnostics {
  draft: {
    exists: boolean;
    hasVersion: boolean;
    hasBusiness: boolean;
    hasContact: boolean;
    hasServices: boolean;
    servicesCount: number;
    topLevelKeys: string[];
  };
  requestSource: "final" | "draft" | "none";
  hasFinalRequest: boolean;
  files: {
    hasExportedRequest: boolean;
    hasWorkspace: boolean;
    hasBuild: boolean;
    hasScreenshots: boolean;
    screenshotCount: number;
    hasPromptTxt: boolean;
  };
  jobs: {
    lastGenerate: { id: string; status: string; completedAt: string | null } | null;
    lastReview: { id: string; status: string; completedAt: string | null } | null;
  };
  timestamps: {
    lastProcessedAt: string | null;
    lastExportedAt: string | null;
    lastGeneratedAt: string | null;
    lastReviewedAt: string | null;
  };
  /** Whether screenshots are stale (older than last generate or no review after generate) */
  screenshotsStale: boolean;
  liveMissingInfo: Array<{ field: string; label: string; severity: string; hint?: string }>;
  /** Revision-based staleness (null if revisions not yet migrated) */
  revisions: {
    count: number;
    currentSource: string | null;
    exportStale: boolean;
    generateStale: boolean;
    reviewStale: boolean;
  } | null;
}

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

  // Draft diagnostics
  const draftObj = (p?.draft_request as Record<string, unknown>) ?? null;
  const draftDiag = {
    exists: draftObj !== null,
    hasVersion: !!(draftObj?.version),
    hasBusiness: !!(draftObj?.business),
    hasContact: !!(draftObj?.contact),
    hasServices: Array.isArray(draftObj?.services) && (draftObj.services as unknown[]).length > 0,
    servicesCount: Array.isArray(draftObj?.services) ? (draftObj.services as unknown[]).length : 0,
    topLevelKeys: draftObj ? Object.keys(draftObj) : [],
  };

  // Request source
  const hasFinalRequest = p?.final_request !== null && p?.final_request !== undefined;
  const requestSource = hasFinalRequest ? "final" as const : draftDiag.exists ? "draft" as const : "none" as const;

  // File diagnostics (check disk)
  const repoRoot = join(process.cwd(), "../..");
  const fileDiag = {
    hasExportedRequest: false,
    hasWorkspace: false,
    hasBuild: false,
    hasScreenshots: false,
    screenshotCount: 0,
    hasPromptTxt: false,
  };

  try { await access(join(repoRoot, "generated", slug, "client-request.json")); fileDiag.hasExportedRequest = true; } catch { /* noop */ }
  try { await access(join(repoRoot, "generated", slug, "site", "config.json")); fileDiag.hasWorkspace = true; } catch { /* noop */ }
  try { await access(join(repoRoot, "generated", slug, "site", ".next")); fileDiag.hasBuild = true; } catch { /* noop */ }
  try { await access(join(repoRoot, "generated", slug, "artifacts", "prompt.txt")); fileDiag.hasPromptTxt = true; } catch { /* noop */ }
  try {
    const dir = join(repoRoot, "generated", slug, "artifacts", "screenshots");
    const files = await readdir(dir);
    const pngs = files.filter((f: string) => f.endsWith(".png"));
    fileDiag.hasScreenshots = pngs.length > 0;
    fileDiag.screenshotCount = pngs.length;
  } catch { /* noop */ }

  // Job diagnostics
  const lastGenerate = jobList.find((j) => j.job_type === "generate") ?? null;
  const lastReview = jobList.find((j) => j.job_type === "review") ?? null;

  // Timestamp diagnostics
  const lastProcessedEvent = eventList.find((e) => e.event_type === "intake_processed" || e.event_type === "intake_reprocessed");
  const lastExportedEvent = eventList.find((e) => e.event_type === "exported_to_generator" || e.event_type === "re_exported");
  const lastGeneratedAt = lastGenerate?.completed_at ?? null;
  const lastReviewedAt = lastReview?.completed_at ?? null;

  // Screenshots are stale if there was a generate after the last review
  const screenshotsStale = (() => {
    if (!fileDiag.hasScreenshots) return false;
    if (!lastGeneratedAt) return false;
    if (!lastReviewedAt) return true; // screenshots exist but no review job — stale
    return new Date(lastGeneratedAt) > new Date(lastReviewedAt);
  })();

  // Live missing info (recomputed from current state)
  const liveMissing = p ? detectMissingInfo(p, assetList) : [];

  // Revision diagnostics (null if table doesn't exist yet)
  let revisionDiag: ProjectDiagnostics["revisions"] = null;
  try {
    const { data: revisions, error: revErr } = await supabase
      .from("project_request_revisions")
      .select("id, source")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (!revErr && revisions && p) {
      const staleness = isRevisionStale(p);
      const currentRev = p.current_revision_id
        ? revisions.find((r) => r.id === p.current_revision_id)
        : null;
      revisionDiag = {
        count: revisions.length,
        currentSource: currentRev?.source ?? null,
        exportStale: staleness.exportStale,
        generateStale: staleness.generateStale,
        reviewStale: staleness.reviewStale,
      };
    }
  } catch { /* pre-migration: silently skip */ }

  return {
    draft: draftDiag,
    requestSource,
    hasFinalRequest,
    files: fileDiag,
    jobs: {
      lastGenerate: lastGenerate ? { id: lastGenerate.id, status: lastGenerate.status, completedAt: lastGenerate.completed_at } : null,
      lastReview: lastReview ? { id: lastReview.id, status: lastReview.status, completedAt: lastReview.completed_at } : null,
    },
    timestamps: {
      lastProcessedAt: lastProcessedEvent?.created_at ?? null,
      lastExportedAt: lastExportedEvent?.created_at ?? null,
      lastGeneratedAt,
      lastReviewedAt,
    },
    screenshotsStale,
    liveMissingInfo: liveMissing,
    revisions: revisionDiag,
  };
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

  // Read from active revision
  let draft: Record<string, unknown> | null = null;
  if (p.current_revision_id) {
    const { data: rev } = await supabase
      .from("project_request_revisions")
      .select("request_data")
      .eq("id", p.current_revision_id)
      .single();
    draft = (rev?.request_data as Record<string, unknown>) ?? null;
  }
  // Legacy fallback
  if (!draft) {
    draft = (p.draft_request as Record<string, unknown>) ?? null;
  }
  if (!draft) {
    return { error: "No request data found. Process the intake first." };
  }

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

  // Create revision as the primary store (revision is the source of truth)
  await createRevisionAndSetCurrent(
    supabase, projectId, "ai_import", parsed,
    p.current_revision_id, "AI-improved import from Codex/OpenClaw",
  );

  // Sync to legacy draft_request column (final_request no longer used)
  await supabase
    .from("projects")
    .update({ draft_request: parsed })
    .eq("id", projectId);

  // Also write to disk as the canonical client-request.json for the generator
  const repoRoot = join(process.cwd(), "../..");
  const targetDir = join(repoRoot, "generated", p.slug);
  const targetPath = join(targetDir, "client-request.json");

  try {
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
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
      services_count: (parsed.services as unknown[]).length,
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
