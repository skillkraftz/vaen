"use server";

import { createClient } from "@/lib/supabase/server";
import { processIntake } from "@/lib/intake-processor";
import { notifyDiscord } from "@/lib/discord";
import { revalidatePath } from "next/cache";
import { writeFile, mkdir, access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Project, Asset, JobRecord } from "@/lib/types";

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

  if (!p.draft_request) {
    return { error: "No draft client-request.json found. Process the intake first." };
  }

  // Validate services exist before export
  const draft = p.draft_request as Record<string, unknown>;
  const services = Array.isArray(draft.services) ? draft.services : [];
  if (services.length === 0) {
    return { error: "Cannot export: services list is empty. Add services before exporting." };
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

// ── Update draft request (services, content, etc.) ───────────────────

export async function updateDraftRequestAction(
  projectId: string,
  draftRequest: Record<string, unknown>,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error: updateError } = await supabase
    .from("projects")
    .update({ draft_request: draftRequest })
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
 * Fire-and-forget: the worker reads the job from DB and updates it.
 */
function spawnWorker(jobId: string): void {
  const repoRoot = join(process.cwd(), "../..");
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

  // Create job record
  const { data: job, error: insertErr } = await supabase
    .from("jobs")
    .insert({
      project_id: projectId,
      job_type: "generate",
      status: "pending",
      payload: { triggered_by: user.id },
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

  // Create job record
  const { data: job, error: insertErr } = await supabase
    .from("jobs")
    .insert({
      project_id: projectId,
      job_type: "review",
      status: "pending",
      payload: { triggered_by: user.id },
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
