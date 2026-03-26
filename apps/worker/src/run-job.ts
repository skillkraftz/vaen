#!/usr/bin/env node

/**
 * run-job — Executes a single job by ID.
 *
 * Called by the portal as a detached child process:
 *   node apps/worker/dist/run-job.js <job-id>
 *
 * Reads the job from the DB, executes it (generate or review),
 * captures stdout/stderr, and writes results back to the DB.
 * Also updates the parent project's status on success/failure.
 */

// Load apps/worker/.env before anything else touches process.env.
// Path is resolved relative to this script (dist/run-job.js → ../.env)
// so it works regardless of cwd.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __workerDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(__workerDir, "..", ".env") });

import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { createWorkerClient } from "./db.js";

// ── Types ─────────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  project_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
}

interface ProjectRow {
  id: string;
  slug: string;
  status: string;
  recommendations: { modules?: Array<{ id: string }> } | null;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: run-job <job-id>");
    process.exit(1);
  }

  const db = createWorkerClient();

  // Load the job
  const { data: job, error: jobErr } = await db
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    console.error(`Job ${jobId} not found:`, jobErr?.message);
    process.exit(1);
  }

  const j = job as JobRow;

  if (j.status !== "pending") {
    console.error(`Job ${jobId} is not pending (status: ${j.status})`);
    process.exit(1);
  }

  // Load the project
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, slug, status, recommendations")
    .eq("id", j.project_id)
    .single();

  if (projErr || !project) {
    console.error(`Project ${j.project_id} not found:`, projErr?.message);
    process.exit(1);
  }

  const p = project as ProjectRow;

  // Mark job as running
  await db
    .from("jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId);

  console.log(`[worker] Running job ${jobId} (${j.job_type}) for ${p.slug}`);

  try {
    switch (j.job_type) {
      case "generate":
        await executeGenerate(db, j, p);
        break;
      case "review":
        await executeReview(db, j, p);
        break;
      default:
        throw new Error(`Unknown job type: ${j.job_type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Job ${jobId} failed:`, message);

    await db
      .from("jobs")
      .update({
        status: "failed",
        result: { success: false, message: message.slice(0, 2000) },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}

// ── Executors ─────────────────────────────────────────────────────────

function resolveRepoRoot(): string {
  // Walk up from apps/worker/dist/ to repo root (3 levels: dist → worker → apps → root)
  return join(new URL(".", import.meta.url).pathname, "..", "..", "..");
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

async function executeGenerate(
  db: ReturnType<typeof createWorkerClient>,
  job: JobRow,
  project: ProjectRow,
) {
  const repoRoot = resolveRepoRoot();
  const slug = project.slug;

  // Canonical export path: generated/<slug>/client-request.json
  const clientRequestPath = join(
    repoRoot,
    "generated",
    slug,
    "client-request.json",
  );
  try {
    await access(clientRequestPath);
  } catch {
    throw new Error(
      `client-request.json not found at generated/${slug}/client-request.json. ` +
        `Run Export from the portal first. ` +
        `(checked: ${clientRequestPath})`,
    );
  }

  // Determine modules
  const rec = project.recommendations;
  const moduleIds = rec?.modules?.map((m) => m.id) ?? ["maps-embed"];
  const modulesArg = moduleIds.join(",");

  // Run generator with explicit --input pointing to the canonical path
  const { stdout, stderr, exitCode } = await runCommand(
    "pnpm",
    [
      "-w", "generate", "--",
      "--target", slug,
      "--input", clientRequestPath,
      "--modules", modulesArg,
    ],
    repoRoot,
    60_000,
  );

  // Update job with output
  const now = new Date().toISOString();

  if (exitCode !== 0) {
    // Extract the most useful error lines from output
    const combinedOutput = stderr || stdout;
    const outputLines = combinedOutput.trim().split("\n");
    const tailLines = outputLines.slice(-20).join("\n");
    const errorSummary = tailLines.slice(0, 1000);

    await db
      .from("jobs")
      .update({
        status: "failed",
        result: {
          success: false,
          message: `Generator exited with code ${exitCode}`,
          error: errorSummary,
        },
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 50_000),
        completed_at: now,
      })
      .eq("id", job.id);

    // Log event
    await db.from("project_events").insert({
      project_id: project.id,
      event_type: "generate_failed",
      from_status: project.status,
      to_status: project.status,
      metadata: {
        job_id: job.id,
        error: errorSummary,
      },
    });

    // Notify Discord
    await notifyDiscordTransition(db, project, "generate_failed");
    return;
  }

  // Success
  await db
    .from("jobs")
    .update({
      status: "completed",
      result: {
        success: true,
        message: "Site generated successfully",
        artifacts: [join(repoRoot, "generated", slug)],
      },
      stdout: stdout.slice(0, 50_000),
      stderr: stderr.slice(0, 50_000),
      completed_at: now,
    })
    .eq("id", job.id);

  // Advance project status
  await db
    .from("projects")
    .update({ status: "workspace_generated" })
    .eq("id", project.id);

  await db.from("project_events").insert({
    project_id: project.id,
    event_type: "site_generated",
    from_status: project.status,
    to_status: "workspace_generated",
    metadata: { job_id: job.id, slug, modules: moduleIds },
  });

  await notifyDiscordTransition(db, project, "site_generated");

  console.log(`[worker] Generate complete for ${slug}`);
}

async function executeReview(
  db: ReturnType<typeof createWorkerClient>,
  job: JobRow,
  project: ProjectRow,
) {
  const repoRoot = resolveRepoRoot();
  const slug = project.slug;

  // Mark project as build_in_progress
  await db
    .from("projects")
    .update({ status: "build_in_progress" })
    .eq("id", project.id);

  // Run review (build + screenshot capture)
  const { stdout, stderr, exitCode } = await runCommand(
    "pnpm",
    ["-w", "review", "--", "--target", slug],
    repoRoot,
    120_000,
  );

  const now = new Date().toISOString();

  if (exitCode !== 0) {
    // Extract the most useful error lines from output
    const combinedOutput = stderr || stdout;
    const outputLines = combinedOutput.trim().split("\n");
    const tailLines = outputLines.slice(-20).join("\n");
    const errorSummary = tailLines.slice(0, 1000);

    await db
      .from("jobs")
      .update({
        status: "failed",
        result: {
          success: false,
          message: `Review exited with code ${exitCode}`,
          error: errorSummary,
        },
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 50_000),
        completed_at: now,
      })
      .eq("id", job.id);

    await db
      .from("projects")
      .update({ status: "build_failed" })
      .eq("id", project.id);

    await db.from("project_events").insert({
      project_id: project.id,
      event_type: "review_failed",
      from_status: "build_in_progress",
      to_status: "build_failed",
      metadata: { job_id: job.id, error: errorSummary },
    });

    await notifyDiscordTransition(db, project, "review_failed");
    return;
  }

  // Count screenshots
  const screenshotsDir = join(
    repoRoot,
    "generated",
    slug,
    "artifacts",
    "screenshots",
  );
  let screenshotCount = 0;
  try {
    const files = await readdir(screenshotsDir);
    screenshotCount = files.filter((f) => f.endsWith(".png")).length;
  } catch {
    /* noop */
  }

  // Success
  await db
    .from("jobs")
    .update({
      status: "completed",
      result: {
        success: true,
        message: `Review complete — ${screenshotCount} screenshots captured`,
        artifacts: [screenshotsDir],
      },
      stdout: stdout.slice(0, 50_000),
      stderr: stderr.slice(0, 50_000),
      completed_at: now,
    })
    .eq("id", job.id);

  await db
    .from("projects")
    .update({ status: "review_ready" })
    .eq("id", project.id);

  await db.from("project_events").insert({
    project_id: project.id,
    event_type: "review_completed",
    from_status: "build_in_progress",
    to_status: "review_ready",
    metadata: {
      job_id: job.id,
      screenshots_dir: screenshotsDir,
      screenshot_count: screenshotCount,
    },
  });

  await notifyDiscordTransition(db, project, "review_completed");

  console.log(`[worker] Review complete for ${slug} (${screenshotCount} screenshots)`);
}

// ── Discord notifications ─────────────────────────────────────────────

async function notifyDiscordTransition(
  db: ReturnType<typeof createWorkerClient>,
  project: ProjectRow,
  eventType: string,
) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const portalUrl = (
    process.env.NEXT_PUBLIC_PORTAL_URL ?? "http://localhost:3100"
  ).replace(/\/+$/, "");
  const projectUrl = `${portalUrl}/dashboard/projects/${project.id}`;

  const eventConfig: Record<
    string,
    { title: string; color: number; status: string }
  > = {
    site_generated: {
      title: "Site Generated",
      color: 0x22c55e,
      status: "workspace_generated",
    },
    generate_failed: {
      title: "Generation Failed",
      color: 0xef4444,
      status: "generation error",
    },
    review_completed: {
      title: "Review Ready",
      color: 0x22c55e,
      status: "review_ready",
    },
    review_failed: {
      title: "Build/Review Failed",
      color: 0xef4444,
      status: "build_failed",
    },
  };

  const config = eventConfig[eventType];
  if (!config) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: config.title,
            description: `[View in portal](${projectUrl})`,
            color: config.color,
            fields: [
              {
                name: "Project",
                value: project.slug,
                inline: true,
              },
              {
                name: "Status",
                value: config.status,
                inline: true,
              },
            ],
            timestamp: new Date().toISOString(),
            footer: { text: "vaen worker" },
          },
        ],
      }),
    });
  } catch (err) {
    console.error("[worker] Discord notification failed:", err);
  }
}

// ── Run ───────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});
