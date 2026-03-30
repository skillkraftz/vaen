#!/usr/bin/env node

/**
 * run-job — Executes a single job by ID.
 *
 * Called either by the long-running worker poller after it claims a job,
 * or directly for local debugging:
 *   node apps/worker/dist/run-job.js <job-id>
 *
 * Reads the claimed job from the DB, executes it (generate or review),
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
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { DeploymentPayload } from "@vaen/schemas";
import { createWorkerClient } from "./db.js";
import { executeProviderAdapters } from "./providers/index.js";

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
  selected_modules?: Array<{ id: string }> | null;
  recommendations: { modules?: Array<{ id: string }> } | null;
}

interface ValidationResult {
  valid: boolean;
  checks: Record<string, boolean>;
  errors: string[];
}

interface ScreenshotManifestFile {
  file_name: string;
  path: string;
  size_bytes: number;
  sha256: string;
  modified_at: string;
  uploaded_storage_path?: string | null;
  uploaded_asset_id?: string | null;
  uploaded_at?: string | null;
}

interface ScreenshotManifest {
  schema_version: number;
  status: "completed" | "failed";
  project_id: string | null;
  slug: string;
  revision_id: string | null;
  job_id: string | null;
  review_started_at: string | null;
  review_completed_at: string | null;
  served_url: string | null;
  served_title: string | null;
  port: number | null;
  site_dir: string;
  screenshots_dir: string;
  manifest_path: string;
  screenshot_files: ScreenshotManifestFile[];
  review_probe_path?: string | null;
  content_verification?: {
    status: "matched" | "mismatched" | "unknown";
    expected_business_name: string | null;
    observed_home_title: string | null;
    observed_home_h1: string | null;
    mismatches: string[];
  };
  runtime_config_probe_path?: string | null;
  runtime_config_status?: "matched" | "mismatched" | "unknown";
  expected_business_name?: string | null;
  runtime_business_name?: string | null;
  runtime_config_path?: string | null;
  runtime_cwd?: string | null;
  review_identity_status?: "matched" | "mismatched" | "unknown";
  mismatch_stage?: "generated_source" | "review_probe" | "unknown" | null;
  site_config_snapshot_path?: string | null;
  site_source_summary_path?: string | null;
  site_identity_scan_path?: string | null;
  upload_summary?: {
    compared_at: string;
    matched: boolean;
    manifest_count: number;
    uploaded_count: number;
    missing_in_upload: string[];
    extra_uploaded: string[];
    hash_mismatches: string[];
  };
}

interface ReviewProbeArtifact {
  screenshots: string[];
  probePath: string;
  expectedContent: {
    config_path: string | null;
    business_name: string | null;
    seo_title: string | null;
    hero_headline: string | null;
    contact_heading: string | null;
  };
  contentVerification: {
    status: "matched" | "mismatched" | "unknown";
    expected_business_name: string | null;
    observed_home_title: string | null;
    observed_home_h1: string | null;
    mismatches: string[];
  };
  runtimeConfigVerification: {
    status: "matched" | "mismatched" | "unknown";
    expected_business_name: string | null;
    runtime_business_name: string | null;
    runtime_config_path: string | null;
    runtime_cwd: string | null;
    route: string | null;
    mismatches: string[];
  };
  captures: Array<{
    page_name: string;
    route_path: string;
    viewport: string;
    screenshot_file: string;
    screenshot_path: string;
    html_snapshot_path: string | null;
    url: string;
    final_url: string;
    title: string;
    h1: string | null;
    body_text_snippet: string;
    body_text_hash: string;
    html_hash: string;
    runtime_config: {
      timestamp: string;
      route: string;
      process_cwd: string;
      configured_path: string | null;
      resolved_config_path: string;
      config_exists: boolean;
      config_sha256: string | null;
      business_name: string | null;
      seo_title: string | null;
      hero_headline: string | null;
      expected_business_name: string | null;
      runtime_config_status: "matched" | "mismatched" | "unknown";
    } | null;
  }>;
}

interface RuntimeConfigProbeEntry {
  timestamp: string;
  route: string;
  process_cwd: string;
  configured_path: string | null;
  resolved_config_path: string;
  config_exists: boolean;
  config_sha256: string | null;
  business_name: string | null;
  seo_title: string | null;
  hero_headline: string | null;
  expected_business_name: string | null;
  runtime_config_status: "matched" | "mismatched" | "unknown";
}

interface SiteConfigSnapshot {
  slug: string;
  project_id: string;
  revision_id: string | null;
  job_id: string;
  site_dir: string;
  cwd_for_review_build: string;
  cwd_for_review_start: string;
  config_exists: boolean;
  config_path: string;
  config_sha256: string | null;
  business_name: string | null;
  seo_title: string | null;
  hero_headline: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  raw_config: Record<string, unknown> | null;
}

interface SiteIdentityOccurrence {
  file: string;
  line: number;
  marker: string;
  excerpt: string;
}

interface SiteIdentityScan {
  slug: string;
  project_id: string;
  revision_id: string | null;
  job_id: string;
  site_dir: string;
  markers: string[];
  source_occurrences: SiteIdentityOccurrence[];
  built_occurrences: SiteIdentityOccurrence[];
  source_contains_stale_identity: boolean;
  built_contains_stale_identity: boolean;
}

interface SiteSourceSummary {
  slug: string;
  project_id: string;
  revision_id: string | null;
  job_id: string;
  site_dir: string;
  files: {
    config_json: {
      path: string;
      exists: boolean;
      sha256: string | null;
    };
    app_layout: {
      path: string;
      exists: boolean;
      sha256: string | null;
      contains_brightspark: boolean;
    };
    app_homepage: {
      path: string;
      exists: boolean;
      sha256: string | null;
      contains_brightspark: boolean;
    };
    app_contact: {
      path: string;
      exists: boolean;
      sha256: string | null;
      contains_brightspark: boolean;
    };
  };
}

// ── Main ──────────────────────────────────────────────────────────────

export async function runJobById(
  jobId: string,
  options: { claimIfPending?: boolean } = {},
) {
  const { claimIfPending = true } = options;
  const db = createWorkerClient();

  // Load the job
  const { data: job, error: jobErr } = await db
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    throw new Error(`Job ${jobId} not found: ${jobErr?.message ?? "missing row"}`);
  }

  const j = job as JobRow;

  if (claimIfPending) {
    if (j.status !== "pending") {
      throw new Error(`Job ${jobId} is not pending (status: ${j.status})`);
    }
  } else if (j.status !== "running") {
    throw new Error(`Job ${jobId} is not running (status: ${j.status})`);
  }

  // Load the project
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, slug, status, selected_modules, recommendations")
    .eq("id", j.project_id)
    .single();

  if (projErr || !project) {
    throw new Error(`Project ${j.project_id} not found: ${projErr?.message ?? "missing row"}`);
  }

  const p = project as ProjectRow;

  if (claimIfPending) {
    // Mark job as running when invoked directly by job ID.
    await db
      .from("jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", jobId);
  }

  console.log(`[worker] Running job ${jobId} (${j.job_type}) for ${p.slug}`);

  try {
    switch (j.job_type) {
      case "generate":
        await executeGenerate(db, j, p);
        break;
      case "review":
        await executeReview(db, j, p);
        break;
      case "deploy_prepare":
        await executeDeploymentPrepare(db, j, p);
        break;
      case "deploy_execute":
        await executeDeploymentProviders(db, j, p);
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

    await db
      .from("deployment_runs")
      .update({
        status: "failed",
        error_summary: message.slice(0, 2000),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", jobId);
  }
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: run-job <job-id>");
    process.exit(1);
  }

  await runJobById(jobId, { claimIfPending: true });
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
  envOverrides: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", ...envOverrides },
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

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function extractReviewRuntime(stdout: string): {
  servedTitle: string | null;
  port: number | null;
  servedUrl: string | null;
  screenshotOutputDir: string | null;
} {
  const servedTitle = stdout.match(/Served title:\s*(.+)/)?.[1]?.trim() ?? null;
  const portValue = stdout.match(/Port:\s*(\d+)/)?.[1] ?? null;
  const servedUrlFromStdout = stdout.match(/Served URL:\s*(.+)/)?.[1]?.trim() ?? null;
  const screenshotOutputDir = stdout.match(/Screenshots:\s*(.+)/)?.[1]?.trim() ?? null;
  const port = portValue ? Number(portValue) : null;
  return {
    servedTitle,
    port,
    servedUrl: servedUrlFromStdout ?? (port ? `http://localhost:${port}` : null),
    screenshotOutputDir,
  };
}

async function collectScreenshotManifest(
  screenshotsDir: string,
  repoRoot: string,
): Promise<ScreenshotManifestFile[]> {
  try {
    const names = (await readdir(screenshotsDir))
      .filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
      .sort();

    const files: ScreenshotManifestFile[] = [];
    for (const name of names) {
      const filePath = join(screenshotsDir, name);
      const [fileData, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
      files.push({
        file_name: name,
        path: relative(repoRoot, filePath),
        size_bytes: fileData.length,
        sha256: sha256(fileData),
        modified_at: fileStat.mtime.toISOString(),
      });
    }
    return files;
  } catch {
    return [];
  }
}

async function writeScreenshotManifest(
  manifestPath: string,
  manifest: ScreenshotManifest,
): Promise<void> {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

async function readReviewProbe(
  screenshotsDir: string,
  repoRoot: string,
): Promise<ReviewProbeArtifact | null> {
  const probePath = join(screenshotsDir, "review-probe.json");
  try {
    const raw = await readFile(probePath, "utf-8");
    const parsed = JSON.parse(raw) as ReviewProbeArtifact;
    parsed.probePath = relative(repoRoot, probePath);
    parsed.captures = parsed.captures.map((capture) => ({
      ...capture,
      screenshot_path: relative(repoRoot, capture.screenshot_path),
      html_snapshot_path: capture.html_snapshot_path
        ? relative(repoRoot, capture.html_snapshot_path)
        : null,
    }));
    parsed.screenshots = parsed.screenshots.map((path) => relative(repoRoot, path));
    return parsed;
  } catch {
    return null;
  }
}

async function readRuntimeConfigProbe(
  probePath: string,
): Promise<RuntimeConfigProbeEntry[] | null> {
  try {
    const raw = await readFile(probePath, "utf-8");
    return JSON.parse(raw) as RuntimeConfigProbeEntry[];
  } catch {
    return null;
  }
}

async function safeReadJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function safeFileHash(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path);
    return sha256(raw);
  } catch {
    return null;
  }
}

async function scanFileForMarkers(
  path: string,
  repoRoot: string,
  markers: string[],
): Promise<SiteIdentityOccurrence[]> {
  try {
    const raw = await readFile(path, "utf-8");
    const lines = raw.split("\n");
    const hits: SiteIdentityOccurrence[] = [];
    lines.forEach((line, idx) => {
      for (const marker of markers) {
        if (line.toLowerCase().includes(marker.toLowerCase())) {
          hits.push({
            file: relative(repoRoot, path),
            line: idx + 1,
            marker,
            excerpt: line.trim().slice(0, 240),
          });
        }
      }
    });
    return hits;
  } catch {
    return [];
  }
}

async function scanTreeForMarkers(
  dir: string,
  repoRoot: string,
  markers: string[],
): Promise<SiteIdentityOccurrence[]> {
  const files = listSiteFiles(dir).filter((file) =>
    /\.(tsx?|jsx?|json|html|js|mjs|cjs|txt|md)$/i.test(file),
  );
  const results = await Promise.all(files.map((file) => scanFileForMarkers(file, repoRoot, markers)));
  return results.flat();
}

async function snapshotSiteInputs(
  repoRoot: string,
  project: ProjectRow,
  job: JobRow,
  siteDir: string,
  reviewRevisionId: string | null,
): Promise<{
  siteConfigSnapshot: SiteConfigSnapshot;
  siteSourceSummary: SiteSourceSummary;
  siteIdentityScan: SiteIdentityScan;
  paths: {
    configSnapshotPath: string;
    sourceSummaryPath: string;
    identityScanPath: string;
  };
}> {
  const artifactsDir = join(repoRoot, "generated", project.slug, "artifacts");
  const configPath = join(siteDir, "config.json");
  const layoutPath = join(siteDir, "app", "layout.tsx");
  const homePath = join(siteDir, "app", "page.tsx");
  const contactPath = join(siteDir, "app", "contact", "page.tsx");
  const configJson = await safeReadJson(configPath);
  const brightsparkMarkers = [
    "BrightSpark",
    "Rochester Electrical",
    "mike@brightsparkelectric.com",
    "BrightSpark Electric 3",
    "BrightSpark Electric 2",
  ];

  const siteConfigSnapshot: SiteConfigSnapshot = {
    slug: project.slug,
    project_id: project.id,
    revision_id: reviewRevisionId,
    job_id: job.id,
    site_dir: siteDir,
    cwd_for_review_build: siteDir,
    cwd_for_review_start: siteDir,
    config_exists: existsSync(configPath),
    config_path: relative(repoRoot, configPath),
    config_sha256: await safeFileHash(configPath),
    business_name: (configJson?.business as Record<string, unknown> | undefined)?.name as string | null ?? null,
    seo_title: (configJson?.seo as Record<string, unknown> | undefined)?.title as string | null ?? null,
    hero_headline: (configJson?.hero as Record<string, unknown> | undefined)?.headline as string | null ?? null,
    contact_email: (configJson?.contact as Record<string, unknown> | undefined)?.email as string | null ?? null,
    contact_phone: (configJson?.contact as Record<string, unknown> | undefined)?.phone as string | null ?? null,
    raw_config: configJson,
  };

  const sourceSummary: SiteSourceSummary = {
    slug: project.slug,
    project_id: project.id,
    revision_id: reviewRevisionId,
    job_id: job.id,
    site_dir: relative(repoRoot, siteDir),
    files: {
      config_json: {
        path: relative(repoRoot, configPath),
        exists: existsSync(configPath),
        sha256: await safeFileHash(configPath),
      },
      app_layout: {
        path: relative(repoRoot, layoutPath),
        exists: existsSync(layoutPath),
        sha256: await safeFileHash(layoutPath),
        contains_brightspark: (await scanFileForMarkers(layoutPath, repoRoot, ["BrightSpark"])).length > 0,
      },
      app_homepage: {
        path: relative(repoRoot, homePath),
        exists: existsSync(homePath),
        sha256: await safeFileHash(homePath),
        contains_brightspark: (await scanFileForMarkers(homePath, repoRoot, ["BrightSpark"])).length > 0,
      },
      app_contact: {
        path: relative(repoRoot, contactPath),
        exists: existsSync(contactPath),
        sha256: await safeFileHash(contactPath),
        contains_brightspark: (await scanFileForMarkers(contactPath, repoRoot, ["BrightSpark"])).length > 0,
      },
    },
  };

  const sourceOccurrences = await scanTreeForMarkers(siteDir, repoRoot, brightsparkMarkers);
  const builtDir = join(siteDir, ".next");
  const builtOccurrences = existsSync(builtDir)
    ? await scanTreeForMarkers(builtDir, repoRoot, brightsparkMarkers)
    : [];

  const siteIdentityScan: SiteIdentityScan = {
    slug: project.slug,
    project_id: project.id,
    revision_id: reviewRevisionId,
    job_id: job.id,
    site_dir: relative(repoRoot, siteDir),
    markers: brightsparkMarkers,
    source_occurrences: sourceOccurrences,
    built_occurrences: builtOccurrences,
    source_contains_stale_identity: sourceOccurrences.length > 0,
    built_contains_stale_identity: builtOccurrences.length > 0,
  };

  const configSnapshotPath = join(artifactsDir, "site-config.snapshot.json");
  const sourceSummaryPath = join(artifactsDir, "site-source-summary.json");
  const identityScanPath = join(artifactsDir, "site-identity-scan.json");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(configSnapshotPath, JSON.stringify(siteConfigSnapshot, null, 2) + "\n", "utf-8");
  await writeFile(sourceSummaryPath, JSON.stringify(sourceSummary, null, 2) + "\n", "utf-8");
  await writeFile(identityScanPath, JSON.stringify(siteIdentityScan, null, 2) + "\n", "utf-8");

  return {
    siteConfigSnapshot,
    siteSourceSummary: sourceSummary,
    siteIdentityScan,
    paths: {
      configSnapshotPath: relative(repoRoot, configSnapshotPath),
      sourceSummaryPath: relative(repoRoot, sourceSummaryPath),
      identityScanPath: relative(repoRoot, identityScanPath),
    },
  };
}

function deriveIdentityVerdict(
  sourceScan: SiteIdentityScan,
  reviewProbe: ReviewProbeArtifact | null,
): {
  review_identity_status: "matched" | "mismatched" | "unknown";
  mismatch_stage: "generated_source" | "review_probe" | "unknown" | null;
} {
  if (sourceScan.source_contains_stale_identity || sourceScan.built_contains_stale_identity) {
    return {
      review_identity_status: "mismatched",
      mismatch_stage: "generated_source",
    };
  }

  if (reviewProbe?.contentVerification.status === "mismatched") {
    return {
      review_identity_status: "mismatched",
      mismatch_stage: "review_probe",
    };
  }

  if (reviewProbe?.runtimeConfigVerification.status === "mismatched") {
    return {
      review_identity_status: "mismatched",
      mismatch_stage: "review_probe",
    };
  }

  if (
    reviewProbe?.contentVerification.status === "matched" ||
    reviewProbe?.runtimeConfigVerification.status === "matched"
  ) {
    return {
      review_identity_status: "matched",
      mismatch_stage: null,
    };
  }

  return {
    review_identity_status: "unknown",
    mismatch_stage: "unknown",
  };
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
  const selectedModules = Array.isArray(project.selected_modules)
    ? project.selected_modules
    : [];
  const rec = project.recommendations;
  const moduleIds = selectedModules.length > 0
    ? selectedModules.map((m) => m.id)
    : rec?.modules?.map((m) => m.id) ?? ["maps-embed"];
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

  // IMPORTANT: Update project status BEFORE marking job as completed.
  // The portal polls job status and calls router.refresh() when a job
  // finishes. If we mark the job done first, the portal may refresh
  // before the project status is updated, showing stale status.
  const revisionId = (job.payload?.revision_id as string) ?? null;
  await db
    .from("projects")
    .update({
      status: "workspace_generated",
      ...(revisionId ? { last_generated_revision_id: revisionId } : {}),
    })
    .eq("id", project.id);

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
  const screenshotsDir = join(repoRoot, "generated", slug, "artifacts", "screenshots");
  const manifestPath = join(screenshotsDir, "manifest.json");
  const runtimeConfigProbePath = join(
    repoRoot,
    "generated",
    slug,
    "artifacts",
    "runtime-config-probe.json",
  );
  const reviewRevisionId = (job.payload?.revision_id as string) ?? null;
  const reviewStartedAt = new Date().toISOString();
  const siteArtifacts = await snapshotSiteInputs(
    repoRoot,
    project,
    job,
    siteDir,
    reviewRevisionId,
  );

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
          screenshots_path: relative(repoRoot, screenshotsDir),
          site_config_snapshot_path: siteArtifacts.paths.configSnapshotPath,
          site_source_summary_path: siteArtifacts.paths.sourceSummaryPath,
          site_identity_scan_path: siteArtifacts.paths.identityScanPath,
          site_age: siteAge,
          generation_job_id: generationJobId,
          review_started_at: reviewStartedAt,
        },
      },
    })
    .eq("id", job.id);

  // ── Pre-review validation ─────────────────────────────────────────
  const validation = validateGeneratedSite(siteDir);
  if (!validation.valid) {
    const errorMsg = `Site validation failed before build: ${validation.errors.join("; ")}. Re-generate the site first.`;
    const now = new Date().toISOString();

    // Update project status BEFORE job status (see generate success comment)
    await db
      .from("projects")
      .update({ status: "build_failed" })
      .eq("id", project.id);

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
  const reviewEnv = {
    REVIEW_JOB_ID: job.id,
    REVIEW_PROJECT_ID: project.id,
    REVIEW_REVISION_ID: reviewRevisionId ?? "",
    REVIEW_SLUG: slug,
    REVIEW_SITE_DIR: siteDir,
    REVIEW_SCREENSHOTS_DIR: screenshotsDir,
    REVIEW_MANIFEST_PATH: manifestPath,
    VAEN_SITE_CONFIG_PATH: join(siteDir, "config.json"),
    VAEN_RUNTIME_PROBE_PATH: runtimeConfigProbePath,
    VAEN_EXPECTED_BUSINESS_NAME: siteArtifacts.siteConfigSnapshot.business_name ?? "",
  };
  const { stdout, stderr, exitCode } = await runCommand(
    "pnpm",
    cmdArgs,
    repoRoot,
    120_000,
    reviewEnv,
  );

  const now = new Date().toISOString();
  const runtime = extractReviewRuntime(stdout);
  const screenshotFiles = await collectScreenshotManifest(screenshotsDir, repoRoot);
  const reviewProbe = await readReviewProbe(screenshotsDir, repoRoot);
  const runtimeConfigProbe = await readRuntimeConfigProbe(runtimeConfigProbePath);
  const homeRuntimeProbe =
    runtimeConfigProbe?.find((entry) => entry.route === "/") ??
    runtimeConfigProbe?.find((entry) => entry.route === "/contact") ??
    runtimeConfigProbe?.[0] ??
    null;
  const identityVerdict = deriveIdentityVerdict(siteArtifacts.siteIdentityScan, reviewProbe);
  const manifestBase: ScreenshotManifest = {
    schema_version: 1,
    status: exitCode === 0 ? "completed" : "failed",
    project_id: project.id,
    slug,
    revision_id: reviewRevisionId,
    job_id: job.id,
    review_started_at: reviewStartedAt,
    review_completed_at: now,
    served_url: runtime.servedUrl,
    served_title: runtime.servedTitle,
    port: runtime.port,
    site_dir: relative(repoRoot, siteDir),
    screenshots_dir: relative(repoRoot, screenshotsDir),
    manifest_path: relative(repoRoot, manifestPath),
    screenshot_files: screenshotFiles,
    review_probe_path: reviewProbe?.probePath ?? null,
    content_verification: reviewProbe?.contentVerification,
    runtime_config_probe_path: relative(repoRoot, runtimeConfigProbePath),
    runtime_config_status:
      reviewProbe?.runtimeConfigVerification.status ??
      homeRuntimeProbe?.runtime_config_status ??
      "unknown",
    expected_business_name:
      reviewProbe?.runtimeConfigVerification.expected_business_name ??
      homeRuntimeProbe?.expected_business_name ??
      siteArtifacts.siteConfigSnapshot.business_name,
    runtime_business_name:
      reviewProbe?.runtimeConfigVerification.runtime_business_name ??
      homeRuntimeProbe?.business_name ??
      null,
    runtime_config_path:
      reviewProbe?.runtimeConfigVerification.runtime_config_path ??
      homeRuntimeProbe?.resolved_config_path ??
      null,
    runtime_cwd:
      reviewProbe?.runtimeConfigVerification.runtime_cwd ??
      homeRuntimeProbe?.process_cwd ??
      null,
    review_identity_status: identityVerdict.review_identity_status,
    mismatch_stage: identityVerdict.mismatch_stage,
    site_config_snapshot_path: siteArtifacts.paths.configSnapshotPath,
    site_source_summary_path: siteArtifacts.paths.sourceSummaryPath,
    site_identity_scan_path: siteArtifacts.paths.identityScanPath,
  };
  await writeScreenshotManifest(manifestPath, manifestBase);

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

    // Update project status BEFORE job status (see generate success comment)
    await db
      .from("projects")
      .update({ status: "build_failed" })
      .eq("id", project.id);

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
          review_manifest: manifestBase,
          review_probe: reviewProbe,
          runtime_config_probe: runtimeConfigProbe,
          site_config_snapshot: siteArtifacts.siteConfigSnapshot,
          site_source_summary: siteArtifacts.siteSourceSummary,
          site_identity_scan: siteArtifacts.siteIdentityScan,
          review_identity_status: identityVerdict.review_identity_status,
          mismatch_stage: identityVerdict.mismatch_stage,
          ...(diagMessage ? { diagnostic: diagMessage } : {}),
        },
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 50_000),
        completed_at: now,
      })
      .eq("id", job.id);

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
        review_manifest_path: manifestBase.manifest_path,
        review_probe_path: reviewProbe?.probePath ?? null,
        runtime_config_probe_path: manifestBase.runtime_config_probe_path,
        review_served_title: runtime.servedTitle,
        review_served_url: runtime.servedUrl,
        content_verification: reviewProbe?.contentVerification,
        runtime_config_verification: reviewProbe?.runtimeConfigVerification,
        site_config_snapshot_path: siteArtifacts.paths.configSnapshotPath,
        site_source_summary_path: siteArtifacts.paths.sourceSummaryPath,
        site_identity_scan_path: siteArtifacts.paths.identityScanPath,
        review_identity_status: identityVerdict.review_identity_status,
        mismatch_stage: identityVerdict.mismatch_stage,
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
  const screenshotCount = screenshotFiles.length;

  // Success — update project status BEFORE job status (see generate success comment)
  await db
    .from("projects")
    .update({
      status: "review_ready",
      ...(reviewRevisionId ? { last_reviewed_revision_id: reviewRevisionId } : {}),
    })
    .eq("id", project.id);

  // Upload screenshots to Supabase storage + create asset records
  const uploadedScreenshots: Array<{
    asset_id: string | null;
    file_name: string;
    storage_path: string;
    file_size: number;
    checksum_sha256: string;
  }> = [];
  try {
    for (const file of screenshotFiles) {
      const filePath = join(screenshotsDir, file.file_name);
      const fileData = await readFile(filePath);
      const storagePath = `${project.id}/${job.id}/${file.file_name}`;

      const { error: uploadError } = await db.storage
        .from("review-screenshots")
        .upload(storagePath, fileData, {
          contentType: file.file_name.endsWith(".png") ? "image/png" : "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        console.error(`[worker] Screenshot upload failed for ${file.file_name}:`, uploadError.message);
        continue;
      }

      // Create asset record linked to project, job, and revision
      const { data: assetRow, error: assetError } = await db
        .from("assets")
        .insert({
          project_id: project.id,
          file_name: file.file_name,
          file_type: file.file_name.endsWith(".png") ? "image/png" : "image/jpeg",
          file_size: fileData.length,
          storage_path: storagePath,
          category: "image",
          asset_type: "review_screenshot",
          source_job_id: job.id,
          request_revision_id: reviewRevisionId,
          checksum_sha256: file.sha256,
          metadata: {
            manifest_path: manifestBase.manifest_path,
            local_path: file.path,
            review_started_at: reviewStartedAt,
            review_completed_at: now,
            served_title: runtime.servedTitle,
            served_url: runtime.servedUrl,
          },
        })
        .select("id")
        .single();

      if (assetError) {
        console.error(`[worker] Asset insert failed for ${file.file_name}:`, assetError.message);
        continue;
      }

      file.uploaded_asset_id = assetRow?.id ?? null;
      file.uploaded_storage_path = storagePath;
      file.uploaded_at = now;
      uploadedScreenshots.push({
        asset_id: assetRow?.id ?? null,
        file_name: file.file_name,
        storage_path: storagePath,
        file_size: fileData.length,
        checksum_sha256: file.sha256,
      });
    }

    console.log(`[worker] Uploaded ${uploadedScreenshots.length} screenshots to Supabase for ${slug}`);
  } catch (err) {
    console.error("[worker] Screenshot upload to Supabase failed:", err);
    // Non-fatal — screenshots are still on disk
  }

  const uploadedByName = new Map(uploadedScreenshots.map((file) => [file.file_name, file]));
  const missingInUpload = screenshotFiles
    .filter((file) => !uploadedByName.has(file.file_name))
    .map((file) => file.file_name);
  const extraUploaded = uploadedScreenshots
    .filter((file) => !screenshotFiles.some((manifestFile) => manifestFile.file_name === file.file_name))
    .map((file) => file.file_name);
  const hashMismatches = screenshotFiles
    .filter((file) => {
      const uploaded = uploadedByName.get(file.file_name);
      return uploaded != null && uploaded.checksum_sha256 !== file.sha256;
    })
    .map((file) => file.file_name);
  const uploadSummary = {
    compared_at: now,
    matched:
      missingInUpload.length === 0 &&
      extraUploaded.length === 0 &&
      hashMismatches.length === 0 &&
      uploadedScreenshots.length === screenshotFiles.length,
    manifest_count: screenshotFiles.length,
    uploaded_count: uploadedScreenshots.length,
    missing_in_upload: missingInUpload,
    extra_uploaded: extraUploaded,
    hash_mismatches: hashMismatches,
  };
  manifestBase.upload_summary = uploadSummary;
  await writeScreenshotManifest(manifestPath, manifestBase);

  await db
    .from("jobs")
    .update({
      status: "completed",
      result: {
        success: true,
        message:
          `Review complete — ${screenshotCount} screenshots captured` +
          (identityVerdict.review_identity_status === "mismatched"
            ? ` WARNING: identity mismatch (${identityVerdict.mismatch_stage})`
            : ""),
        artifacts: [screenshotsDir, manifestPath],
        command: fullCommand,
        exit_code: exitCode,
        validation,
        site_age: siteAge,
        screenshot_count: screenshotCount,
        review_manifest: manifestBase,
        review_probe: reviewProbe,
        runtime_config_probe: runtimeConfigProbe,
        site_config_snapshot: siteArtifacts.siteConfigSnapshot,
        site_source_summary: siteArtifacts.siteSourceSummary,
        site_identity_scan: siteArtifacts.siteIdentityScan,
        review_identity_status: identityVerdict.review_identity_status,
        mismatch_stage: identityVerdict.mismatch_stage,
        uploaded_screenshots: uploadedScreenshots,
        upload_summary: uploadSummary,
      },
      stdout: stdout.slice(0, 50_000),
      stderr: stderr.slice(0, 50_000),
      completed_at: now,
    })
    .eq("id", job.id);

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
      review_manifest_path: manifestBase.manifest_path,
      review_probe_path: reviewProbe?.probePath ?? null,
      runtime_config_probe_path: manifestBase.runtime_config_probe_path,
      review_served_title: runtime.servedTitle,
      review_served_url: runtime.servedUrl,
      content_verification: reviewProbe?.contentVerification,
      runtime_config_verification: reviewProbe?.runtimeConfigVerification,
      site_config_snapshot_path: siteArtifacts.paths.configSnapshotPath,
      site_source_summary_path: siteArtifacts.paths.sourceSummaryPath,
      site_identity_scan_path: siteArtifacts.paths.identityScanPath,
      review_identity_status: identityVerdict.review_identity_status,
      mismatch_stage: identityVerdict.mismatch_stage,
      upload_summary: uploadSummary,
    },
  });

  await notifyDiscordTransition(db, project, "review_completed");

  console.log(
    `[worker] Review complete for ${slug} (${screenshotCount} screenshots, site ${siteAge}, upload match: ${uploadSummary.matched ? "yes" : "no"}, identity: ${identityVerdict.review_identity_status}/${identityVerdict.mismatch_stage ?? "none"})`,
  );
}

function parseDeploymentPayload(
  raw: string,
): { payload: DeploymentPayload | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { payload: null, errors: ["deployment-payload.json is not valid JSON"] };
  }

  const payload = parsed as Partial<DeploymentPayload>;
  const errors: string[] = [];

  if (payload.version !== "1.0.0") errors.push("version must be 1.0.0");
  if (!payload.clientSlug) errors.push("clientSlug is missing");
  if (!payload.sitePath) errors.push("sitePath is missing");
  if (!payload.outputDir) errors.push("outputDir is missing");
  if (payload.framework !== "nextjs") errors.push("framework must be nextjs");
  if (!payload.domain?.subdomain) errors.push("domain.subdomain is missing");
  if (!payload.metadata?.templateId) errors.push("metadata.templateId is missing");
  if (!Array.isArray(payload.metadata?.moduleIds)) errors.push("metadata.moduleIds is missing");
  if (!payload.metadata?.businessName) errors.push("metadata.businessName is missing");
  if (!payload.metadata?.businessType) errors.push("metadata.businessType is missing");

  return {
    payload: errors.length === 0 ? (payload as DeploymentPayload) : null,
    errors,
  };
}

async function executeDeploymentPrepare(
  db: ReturnType<typeof createWorkerClient>,
  job: JobRow,
  project: ProjectRow,
) {
  const repoRoot = resolveRepoRoot();
  const slug = project.slug;
  const payloadPath = join(repoRoot, "generated", slug, "deployment-payload.json");
  const now = new Date().toISOString();

  const { data: deploymentRun } = await db
    .from("deployment_runs")
    .select("id")
    .eq("job_id", job.id)
    .maybeSingle();

  if (deploymentRun?.id) {
    await db
      .from("deployment_runs")
      .update({
        status: "running",
        started_at: now,
        updated_at: now,
      })
      .eq("id", deploymentRun.id);
  }

  let rawPayload: string;
  try {
    rawPayload = await readFile(payloadPath, "utf-8");
  } catch (error) {
    const message = `deployment-payload.json not found at generated/${slug}/deployment-payload.json`;

    await db.from("projects").update({ status: "deploy_failed" }).eq("id", project.id);
    await db
      .from("jobs")
      .update({
        status: "failed",
        result: { success: false, message },
        stderr: error instanceof Error ? error.message.slice(0, 50_000) : String(error).slice(0, 50_000),
        completed_at: now,
      })
      .eq("id", job.id);

    if (deploymentRun?.id) {
      await db
        .from("deployment_runs")
        .update({
          status: "failed",
          error_summary: message,
          completed_at: now,
          updated_at: now,
        })
        .eq("id", deploymentRun.id);
    }

    await db.from("project_events").insert({
      project_id: project.id,
      event_type: "deployment_prepare_failed",
      from_status: project.status,
      to_status: "deploy_failed",
      metadata: { job_id: job.id, error: message, payload_path: payloadPath },
    });
    return;
  }

  const parsed = parseDeploymentPayload(rawPayload);
  if (!parsed.payload) {
    const message = `Deployment payload validation failed: ${parsed.errors.join("; ")}`;

    await db.from("projects").update({ status: "deploy_failed" }).eq("id", project.id);
    await db
      .from("jobs")
      .update({
        status: "failed",
        result: { success: false, message, errors: parsed.errors },
        stderr: parsed.errors.join("\n").slice(0, 50_000),
        completed_at: now,
      })
      .eq("id", job.id);

    if (deploymentRun?.id) {
      await db
        .from("deployment_runs")
        .update({
          status: "failed",
          error_summary: message,
          payload_metadata: {
            payload_path: payloadPath,
            validation_errors: parsed.errors,
          },
          completed_at: now,
          updated_at: now,
        })
        .eq("id", deploymentRun.id);
    }

    await db.from("project_events").insert({
      project_id: project.id,
      event_type: "deployment_prepare_failed",
      from_status: project.status,
      to_status: "deploy_failed",
      metadata: { job_id: job.id, error: message, validation_errors: parsed.errors },
    });
    return;
  }

  const payload = parsed.payload;
  const summary = {
    framework: payload.framework,
    subdomain: payload.domain.subdomain,
    templateId: payload.metadata.templateId,
    moduleCount: payload.metadata.moduleIds.length,
    businessName: payload.metadata.businessName,
  };

  await db.from("projects").update({ status: "deploy_ready" }).eq("id", project.id);
  await db
    .from("jobs")
    .update({
      status: "completed",
      result: {
        success: true,
        message: "Deployment payload prepared and validated",
        payload_path: payloadPath,
        payload_summary: summary,
      },
      completed_at: now,
    })
    .eq("id", job.id);

  if (deploymentRun?.id) {
    await db
      .from("deployment_runs")
      .update({
        status: "validated",
        payload_metadata: {
          payload_path: payloadPath,
          summary,
          payload,
        },
        log_summary: "Deployment payload prepared and validated. Provider automation remains pending.",
        completed_at: now,
        updated_at: now,
      })
      .eq("id", deploymentRun.id);
  }

  await db.from("project_events").insert({
    project_id: project.id,
    event_type: "deployment_prepared",
    from_status: project.status,
    to_status: "deploy_ready",
    metadata: { job_id: job.id, payload_path: payloadPath, payload_summary: summary },
  });
}

// ── Provider deployment execution ─────────────────────────────────────

async function executeDeploymentProviders(
  db: ReturnType<typeof createWorkerClient>,
  job: JobRow,
  project: ProjectRow,
) {
  const now = new Date().toISOString();
  const payload = job.payload as Record<string, unknown>;
  const deploymentRunId = typeof payload.deployment_run_id === "string" ? payload.deployment_run_id : null;

  // Find the deployment run
  const { data: deploymentRun } = deploymentRunId
    ? await db.from("deployment_runs").select("id, status, payload_metadata").eq("id", deploymentRunId).maybeSingle()
    : await db.from("deployment_runs").select("id, status, payload_metadata").eq("job_id", job.id).maybeSingle();

  if (!deploymentRun) {
    await db
      .from("jobs")
      .update({
        status: "failed",
        result: { success: false, message: "No deployment run found for this job." },
        completed_at: now,
      })
      .eq("id", job.id);
    return;
  }

  // Deployment run must be validated before provider execution
  if (deploymentRun.status !== "validated") {
    const message = `Deployment run is not validated (status: ${deploymentRun.status}). Cannot execute providers.`;
    await db
      .from("jobs")
      .update({
        status: "failed",
        result: { success: false, message },
        completed_at: now,
      })
      .eq("id", job.id);
    return;
  }

  // Mark deployment run as running
  await db
    .from("deployment_runs")
    .update({
      status: "running",
      started_at: now,
      updated_at: now,
    })
    .eq("id", deploymentRun.id);

  // Extract validated payload from deployment run metadata
  const meta = (deploymentRun.payload_metadata ?? {}) as Record<string, unknown>;
  const validatedPayload = (meta.payload ?? {}) as Record<string, unknown>;
  const payloadSummary = (meta.summary ?? {}) as Record<string, unknown>;

  // Execute provider adapters
  const result = await executeProviderAdapters({
    deploymentRunId: deploymentRun.id,
    projectId: project.id,
    targetSlug: project.slug,
    payload: validatedPayload,
    payloadSummary,
  });

  const completedAt = new Date().toISOString();
  const liveProviderSucceeded = result.steps.some(
    (step) =>
      (step.provider === "vercel" || step.provider === "domain") &&
      step.status === "succeeded",
  );

  if (
    result.status === "not_configured" ||
    result.status === "not_implemented" ||
    result.status === "unsupported"
  ) {
    // Provider boundary reached, but no live provider deployment occurred.
    // Record clearly and keep the run in validated state rather than faking deploy success.
    await db
      .from("jobs")
      .update({
        status: "completed",
        result: {
          success: true,
          message: result.summary,
          artifacts: [],
        },
        completed_at: completedAt,
      })
      .eq("id", job.id);

    await db
      .from("deployment_runs")
      .update({
        status: "validated",
        provider: result.steps.map((s) => s.provider).join(",") || "unconfigured",
        log_summary: result.summary,
        payload_metadata: {
          ...meta,
          provider_execution: {
            status: result.status,
            summary: result.summary,
            steps: result.steps,
            executed_at: completedAt,
          },
        },
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", deploymentRun.id);

    await db.from("project_events").insert({
      project_id: project.id,
      event_type:
        result.status === "not_configured"
          ? "deployment_providers_not_configured"
          : result.status === "not_implemented"
            ? "deployment_providers_not_implemented"
            : "deployment_providers_unsupported",
      from_status: project.status,
      to_status: project.status,
      metadata: { job_id: job.id, deployment_run_id: deploymentRun.id, summary: result.summary },
    });
    return;
  }

  if (result.status === "succeeded") {
    const providerRefs = result.steps
      .filter((s) => s.providerReference)
      .map((s) => `${s.provider}: ${s.providerReference}`)
      .join(", ");

    await db
      .from("jobs")
      .update({
        status: "completed",
        result: {
          success: true,
          message: result.summary,
          artifacts: [],
        },
        completed_at: completedAt,
      })
      .eq("id", job.id);

    await db
      .from("deployment_runs")
      .update({
        status: "validated",
        provider: result.steps.map((s) => s.provider).join(","),
        provider_reference: providerRefs || null,
        log_summary: result.summary,
        payload_metadata: {
          ...meta,
          provider_execution: {
            status: result.status,
            summary: result.summary,
            steps: result.steps,
            executed_at: completedAt,
          },
        },
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", deploymentRun.id);

    if (liveProviderSucceeded) {
      await db.from("projects").update({ status: "deployed" }).eq("id", project.id);
      await db.from("project_events").insert({
        project_id: project.id,
        event_type: "deployment_completed",
        from_status: project.status,
        to_status: "deployed",
        metadata: { job_id: job.id, deployment_run_id: deploymentRun.id, provider_references: providerRefs },
      });
    } else {
      await db.from("project_events").insert({
        project_id: project.id,
        event_type: "deployment_provider_executed",
        from_status: project.status,
        to_status: project.status,
        metadata: {
          job_id: job.id,
          deployment_run_id: deploymentRun.id,
          provider_references: providerRefs,
          summary: result.summary,
        },
      });
    }
    return;
  }

  // Failed
  const failedSteps = result.steps.filter((s) => s.status === "failed");
  const errorSummary = failedSteps.map((s) => `${s.provider}: ${s.message}`).join("; ");

  await db.from("projects").update({ status: "deploy_failed" }).eq("id", project.id);
  await db
    .from("jobs")
    .update({
      status: "failed",
      result: {
        success: false,
        message: result.summary,
        error: errorSummary,
      },
      completed_at: completedAt,
    })
    .eq("id", job.id);

  await db
    .from("deployment_runs")
    .update({
      status: "failed",
      error_summary: errorSummary,
      payload_metadata: {
        ...meta,
        provider_execution: {
          status: result.status,
          summary: result.summary,
          steps: result.steps,
          executed_at: completedAt,
        },
      },
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", deploymentRun.id);

  await db.from("project_events").insert({
    project_id: project.id,
    event_type: "deployment_provider_failed",
    from_status: project.status,
    to_status: "deploy_failed",
    metadata: { job_id: job.id, deployment_run_id: deploymentRun.id, error: errorSummary, steps: result.steps },
  });
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
