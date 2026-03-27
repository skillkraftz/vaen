"use server";

import { createClient } from "@/lib/supabase/server";
import { processIntake, detectMissingInfo } from "@/lib/intake-processor";
import { notifyDiscord } from "@/lib/discord";
import { revalidatePath } from "next/cache";
import { writeFile, mkdir, access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn, execSync } from "node:child_process";
import type { Project, Asset, JobRecord } from "@/lib/types";
import {
  REQUIRED_DRAFT_KEYS,
  DRAFT_DEFAULTS,
  deepMergeDraft,
  deepSetServer,
  validateDraftRequired,
  ensureDraftDefaults,
} from "@/lib/draft-helpers";

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

  // Validate the draft request has enough data
  const draft = p.draft_request as Record<string, unknown> | null;
  if (!draft) {
    return { error: "No draft request found. Process the intake first." };
  }

  const services = Array.isArray(draft.services) ? draft.services : [];
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

  // Prefer final_request (AI-improved) over draft_request
  const requestSource = (p as unknown as Record<string, unknown>).final_request ?? p.draft_request;
  const requestLabel = (p as unknown as Record<string, unknown>).final_request ? "final" : "draft";

  if (!requestSource) {
    return { error: "No client-request.json found. Process the intake first." };
  }

  // Validate integrity before export
  const draft = requestSource as Record<string, unknown>;

  // Ensure required fields exist (guard against past corruption)
  const missingFields = REQUIRED_DRAFT_KEYS.filter((key) => !(key in draft));
  if (missingFields.length > 0) {
    return { error: `Cannot export: ${requestLabel} request is missing required fields: ${missingFields.join(", ")}. Re-process the intake to fix.` };
  }

  const services = Array.isArray(draft.services) ? draft.services : [];
  if (services.length === 0) {
    return { error: `Cannot export: services list is empty. Add services before exporting.` };
  }

  // Write client-request.json to the canonical target path
  const repoRoot = join(process.cwd(), "../..");
  const targetDir = join(repoRoot, "generated", p.slug);
  const targetPath = join(targetDir, "client-request.json");

  try {
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, JSON.stringify(draft, null, 2) + "\n", "utf-8");
  } catch (err) {
    return { error: `Failed to write client-request.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Advance to intake_parsed (the next state after intake_approved)
  const { error: updateError } = await supabase
    .from("projects")
    .update({ status: "intake_parsed" })
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
      request_source: requestLabel,
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
 * Load the current draft_request from DB, ensuring safe defaults.
 */
async function loadCurrentDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<{ draft: Record<string, unknown>; error?: string }> {
  const { data: project, error } = await supabase
    .from("projects")
    .select("draft_request")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    return { draft: { ...DRAFT_DEFAULTS }, error: error?.message ?? "Project not found" };
  }

  const existing = (project.draft_request as Record<string, unknown>) ?? {};
  return { draft: ensureDraftDefaults(existing) };
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

  const { draft: current, error: loadError } = await loadCurrentDraft(supabase, projectId);
  if (loadError) return { error: loadError };

  // Apply patch
  const merged = deepSetServer(current, path, value);

  // Debug logging (temporary)
  console.log(`[draft-patch] project=${projectId} path=${path.join(".")}`,
    `\n  before keys: [${Object.keys(current).join(", ")}]`,
    `\n  after keys:  [${Object.keys(merged).join(", ")}]`);

  // Validate
  const validationError = validateDraftRequired(merged);
  if (validationError) return { error: validationError };

  // Save
  const { error: updateError } = await supabase
    .from("projects")
    .update({ draft_request: merged })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

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

  // Load current to merge with (preserves fields not in the incoming object)
  const { draft: current, error: loadError } = await loadCurrentDraft(supabase, projectId);
  if (loadError) return { error: loadError };

  // Merge: incoming overrides current, but current fills gaps
  const merged = deepMergeDraft(current, draftRequest);

  // Debug logging (temporary)
  console.log(`[draft-replace] project=${projectId}`,
    `\n  current keys: [${Object.keys(current).join(", ")}]`,
    `\n  incoming keys: [${Object.keys(draftRequest).join(", ")}]`,
    `\n  merged keys:  [${Object.keys(merged).join(", ")}]`);

  // Validate
  const validationError = validateDraftRequired(merged);
  if (validationError) return { error: validationError };

  const { error: updateError } = await supabase
    .from("projects")
    .update({ draft_request: merged })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// ── File management ──────────────────────────────────────────────────

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

  // Verify client-request.json exists at the canonical export path
  const repoRoot = join(process.cwd(), "../..");
  const clientRequestPath = join(repoRoot, "generated", p.slug, "client-request.json");
  try {
    await access(clientRequestPath);
  } catch {
    return { error: `client-request.json not found at generated/${p.slug}/. Run Export first.` };
  }

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

  if (!p.draft_request) {
    return { error: "No draft request found. Re-process the intake first." };
  }

  const draft = p.draft_request as Record<string, unknown>;

  // Validate draft integrity
  const missingFields = REQUIRED_DRAFT_KEYS.filter((key) => !(key in draft));
  if (missingFields.length > 0) {
    return { error: `Cannot export: draft is missing required fields: ${missingFields.join(", ")}. Re-process the intake to fix.` };
  }

  const services = Array.isArray(draft.services) ? draft.services : [];
  if (services.length === 0) {
    return { error: "Cannot export: services list is empty. Add services before exporting." };
  }

  // Write to canonical target path
  const repoRoot = join(process.cwd(), "../..");
  const targetDir = join(repoRoot, "generated", p.slug);
  const targetPath = join(targetDir, "client-request.json");

  try {
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, JSON.stringify(draft, null, 2) + "\n", "utf-8");
  } catch (err) {
    return { error: `Failed to write client-request.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  console.log(`[re-export] project=${projectId} slug=${p.slug} status=${p.status} path=${targetPath}`);

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "re_exported",
    from_status: p.status,
    to_status: p.status,
    metadata: {
      output_path: targetPath,
      triggered_by: user.id,
      draft_keys: Object.keys(draft),
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
      draft_request: finalDraft,
      missing_info: result.missingInfo,
      recommendations: result.recommendations,
    })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

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
    .select("status")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };

  const { error: updateError } = await supabase
    .from("projects")
    .update({ status: "intake_draft_ready" })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

  await supabase.from("project_events").insert({
    project_id: projectId,
    event_type: "status_reset",
    from_status: project.status,
    to_status: "intake_draft_ready",
    metadata: { triggered_by: user.id, reason: "manual reset to draft" },
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
  files: {
    hasExportedRequest: boolean;
    hasWorkspace: boolean;
    hasBuild: boolean;
    hasScreenshots: boolean;
    screenshotCount: number;
  };
  jobs: {
    lastGenerate: { id: string; status: string; completedAt: string | null } | null;
    lastReview: { id: string; status: string; completedAt: string | null } | null;
  };
  timestamps: {
    lastProcessedAt: string | null;
    lastExportedAt: string | null;
  };
  liveMissingInfo: Array<{ field: string; label: string; severity: string; hint?: string }>;
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

  // File diagnostics (check disk)
  const repoRoot = join(process.cwd(), "../..");
  const fileDiag = {
    hasExportedRequest: false,
    hasWorkspace: false,
    hasBuild: false,
    hasScreenshots: false,
    screenshotCount: 0,
  };

  try { await access(join(repoRoot, "generated", slug, "client-request.json")); fileDiag.hasExportedRequest = true; } catch { /* noop */ }
  try { await access(join(repoRoot, "generated", slug, "site", "config.json")); fileDiag.hasWorkspace = true; } catch { /* noop */ }
  try { await access(join(repoRoot, "generated", slug, "site", ".next")); fileDiag.hasBuild = true; } catch { /* noop */ }
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
  const lastExportedEvent = eventList.find((e) => e.event_type === "exported_to_generator");

  // Live missing info (recomputed from current state)
  const liveMissing = p ? detectMissingInfo(p, assetList) : [];

  return {
    draft: draftDiag,
    files: fileDiag,
    jobs: {
      lastGenerate: lastGenerate ? { id: lastGenerate.id, status: lastGenerate.status, completedAt: lastGenerate.completed_at } : null,
      lastReview: lastReview ? { id: lastReview.id, status: lastReview.status, completedAt: lastReview.completed_at } : null,
    },
    timestamps: {
      lastProcessedAt: lastProcessedEvent?.created_at ?? null,
      lastExportedAt: lastExportedEvent?.created_at ?? null,
    },
    liveMissingInfo: liveMissing,
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

  if (!p.draft_request) {
    return { error: "No draft request found. Process the intake first." };
  }

  const draft = p.draft_request as Record<string, unknown>;

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

  // Store in DB as final_request
  const { error: updateError } = await supabase
    .from("projects")
    .update({ final_request: parsed })
    .eq("id", projectId);

  if (updateError) return { error: updateError.message };

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
): Promise<{ source: "final" | "draft" | "none"; hasFinal: boolean; hasDraft: boolean }> {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("draft_request, final_request")
    .eq("id", projectId)
    .single();

  if (!project) return { source: "none", hasFinal: false, hasDraft: false };

  const hasFinal = project.final_request !== null;
  const hasDraft = project.draft_request !== null;

  return {
    source: hasFinal ? "final" : hasDraft ? "draft" : "none",
    hasFinal,
    hasDraft,
  };
}
