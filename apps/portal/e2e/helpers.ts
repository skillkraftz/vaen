import { Page, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Output directory ─────────────────────────────────────────────────

/** Generates a timestamped output directory under artifacts/portal-flows/ */
export function createOutputDir(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const dir = join(
    process.cwd(),
    "..",
    "..",
    "artifacts",
    "portal-flows",
    ts,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Screenshot capture ───────────────────────────────────────────────

let stepIndex = 0;

export function resetStepIndex() {
  stepIndex = 0;
}

/**
 * Take a full-page screenshot with an ordered filename.
 * Also records metadata for the notes artifact.
 */
export async function snap(
  page: Page,
  outputDir: string,
  name: string,
  meta?: { status?: string; cta?: string; note?: string },
): Promise<string> {
  stepIndex++;
  const padded = String(stepIndex).padStart(2, "0");
  const filename = `${padded}-${name}.png`;
  const filepath = join(outputDir, filename);
  await page.screenshot({ path: filepath, fullPage: true });

  // Record step metadata for notes
  stepLog.push({
    index: stepIndex,
    filename,
    name,
    status: meta?.status ?? null,
    cta: meta?.cta ?? null,
    note: meta?.note ?? null,
  });

  return filepath;
}

// ── Waiting helpers ──────────────────────────────────────────────────

/** Read the current workflow status label text */
export async function getStatusText(page: Page): Promise<string> {
  const label = page.getByTestId("workflow-status-label");
  if (await label.isVisible().catch(() => false)) {
    return (await label.textContent()) ?? "";
  }
  return "";
}

/** Wait for the revision list to finish loading */
export async function waitForRevisionsLoaded(page: Page): Promise<void> {
  const loading = page.getByTestId("revisions-loading");
  // If loading indicator is visible, wait for it to disappear
  if (await loading.isVisible().catch(() => false)) {
    await expect(loading).toBeHidden({ timeout: 10_000 });
  }
  // Small settle for content to render
  await page.waitForTimeout(500);
}

/**
 * Wait for an active job to complete. Polls the job-running-indicator
 * and job status badges. Returns the final status text.
 *
 * Generate jobs can take ~60s, review jobs ~120s.
 */
export async function waitForJobCompletion(
  page: Page,
  timeoutMs = 180_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  // First wait for the job to appear (pending/running indicator)
  await page.waitForTimeout(2000);

  // Now wait for the running indicator to disappear
  while (Date.now() < deadline) {
    const running = page.getByTestId("job-running-indicator");
    if (!(await running.isVisible().catch(() => false))) {
      // Job no longer active — give the UI time to refresh
      await page.waitForTimeout(2000);
      break;
    }
    await page.waitForTimeout(3000);
  }

  if (Date.now() >= deadline) {
    throw new Error(`Job did not complete within ${timeoutMs / 1000}s`);
  }

  return getStatusText(page);
}

// ── Notes artifact ───────────────────────────────────────────────────

interface StepRecord {
  index: number;
  filename: string;
  name: string;
  status: string | null;
  cta: string | null;
  note: string | null;
}

const stepLog: StepRecord[] = [];
const blockers: string[] = [];
const observations: string[] = [];

export function addBlocker(msg: string) {
  blockers.push(msg);
}

export function addObservation(msg: string) {
  if (!observations.includes(msg)) observations.push(msg);
}

export function writeAuditNotes(
  outputDir: string,
  opts: {
    portalUrl: string;
    projectName: string;
    slug: string;
    startTime: Date;
    reachedGenerate: boolean;
    reachedReview: boolean;
    reachedScreenshots: boolean;
  },
): void {
  const elapsed = ((Date.now() - opts.startTime.getTime()) / 1000).toFixed(1);

  let md = `# Portal UX Audit
**Date:** ${opts.startTime.toISOString().slice(0, 10)}
**Portal:** ${opts.portalUrl}
**Project:** ${opts.projectName} (\`${opts.slug}\`)
**Duration:** ${elapsed}s
**Screenshots:** ${stepLog.length}

## Workflow Completion
| Stage | Reached |
|-------|---------|
| Login & Dashboard | yes |
| Create Project | yes |
| Process Intake | yes |
| Approve & Export | yes |
| Generate Site | ${opts.reachedGenerate ? "yes" : "**NO**"} |
| Build & Review | ${opts.reachedReview ? "yes" : "**NO**"} |
| Screenshot Viewer | ${opts.reachedScreenshots ? "yes" : "**NO**"} |

## Screenshot Log
| # | File | Status | Primary CTA | Notes |
|---|------|--------|-------------|-------|
`;

  for (const step of stepLog) {
    md += `| ${step.index} | \`${step.filename}\` | ${step.status ?? "-"} | ${step.cta ?? "-"} | ${step.note ?? "-"} |\n`;
  }

  if (blockers.length > 0) {
    md += `\n## Blockers\n`;
    for (const b of blockers) md += `- ${b}\n`;
  }

  md += `\n## UX Observations\n`;
  // Auto-populated observations
  addObservation("Page is single-column and vertically long — requires significant scrolling");
  addObservation("Advanced/operator sections (Recovery, Diagnostics) are always visible on the main project page");
  if (!opts.reachedGenerate) addObservation("Generate was NOT reached in this run");
  if (!opts.reachedReview) addObservation("Review was NOT reached in this run");
  if (!opts.reachedScreenshots) addObservation("Screenshot viewer with real screenshots was NOT populated in this run");

  for (const o of observations) md += `- ${o}\n`;

  md += `
## Known Issues (do not fix in this pass)

### maps-embed module inconsistency
The \`maps-embed\` module is inconsistently included during intake processing.
It sometimes appears and sometimes doesn't depending on business type parsing.
Needs investigation in \`intake-processor.ts\`.

### screenshot-by-revision organization
Screenshots are stored flat in Supabase storage, not organized by revision.
The ScreenshotViewer filters by \`last_reviewed_revision_id\`, but stale
screenshots from prior revisions remain in storage. Needs a storage cleanup
step or revision-prefixed paths.
`;

  writeFileSync(join(outputDir, "notes.md"), md);
}
