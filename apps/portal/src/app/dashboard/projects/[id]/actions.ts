"use server";

import { createClient } from "@/lib/supabase/server";
import { processIntake } from "@/lib/intake-processor";
import { revalidatePath } from "next/cache";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Project, Asset } from "@/lib/types";

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
    .select("status")
    .eq("id", projectId)
    .single();

  if (!project) return { error: "Project not found" };
  if (project.status !== "intake_draft_ready") {
    return { error: `Cannot approve intake in status "${project.status}"` };
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
 * Write the approved client-request.json to the target path so the generator
 * can pick it up via `pnpm -w generate -- --target <slug>`.
 *
 * Writes to: examples/fake-clients/<slug>/client-request.json
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

  // Write client-request.json to the target input path
  const repoRoot = join(process.cwd(), "../..");
  const targetDir = join(repoRoot, "examples", "fake-clients", p.slug);
  const targetPath = join(targetDir, "client-request.json");

  try {
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, JSON.stringify(p.draft_request, null, 2) + "\n", "utf-8");
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

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { path: targetPath };
}
