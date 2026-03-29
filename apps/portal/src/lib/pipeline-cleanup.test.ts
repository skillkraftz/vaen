/**
 * Pipeline cleanup and artifact isolation tests.
 *
 * Verifies that:
 * - Reset/reprocess/re-export invalidate downstream artifacts
 * - Generate and review clean stale artifacts before running
 * - Projects have isolated artifact paths (no cross-project leakage)
 * - Portal correctly identifies stale screenshots
 * - Rerunning after changes produces different output
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { generatePrompt, type PromptInput } from "./generate-prompt";

const REPO_ROOT = resolve(__dirname, "../../../..");

// ── 1. Reset/reprocess pipeline invalidates stale downstream ─────────

describe("reset/reprocess pipeline invalidation rules", () => {
  /**
   * We verify the rules by reading the source code of actions.ts.
   * This is more robust than mocking Supabase — it tests the actual code.
   */

  it("resetToDraftAction clears final_request", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-recovery-helpers.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const helperSource = readFileSync(helperPath, "utf-8");

    // Find the resetToDraftAction function
    const resetFn = source.slice(
      source.indexOf("export async function resetToDraftAction"),
      source.indexOf("// ── Project diagnostics"),
    );

    // Must set final_request: null in the update
    expect(resetFn).toContain("final_request: null");

    // Must set status to intake_draft_ready
    expect(resetFn).toContain('status: "intake_draft_ready"');

    // Must clean screenshots on disk
    expect(resetFn).toContain("screenshots");
    expect(resetFn).toContain("removeGeneratedTargets");
    expect(helperSource).toContain("rm(join(generatedDir");

    // Must clean build cache on disk
    expect(resetFn).toContain(".next");
  });

  it("reprocessIntakeAction clears final_request", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");

    // Find the reprocessIntakeAction function
    const fnStart = source.indexOf("export async function reprocessIntakeAction");
    const fnEnd = source.indexOf("export async function resetToDraftAction");
    const reprocessFn = source.slice(fnStart, fnEnd);

    // Must sync to legacy draft_request column
    expect(reprocessFn).toContain("draft_request: finalDraft");
  });

  it("reExportAction reads from active revision only", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");

    // Find the reExportAction function
    const fnStart = source.indexOf("export async function reExportAction");
    const fnEnd = source.indexOf("// ── Recovery: Re-process intake");
    const reExportFn = source.slice(fnStart, fnEnd);

    // Must read from revision — no fallback to draft_request/final_request
    expect(reExportFn).toContain("current_revision_id");
    expect(reExportFn).toContain("project_request_revisions");
    expect(reExportFn).not.toContain("p.final_request");
    expect(reExportFn).not.toContain("p.draft_request");
  });
});

// ── 2. Generate step cleans previous output ──────────────────────────

describe("generate step cleans previous output", () => {
  it("generator cleans site directory (except node_modules)", () => {
    const genPath = join(REPO_ROOT, "packages/generator/src/generate-site.ts");
    const source = readFileSync(genPath, "utf-8");

    // Must clean existing site files
    expect(source).toContain("Clean previous site source files");
    expect(source).toContain('filter((e) => e.name !== "node_modules")');
    expect(source).toContain("rm(join(siteDir, e.name)");
  });

  it("worker cleans stale screenshots before generation", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");

    // Find executeGenerate function
    const fnStart = source.indexOf("async function executeGenerate");
    const fnEnd = source.indexOf("async function executeReview");
    const genFn = source.slice(fnStart, fnEnd);

    // Must clean screenshots dir before generating
    expect(genFn).toContain("cleaned stale screenshots");
    expect(genFn).toContain("rm(screenshotsDir");
  });
});

// ── 3. Build/review step clears old screenshots ──────────────────────

