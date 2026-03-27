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
 *
 * Every execution records:
 *   - exact command + args
 *   - target slug and canonical paths
 *   - working directory
 *   - files removed/written during generation
 *   - post-generate validation results
 *   - site freshness metadata
 *   - full stdout/stderr
 *   - exit code
 */

// Load apps/worker/.env before anything else touches process.env.
// Path is resolved relative to this script (dist/run-job.js → ../.env)
// so it works regardless of cwd.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __workerDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(__workerDir, "..", ".env") });

import { spawn } from "node:child_process";
import {
  access,
  readdir,
  readFile,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

interface ValidationResult {
  valid: boolean;
  checks: Record<string, boolean>;
  errors: string[];
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

// ── Helpers ───────────────────────────────────────────────────────────

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

/** Recursively list all files in dir, excluding node_modules/.next/dist. */
function listSiteFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === "dist"
    )
      continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSiteFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function extractErrorSummary(stderr: string, stdout: string): string {
  const combinedOutput = stderr || stdout;
  const outputLines = combinedOutput.trim().split("\n");
  const tailLines = outputLines.slice(-20).join("\n");
  return tailLines.slice(0, 1000);
}

// ── Site Validation ──────────────────────────────────────────────────

/**
 * Validate a generated site for known bad Next.js patterns.
 * Returns structured result with per-check status and errors.
 */
function validateGeneratedSite(siteDir: string): ValidationResult {
  const checks: Record<string, boolean> = {};
  const errors: string[] = [];

  // 1. app/global-error.tsx must exist (prevents /500 Pages Router fallback)
  checks.global_error_exists = existsSync(
    join(siteDir, "app", "global-error.tsx"),
  );
  if (!checks.global_error_exists) {
    errors.push(
      "Missing app/global-error.tsx — /500 will fall back to Pages Router _document path",
    );
  }

  // 2. app/not-found.tsx must exist (explicit 404 handling)
  checks.not_found_exists = existsSync(
    join(siteDir, "app", "not-found.tsx"),
  );
  if (!checks.not_found_exists) {
    errors.push("Missing app/not-found.tsx — 404 handling is undefined");
  }

  // 3. No pages/ directory (pure App Router)
  checks.no_pages_dir = !existsSync(join(siteDir, "pages"));
  if (!checks.no_pages_dir) {
    errors.push(
      "pages/ directory exists — mixed Pages/App Router will cause _document errors",
    );
  }

  // 4. next.config.ts must not have output: "standalone"
  const configPath = join(siteDir, "next.config.ts");
  if (existsSync(configPath)) {
    const configContent = readFileSync(configPath, "utf-8");
    checks.no_standalone = !/output:\s*["']standalone["']/.test(configContent);
    if (!checks.no_standalone) {
      errors.push(
        'next.config.ts has output: "standalone" — breaks pure App Router on Next.js 15',
      );
    }
  } else {
    checks.no_standalone = true; // No config file = no standalone
  }

  // 5. No next/document imports in source files
  checks.no_document_imports = true;
  const sourceFiles = listSiteFiles(siteDir).filter((f) =>
    /\.(tsx?|jsx?)$/.test(f),
  );
  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf-8");
    if (/from\s+["']next\/document["']/.test(content)) {
      checks.no_document_imports = false;
      errors.push(
        `${relative(siteDir, file)} imports from next/document`,
      );
    }
  }

  // 6. app/layout.tsx must exist with plain <html> tag
  const layoutPath = join(siteDir, "app", "layout.tsx");
  if (existsSync(layoutPath)) {
    const layoutContent = readFileSync(layoutPath, "utf-8");
    checks.layout_has_html = /<html/.test(layoutContent);
    if (!checks.layout_has_html) {
      errors.push("app/layout.tsx does not render <html> tag");
    }
  } else {
    checks.layout_has_html = false;
    errors.push("Missing app/layout.tsx");
  }

  return { valid: errors.length === 0, checks, errors };
}

// ── Executors ─────────────────────────────────────────────────────────

async function executeGenerate(
  db: ReturnType<typeof createWorkerClient>,
  job: JobRow,
  project: ProjectRow,
) {
  const repoRoot = resolveRepoRoot();
  const slug = project.slug;
  const siteDir = join(repoRoot, "generated", slug, "site");

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

  // Build the exact command the same way the portal would
  const cmdArgs = [
    "-w",
    "generate",
    "--",
    "--target",
    slug,
    "--input",
    clientRequestPath,
    "--modules",
    modulesArg,
  ];
  const fullCommand = `pnpm ${cmdArgs.join(" ")}`;

  // Clean stale artifacts from prior runs so they cannot persist
  const artifactsDir = join(repoRoot, "generated", slug, "artifacts");
  const screenshotsDir = join(artifactsDir, "screenshots");
  await rm(screenshotsDir, { recursive: true, force: true });
  console.log(`[generate] cleaned stale screenshots: ${screenshotsDir}`);

  // Snapshot site files BEFORE generation (to compute diff)
  const preGenFiles = listSiteFiles(siteDir).map((f) =>
    relative(siteDir, f),
  );

  // Record execution details in job payload
  await db
    .from("jobs")
    .update({
      payload: {
        ...job.payload,
        execution: {
          command: fullCommand,
          cwd: repoRoot,
          target_slug: slug,
          input_path: relative(repoRoot, clientRequestPath),
          site_path: relative(repoRoot, siteDir),
          modules: moduleIds,
          pre_gen_file_count: preGenFiles.length,
        },
      },
    })
    .eq("id", job.id);

  // Run generator
  const { stdout, stderr, exitCode } = await runCommand(
    "pnpm",
    cmdArgs,
    repoRoot,
    60_000,
  );

  const now = new Date().toISOString();

  if (exitCode !== 0) {
    const errorSummary = extractErrorSummary(stderr, stdout);

    await db
      .from("jobs")
      .update({
        status: "failed",
        result: {
          success: false,
          message: `Generator exited with code ${exitCode}`,
          error: errorSummary,
          command: fullCommand,
          exit_code: exitCode,
        },
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 50_000),
        completed_at: now,
      })
      .eq("id", job.id);

    await db.from("project_events").insert({
      project_id: project.id,
      event_type: "generate_failed",
      from_status: project.status,
      to_status: project.status,
      metadata: { job_id: job.id, error: errorSummary, command: fullCommand },
    });

    await notifyDiscordTransition(db, project, "generate_failed");
    return;
  }

  // Snapshot site files AFTER generation (compute diff)
  const postGenFiles = listSiteFiles(siteDir).map((f) =>
    relative(siteDir, f),
  );
  const filesAdded = postGenFiles.filter((f) => !preGenFiles.includes(f));
  const filesRemoved = preGenFiles.filter((f) => !postGenFiles.includes(f));

  // ── Post-generate validation ──────────────────────────────────────
  const validation = validateGeneratedSite(siteDir);

  // Write generation metadata to site dir for freshness tracking
  const genMeta = {
    job_id: job.id,
    project_id: project.id,
    generated_at: now,
    command: fullCommand,
    target_slug: slug,
    validation,
    files_written: postGenFiles,
    files_removed: filesRemoved.length > 0 ? filesRemoved : undefined,
  };
  await writeFile(
    join(siteDir, ".vaen-meta.json"),
    JSON.stringify(genMeta, null, 2),
  );

  // Also write validation report as a separate artifact
  await writeFile(
    join(repoRoot, "generated", slug, "artifacts", "validation.json"),
    JSON.stringify(validation, null, 2),
  );

  if (!validation.valid) {
    // FAIL FAST: the generated site has known bad patterns.
    // Do NOT advance project status — let the operator fix the template.
    const errorMsg = `Generation produced invalid site: ${validation.errors.join("; ")}`;

    await db
      .from("jobs")
      .update({
        status: "failed",
        result: {
          success: false,
          message: errorMsg,
          command: fullCommand,
          exit_code: exitCode,
          validation,
          files_written: postGenFiles.length,
          files_removed: filesRemoved.length,
          generation_meta: genMeta,
        },
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 50_000),
        completed_at: now,
      })
      .eq("id", job.id);

    await db.from("project_events").insert({
      project_id: project.id,
      event_type: "generate_invalid",
      from_status: project.status,
      to_status: project.status,
      metadata: {
        job_id: job.id,
        validation,
        error: errorMsg,
      },
    });

    await notifyDiscordTransition(db, project, "generate_failed");
    console.error(`[worker] Generation invalid for ${slug}: ${errorMsg}`);
    return;
  }

  // ── Success ───────────────────────────────────────────────────────
  await db
    .from("jobs")
    .update({
      status: "completed",
      result: {
        success: true,
        message: "Site generated successfully",
        artifacts: [join(repoRoot, "generated", slug)],
        command: fullCommand,
        exit_code: exitCode,
        validation,
        files_written: postGenFiles.length,
        files_removed: filesRemoved.length,
        generation_meta: genMeta,
      },
      stdout: stdout.slice(0, 50_000),
      stderr: stderr.slice(0, 50_000),
      completed_at: now,
    })
    .eq("id", job.id);

  // Advance project status + record which revision was generated
  const revisionId = (job.payload?.revision_id as string) ?? null;
  await db
    .from("projects")
    .update({
      status: "workspace_generated",
      ...(revisionId ? { last_generated_revision_id: revisionId } : {}),
    })
    .eq("id", project.id);

  await db.from("project_events").insert({
    project_id: project.id,
    event_type: "site_generated",
    from_status: project.status,
    to_status: "workspace_generated",
    metadata: {
      job_id: job.id,
      slug,
      modules: moduleIds,
      validation,
      files_written: postGenFiles.length,
    },
  });

  await notifyDiscordTransition(db, project, "site_generated");

  console.log(
    `[worker] Generate complete for ${slug} — ${postGenFiles.length} files, validation: ${validation.valid ? "PASS" : "FAIL"}`,
  );
}