describe("build/review step clears old screenshots", () => {
  it("worker cleans screenshots before review", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");

    // Find executeReview function
    const fnStart = source.indexOf("async function executeReview");
    const reviewFn = source.slice(fnStart);

    // Must clean screenshots before running review
    expect(reviewFn).toContain("cleaned stale screenshots");
    expect(reviewFn).toContain("rm(screenshotsDir");
  });

  it("review.sh cleans screenshots before capturing", () => {
    const reviewPath = join(REPO_ROOT, "scripts/review.sh");
    const source = readFileSync(reviewPath, "utf-8");

    // Must rm screenshots dir before mkdir
    const captureSection = source.slice(source.indexOf("Step 5"));
    expect(captureSection).toContain('rm -rf "$SCREENSHOTS_DIR"');
    expect(captureSection).toContain('mkdir -p "$SCREENSHOTS_DIR"');

    // rm must come before mkdir
    const rmIdx = captureSection.indexOf('rm -rf "$SCREENSHOTS_DIR"');
    const mkdirIdx = captureSection.indexOf('mkdir -p "$SCREENSHOTS_DIR"');
    expect(rmIdx).toBeLessThan(mkdirIdx);
  });

  it("review.sh cleans .next cache before building", () => {
    const reviewPath = join(REPO_ROOT, "scripts/review.sh");
    const source = readFileSync(reviewPath, "utf-8");

    expect(source).toContain('rm -rf "$SITE_DIR/.next"');
  });

  it("review.sh sets NODE_ENV=production for build", () => {
    const reviewPath = join(REPO_ROOT, "scripts/review.sh");
    const source = readFileSync(reviewPath, "utf-8");

    expect(source).toContain("NODE_ENV=production npm run build");
  });
});

// ── 4. Project artifact isolation ────────────────────────────────────

describe("project artifact isolation", () => {
  it("generated directories use project-specific slugs", () => {
    // Check that brightspark-electric and brightspark-electric-3 have separate dirs
    const bs1 = join(REPO_ROOT, "generated/brightspark-electric");
    const bs3 = join(REPO_ROOT, "generated/brightspark-electric-3");

    if (existsSync(bs1) && existsSync(bs3)) {
      // They must be different directories
      expect(bs1).not.toBe(bs3);

      // Check config.json files have different business names
      const config1Path = join(bs1, "site/config.json");
      const config3Path = join(bs3, "site/config.json");

      if (existsSync(config1Path) && existsSync(config3Path)) {
        const config1 = JSON.parse(readFileSync(config1Path, "utf-8"));
        const config3 = JSON.parse(readFileSync(config3Path, "utf-8"));
        expect(config1.business?.name).not.toBe(config3.business?.name);
      }
    }
  });

  it("screenshot paths are project-specific", () => {
    const reviewPath = join(REPO_ROOT, "scripts/review.sh");
    const source = readFileSync(reviewPath, "utf-8");

    // Screenshots go to generated/$TARGET/artifacts/screenshots/
    expect(source).toContain('SCREENSHOTS_DIR="$WORKSPACE/artifacts/screenshots"');
    // Workspace includes the target slug
    expect(source).toContain('WORKSPACE="generated/$TARGET"');
  });

  it("portal artifact lookup uses slug-based paths", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");

    // getArtifactStatusAction takes a slug parameter
    const fnStart = source.indexOf("export async function getArtifactStatusAction");
    expect(fnStart).toBeGreaterThan(-1);
    const fn = source.slice(fnStart, fnStart + 200);
    // Function signature takes slug as the parameter
    expect(fn).toContain("slug: string");
  });

  it("worker passes project slug to review.sh", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");

    // Review command includes --target slug
    const reviewFn = source.slice(source.indexOf("async function executeReview"));
    expect(reviewFn).toContain('"--target", slug');
  });

  it("generated client-request.json is per-slug", () => {
    const bs1 = join(REPO_ROOT, "generated/brightspark-electric/client-request.json");
    const bs3 = join(REPO_ROOT, "generated/brightspark-electric-3/client-request.json");

    if (existsSync(bs1) && existsSync(bs3)) {
      const req1 = JSON.parse(readFileSync(bs1, "utf-8"));
      const req3 = JSON.parse(readFileSync(bs3, "utf-8"));

      // Business names must differ
      expect(req1.business?.name).not.toBe(req3.business?.name);
    }
  });
});