async function executeReview(
  db: ReturnType<typeof createWorkerClient>,
  job: JobRow,
  project: ProjectRow,
) {
  const repoRoot = resolveRepoRoot();
  const slug = project.slug;
  const siteDir = join(repoRoot, "generated", slug, "site");
  const metaPath = join(siteDir, ".vaen-meta.json");

  // ── Site freshness check ──────────────────────────────────────────
  let siteAge = "unknown";
  let generationJobId: string | null = null;
  let genMeta: Record<string, unknown> | null = null;

  try {
    const metaContent = await readFile(metaPath, "utf-8");
    genMeta = JSON.parse(metaContent);
    const genTime = new Date(genMeta!.generated_at as string);
    const ageMs = Date.now() - genTime.getTime();
    generationJobId = (genMeta!.job_id as string) ?? null;

    if (ageMs < 60_000) siteAge = "fresh (< 1 min)";
    else if (ageMs < 3600_000)
      siteAge = `${Math.round(ageMs / 60_000)} min old`;
    else siteAge = `${Math.round(ageMs / 3600_000)} hours old`;
  } catch {
    siteAge = "no metadata — site may be stale or manually created";
  }

  // Clean stale screenshots from prior review runs
  const screenshotsDir = join(repoRoot, "generated", slug, "artifacts", "screenshots");
  await rm(screenshotsDir, { recursive: true, force: true });
  console.log(`[review] cleaned stale screenshots: ${screenshotsDir}`);

  const cmdArgs = ["-w", "review", "--", "--target", slug];
  const fullCommand = `pnpm ${cmdArgs.join(" ")}`;

  // Record execution details in job payload
  await db
    .from("jobs")
    .update({
      payload: {
        ...job.payload,
        execution: {
          command: fullCommand,
          cwd: repoRoot,
          target_slug: slug,
          site_path: relative(repoRoot, siteDir),
          site_age: siteAge,
          generation_job_id: generationJobId,
        },
      },
    })
    .eq("id", job.id);

  // ── Pre-review validation ─────────────────────────────────────────
  const validation = validateGeneratedSite(siteDir);
  if (!validation.valid) {
    const errorMsg = `Site validation failed before build: ${validation.errors.join("; ")}. Re-generate the site first.`;
    const now = new Date().toISOString();

    await db
      .from("jobs")
      .update({
        status: "failed",
        result: {
          success: false,
          message: errorMsg,
          command: fullCommand,
          validation,
          site_age: siteAge,
        },
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
      from_status: project.status,
      to_status: "build_failed",
      metadata: {
        job_id: job.id,
        error: errorMsg,
        validation,
        site_age: siteAge,
      },
    });

    await notifyDiscordTransition(db, project, "review_failed");
    console.error(`[worker] Pre-review validation failed for ${slug}: ${errorMsg}`);
    return;
  }

  // Mark project as build_in_progress
  await db
    .from("projects")
    .update({ status: "build_in_progress" })
    .eq("id", project.id);

  // Run review (build + screenshot capture)
  const { stdout, stderr, exitCode } = await runCommand(
    "pnpm",
    cmdArgs,
    repoRoot,
    120_000,
  );

  const now = new Date().toISOString();

  if (exitCode !== 0) {
    const errorSummary = extractErrorSummary(stderr, stdout);
    const combinedOutput = stdout + stderr;

    // Detect the specific Html/pages/_document error and provide actionable guidance.
    // Root cause chain: load-default-error-components.js → require('next/dist/pages/_document')
    // → Html → useHtmlContext() → error when HtmlContext.Provider is missing (App Router).
    // Fix: ensure app/not-found.tsx and app/global-error.tsx exist in the template.
    const isHtmlDocumentError = combinedOutput.includes(
      "should not be imported outside of pages/_document",
    );
    const diagMessage = isHtmlDocumentError
      ? `KNOWN BUG: Next.js fell back to Pages Router for 404/500 rendering. ` +
        `This happens when app/not-found.tsx or app/global-error.tsx is missing. ` +
        `The App Router has no HtmlContext provider, so the Pages Router _document ` +
        `chain throws. Check: (1) app/not-found.tsx exists, (2) app/global-error.tsx ` +
        `exists with "use client", (3) no pages/ directory, (4) no output: "standalone" ` +
        `in next.config.ts. Trace: .next/server/chunks/611.js module 92 → HtmlContext.`
      : undefined;

    await db
      .from("jobs")
      .update({
        status: "failed",
        result: {
          success: false,
          message: `Review exited with code ${exitCode}`,
          error: errorSummary,
          command: fullCommand,
          exit_code: exitCode,
          validation,
          site_age: siteAge,
          ...(diagMessage ? { diagnostic: diagMessage } : {}),
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
      metadata: {
        job_id: job.id,
        error: errorSummary,
        command: fullCommand,
        site_age: siteAge,
        ...(diagMessage ? { diagnostic: diagMessage } : {}),
      },
    });

    if (isHtmlDocumentError) {
      console.error(
        `[worker] KNOWN BUG for ${slug}: Html/_document error. ` +
          `Re-generate with fixed template (app/not-found.tsx + app/global-error.tsx).`,
      );
    }

    await notifyDiscordTransition(db, project, "review_failed");
    return;
  }

  // Count screenshots (screenshotsDir declared at top of executeReview)
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
        command: fullCommand,
        exit_code: exitCode,
        validation,
        site_age: siteAge,
        screenshot_count: screenshotCount,
      },
      stdout: stdout.slice(0, 50_000),
      stderr: stderr.slice(0, 50_000),
      completed_at: now,
    })
    .eq("id", job.id);

  // Advance project status + record which revision was reviewed
  const reviewRevisionId = (job.payload?.revision_id as string) ?? null;
  await db
    .from("projects")
    .update({
      status: "review_ready",
      ...(reviewRevisionId ? { last_reviewed_revision_id: reviewRevisionId } : {}),
    })
    .eq("id", project.id);

  // Upload screenshots to Supabase storage + create asset records
  try {
    const screenshotFiles = readdirSync(screenshotsDir).filter((f) =>
      f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg"),
    );

    for (const file of screenshotFiles) {
      const filePath = join(screenshotsDir, file);
      const fileData = await readFile(filePath);
      const storagePath = `${project.id}/${job.id}/${file}`;

      const { error: uploadError } = await db.storage
        .from("review-screenshots")
        .upload(storagePath, fileData, {
          contentType: file.endsWith(".png") ? "image/png" : "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        console.error(`[worker] Screenshot upload failed for ${file}:`, uploadError.message);
        continue;
      }

      // Create asset record linked to project, job, and revision
      await db.from("assets").insert({
        project_id: project.id,
        file_name: file,
        file_type: file.endsWith(".png") ? "image/png" : "image/jpeg",
        file_size: fileData.length,
        storage_path: storagePath,
        category: "image",
        asset_type: "review_screenshot",
        source_job_id: job.id,
      });
    }

    console.log(`[worker] Uploaded ${screenshotFiles.length} screenshots to Supabase for ${slug}`);
  } catch (err) {
    console.error("[worker] Screenshot upload to Supabase failed:", err);
    // Non-fatal — screenshots are still on disk
  }

  await db.from("project_events").insert({
    project_id: project.id,
    event_type: "review_completed",
    from_status: "build_in_progress",
    to_status: "review_ready",
    metadata: {
      job_id: job.id,
      screenshots_dir: screenshotsDir,
      screenshot_count: screenshotCount,
      validation,
      site_age: siteAge,
      revision_id: reviewRevisionId,
    },
  });

  await notifyDiscordTransition(db, project, "review_completed");

  console.log(
    `[worker] Review complete for ${slug} (${screenshotCount} screenshots, site ${siteAge})`,
  );
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

  const cfg = eventConfig[eventType];
  if (!cfg) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: cfg.title,
            description: `[View in portal](${projectUrl})`,
            color: cfg.color,
            fields: [
              {
                name: "Project",
                value: project.slug,
                inline: true,
              },
              {
                name: "Status",
                value: cfg.status,
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