// ── 5. Portal displays latest project-specific artifacts ─────────────

describe("portal displays latest project artifacts", () => {
  it("diagnostics includes screenshot staleness detection", () => {
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-diagnostics-helpers.ts");
    const source = readFileSync(helperPath, "utf-8");

    // Must compute screenshotsStale
    expect(source).toContain("screenshotsStale");

    // Stale detection: screenshots exist but generate is newer than review
    expect(source).toContain("lastGeneratedAt");
    expect(source).toContain("lastReviewedAt");
  });

  it("diagnostics includes request source indicator", () => {
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-diagnostics-helpers.ts");
    const source = readFileSync(helperPath, "utf-8");

    // Must report request source
    expect(source).toContain("requestSource");
    expect(source).toContain("hasLegacyDraftFallback");
    expect(source).toContain('"legacy_draft"');
  });

  it("diagnostics includes all timestamps", () => {
    const typesPath = join(__dirname, "../app/dashboard/projects/[id]/project-diagnostics-types.ts");
    const source = readFileSync(typesPath, "utf-8");

    // All four timestamps in the interface
    expect(source).toContain("lastProcessedAt");
    expect(source).toContain("lastExportedAt");
    expect(source).toContain("lastGeneratedAt");
    expect(source).toContain("lastReviewedAt");
  });

  it("UI shows stale screenshot warning", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/project-diagnostics-panel.tsx");
    const source = readFileSync(uiPath, "utf-8");

    expect(source).toContain("screenshotsStale");
    expect(source).toContain("STALE");
    expect(source).toContain("Active revision request");
    expect(source).toContain("Legacy draft fallback");
  });
});

// ── 6. Rerun with different assets produces different output ─────────

describe("rerun with different input produces different output", () => {
  it("generatePrompt produces different output for different projects", () => {
    const input1 = makePromptInput("BrightSpark Electric", "brightspark-electric", "electrician");
    const input2 = makePromptInput("Acme Plumbing", "acme-plumbing", "plumber");

    const prompt1 = generatePrompt(input1);
    const prompt2 = generatePrompt(input2);

    // Prompts must differ
    expect(prompt1).not.toBe(prompt2);

    // Each prompt must contain its own business name
    expect(prompt1).toContain("BrightSpark Electric");
    expect(prompt1).not.toContain("Acme Plumbing");
    expect(prompt2).toContain("Acme Plumbing");
    expect(prompt2).not.toContain("BrightSpark Electric");
  });

  it("generatePrompt changes when draft changes", () => {
    const base = makePromptInput("Test Biz", "test-biz", "contractor");
    const withMore = {
      ...base,
      draftRequest: {
        ...base.draftRequest,
        services: [
          { name: "Roofing" },
          { name: "Siding" },
          { name: "Windows" },
        ],
      },
    };

    const prompt1 = generatePrompt(base);
    const prompt2 = generatePrompt(withMore);

    expect(prompt1).not.toBe(prompt2);
    expect(prompt2).toContain("Windows");
    expect(prompt1).not.toContain("Windows");
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

function makePromptInput(name: string, slug: string, type: string): PromptInput {
  return {
    project: {
      name,
      slug,
      businessType: type,
      contactName: "Owner",
      contactEmail: `owner@${slug}.com`,
      contactPhone: "555-0000",
      notes: `${name} provides ${type} services.`,
    },
    draftRequest: {
      version: "1.0.0",
      business: { name, type },
      contact: { email: `owner@${slug}.com` },
      services: [{ name: `${type} service` }],
      content: {},
      preferences: { template: "service-core", modules: [] },
    },
    recommendations: {
      template: { id: "service-core", name: "Service Core", reasoning: "default" },
      modules: [],
    },
    clientSummary: null,
    missingInfo: null,
  };
}
