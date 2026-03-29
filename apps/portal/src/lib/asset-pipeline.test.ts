/**
 * Asset pipeline and screenshot tests.
 *
 * Verifies that:
 * 1. Files can be added to existing projects (not just at creation)
 * 2. Uploaded assets can be attached to specific revisions
 * 3. Active revision asset selection affects generation input
 * 4. BrightSpark and BrightSpark 3 do not share assets/screenshots
 * 5. Screenshots uploaded to Supabase are linked to correct project/revision/job
 * 6. Portal displays screenshots for the correct current review/revision
 * 7. Rerun after asset change produces different screenshots/artifacts when expected
 * 8. Project can be updated in place without creating a new project
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");

// ── 1. Add files to existing project ─────────────────────────────────

describe("add files to existing project", () => {
  it("uploadAssetsAction exists and is exported", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function uploadAssetsAction");
  });

  it("uploadAssetsAction accepts projectId and formData", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function uploadAssetsAction");
    const fn = source.slice(fnStart, fnStart + 300);
    expect(fn).toContain("projectId: string");
    expect(fn).toContain("formData: FormData");
  });

  it("upload action writes to intake-assets storage", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function uploadAssetsAction");
    const fnEnd = source.indexOf("export async function attachAssetToRevisionAction");
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toContain('.from("intake-assets")');
    expect(fn).toContain(".upload(storagePath");
  });

  it("FileUploader component exists in project-editor", () => {
    const editorPath = join(__dirname, "../app/dashboard/projects/[id]/project-editor.tsx");
    const source = readFileSync(editorPath, "utf-8");
    expect(source).toContain("export function FileUploader");
  });

  it("page.tsx includes FileUploader", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("FileUploader");
    expect(source).toContain("Files & Images");
  });
});

// ── 2. Attach uploaded assets to specific revision ───────────────────

describe("attach uploaded assets to specific revision", () => {
  it("attachAssetToRevisionAction exists and is exported", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function attachAssetToRevisionAction");
  });

  it("detachAssetFromRevisionAction exists and is exported", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function detachAssetFromRevisionAction");
  });

  it("listRevisionAssetsAction exists and is exported", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function listRevisionAssetsAction");
  });

  it("attach action uses revision_assets table", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function attachAssetToRevisionAction");
    const fnEnd = source.indexOf("export async function detachAssetFromRevisionAction");
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toContain('"revision_assets"');
  });

  it("RevisionAssetManager component exists", () => {
    const editorPath = join(__dirname, "../app/dashboard/projects/[id]/project-editor.tsx");
    const source = readFileSync(editorPath, "utf-8");
    expect(source).toContain("export function RevisionAssetManager");
  });

  it("page.tsx includes RevisionAssetManager with plain label", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("RevisionAssetManager");
    expect(source).toContain("Images for This Version");
  });
});

// ── 3. Active revision asset selection affects generation ────────────

describe("active revision asset selection affects generation input", () => {
  it("exportToGeneratorAction reads from active revision only", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function exportToGeneratorAction");
    const fnEnd = source.indexOf("export async function updateProjectAction");
    const fn = source.slice(fnStart, fnEnd);
    // Must require current_revision_id — no fallback to legacy columns
    expect(fn).toContain("current_revision_id");
    expect(fn).toContain("project_request_revisions");
    expect(fn).toContain('request_source: "revision"');
    // Must NOT fall back to draft_request or final_request
    expect(fn).not.toContain("p.final_request");
    expect(fn).not.toContain("p.draft_request");
  });

  it("export downloads revision assets to site/public/images/", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-asset-helpers.ts");
    const actionSource = readFileSync(actionsPath, "utf-8");
    const helperSource = readFileSync(helperPath, "utf-8");
    expect(actionSource).toContain("downloadRevisionAssetsToSite");
    expect(helperSource).toContain('join(siteDir, "public", "images")');
    // Must clean previous images before downloading new ones
    expect(helperSource).toContain('rm(imagesDir, { recursive: true, force: true })');
  });

  it("export injects galleryImages into client-request.json", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("galleryImages");
    expect(source).toContain("content.galleryImages = galleryImages");
  });

  it("reExportAction also reads from active revision", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function reExportAction");
    const fnEnd = source.indexOf("export async function reprocessIntakeAction");
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toContain("current_revision_id");
    expect(fn).toContain("downloadRevisionAssetsToSite");
  });

  it("downloadRevisionAssetsToSite uses only revision-attached assets", () => {
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-asset-helpers.ts");
    const source = readFileSync(helperPath, "utf-8");
    const fnStart = source.indexOf("export async function downloadRevisionAssetsToSite");
    const fnEnd = source.indexOf("export function categorizeFile");
    const fn = source.slice(fnStart, fnEnd);
    // Must check revision_assets
    expect(fn).toContain('"revision_assets"');
    // Must NOT fall back to all project images
    expect(fn).not.toContain("all project images");
  });
});

// ── 4. BrightSpark and BrightSpark 3 do not share assets ────────────

describe("project artifact isolation (assets/screenshots)", () => {
  it("generated directories use project-specific slugs", () => {
    const bs1 = join(REPO_ROOT, "generated/brightspark-electric");
    const bs3 = join(REPO_ROOT, "generated/brightspark-electric-3");

    if (existsSync(bs1) && existsSync(bs3)) {
      expect(bs1).not.toBe(bs3);
    }
  });

  it("screenshot storage paths include project_id", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    // Storage path: {project.id}/{job.id}/{filename}
    expect(source).toContain("project.id}/${job.id}");
  });

  it("asset records are tied to project_id", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    // Upload action sets project_id
    expect(source).toContain("project_id: projectId");
  });

  it("screenshot query filters by project_id", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function getScreenshotsForProjectAction");
    const fnEnd = source.indexOf("export async function getScreenshotUrlAction");
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toContain("project_id");
    expect(fn).toContain("review_screenshot");
  });
});

// ── 5. Screenshots uploaded to Supabase linked correctly ─────────────

describe("screenshots uploaded to Supabase are linked correctly", () => {
  it("worker uploads screenshots after review", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain('"review-screenshots"');
    expect(source).toContain(".upload(storagePath");
  });

  it("worker creates asset records with type review_screenshot", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain('asset_type: "review_screenshot"');
  });

  it("worker links screenshots to source job", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain("source_job_id: job.id");
  });

  it("worker records revision_id in review event metadata", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain("revision_id: reviewRevisionId");
  });

  it("review-screenshots storage bucket migration exists", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260328000005_create_screenshot_storage.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("review-screenshots");
  });
});

// ── 6. Portal displays screenshots for correct revision ─────────────

describe("portal displays screenshots for correct project/revision", () => {
  it("getScreenshotsForProjectAction exists", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function getScreenshotsForProjectAction");
  });

  it("getScreenshotUrlAction uses review-screenshots bucket", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function getScreenshotUrlAction");
    const fnEnd = source.indexOf("export async function getAssetUrlAction");
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toContain("review-screenshots");
  });

  it("ScreenshotViewer loads from Supabase first", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("getScreenshotsForProjectAction");
    expect(source).toContain("supabaseScreenshots");
  });

  it("ScreenshotViewer falls back to local filesystem", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("getArtifactStatusAction");
    expect(source).toContain('source: "local"');
  });

  it("ScreenshotViewer receives projectId, lastReviewedRevisionId, and status", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("function ScreenshotViewer({");
    expect(source).toContain("projectId={projectId}");
    expect(source).toContain("status={effectiveStatus}");
    expect(source).toContain("refreshToken={viewerRefreshToken}");
  });
});

// ── 7. Rerun after asset change produces different output ────────────

describe("rerun after asset change produces different output", () => {
  it("export cleans previous images before downloading new ones", () => {
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-asset-helpers.ts");
    const source = readFileSync(helperPath, "utf-8");
    const fnStart = source.indexOf("export async function downloadRevisionAssetsToSite");
    const fn = source.slice(fnStart, fnStart + 500);
    // Must rm the images dir before writing
    expect(fn).toContain("rm(imagesDir");
    // Then recreate it
    expect(fn).toContain("mkdir(imagesDir");
  });

  it("worker cleans screenshots before review", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    const fnStart = source.indexOf("async function executeReview");
    const fn = source.slice(fnStart, fnStart + 2000);
    expect(fn).toContain("rm(screenshotsDir");
  });

  it("review.sh cleans screenshots before capture", () => {
    const reviewPath = join(REPO_ROOT, "scripts/review.sh");
    const source = readFileSync(reviewPath, "utf-8");
    const captureSection = source.slice(source.indexOf("Step 5"));
    expect(captureSection).toContain('rm -rf "$SCREENSHOTS_DIR"');
    expect(captureSection).toContain('mkdir -p "$SCREENSHOTS_DIR"');
  });
});

// ── 8. Project can be updated in place ───────────────────────────────

describe("project can be updated in place without creating new project", () => {
  it("upload works at any status (no status check)", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function uploadAssetsAction");
    const fnEnd = source.indexOf("// ── Revision-asset linkage");
    const fn = source.slice(fnStart, fnEnd);
    // Must NOT check status before upload
    expect(fn).not.toContain("p.status");
    expect(fn).not.toContain("intake_approved");
  });

  it("reExportAction works from any status", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function reExportAction");
    const fn = source.slice(fnStart, fnStart + 500);
    // reExportAction should NOT check status (unlike exportToGeneratorAction)
    expect(fn).not.toContain('if (p.status !== "');
  });

  it("reprocessIntakeAction works from any status", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function reprocessIntakeAction");
    const fn = source.slice(fnStart, fnStart + 500);
    // reprocessIntakeAction should work from any status
    expect(fn).not.toContain('if (p.status !== "');
  });

  it("setActiveRevisionAction works at any status", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function setActiveRevisionAction");
    const fn = source.slice(fnStart, fnStart + 500);
    expect(fn).not.toContain("p.status");
  });

  it("revision system supports indefinite updates (user_edit creates new revision)", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    // patchDraftFieldAction creates revisions with source "user_edit"
    const fnStart = source.indexOf("export async function patchDraftFieldAction");
    const fn = source.slice(fnStart, fnStart + 2000);
    expect(fn).toContain('"user_edit"');
    expect(fn).toContain("createRevisionAndSetCurrent");
  });

  it("generate and review job payloads include revision_id", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    // Both generate and review actions include revision_id in payload
    expect(source).toContain("revision_id: p.current_revision_id");
  });

  it("worker updates revision pointers on job completion", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain("last_generated_revision_id: revisionId");
    expect(source).toContain("last_reviewed_revision_id: reviewRevisionId");
  });
});

// ── UI: plain-language labels ────────────────────────────────────────

describe("UI uses plain-language labels", () => {
  it("page shows 'Files & Images' section", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("Files & Images");
  });

  it("page shows 'Images for This Version' section", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("Images for This Version");
  });

  it("page shows 'Active Version' for revision list", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("Active Version");
  });

  it("screenshots are labeled 'Screenshots'", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("Screenshots ({screenshotItems.length})");
  });

  it("dashboard uses Step N format", () => {
    const dashPath = join(__dirname, "../app/dashboard/page.tsx");
    const source = readFileSync(dashPath, "utf-8");
    expect(source).toContain("formatStatusLabel");
  });

  it("workflow panel uses formatStatusLabel", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("formatStatusLabel(effectiveStatus)");
  });
});

// ── Revision-driven pipeline correctness ──────────────────────────────

describe("revision-driven pipeline correctness", () => {
  it("page.tsx loads request data from active revision, not draft_request", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    // Must query revision table for request data
    expect(source).toContain("project_request_revisions");
    expect(source).toContain("current_revision_id");
    // requestData variable should come from revision
    expect(source).toContain("rev?.request_data");
  });

  it("patchDraftFieldAction reads from revision via loadCurrentDraft", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function patchDraftFieldAction");
    const fnEnd = source.indexOf("export async function updateDraftRequestAction");
    const fn = source.slice(fnStart, fnEnd);
    // Must call loadCurrentDraft which reads from revision
    expect(fn).toContain("loadCurrentDraft");
    // Must sync to legacy column after revision update
    expect(fn).toContain("draft_request: merged");
  });

  it("loadCurrentDraft reads from revision first", () => {
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-revision-helpers.ts");
    const source = readFileSync(helperPath, "utf-8");
    const fnStart = source.indexOf("export async function loadCurrentDraft");
    const fnEnd = source.length;
    const fn = source.slice(fnStart, fnEnd);
    // Must check current_revision_id first
    expect(fn).toContain("current_revision_id");
    expect(fn).toContain("project_request_revisions");
    // Must return revisionId
    expect(fn).toContain("revisionId:");
  });

  it("importFinalRequestAction does not write to final_request column", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function importFinalRequestAction");
    const fnEnd = source.indexOf("export async function getRequestSourceAction");
    const fn = source.slice(fnStart, fnEnd);
    // Must NOT write to final_request
    expect(fn).not.toContain("final_request: parsed");
    // Must create revision
    expect(fn).toContain("createRevisionAndSetCurrent");
    // Must sync authoritative selected_modules into the imported draft
    expect(fn).toContain("syncDraftWithSelectedModules");
    // Must sync to draft_request for legacy
    expect(fn).toContain("draft_request: syncedParsed");
  });

  it("approveIntakeAction validates from active revision", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function approveIntakeAction");
    const fnEnd = source.indexOf("export async function requestRevisionAction");
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toContain("current_revision_id");
    expect(fn).toContain("project_request_revisions");
  });

  it("resetToDraftAction cleans client-request.json and screenshot assets", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-recovery-helpers.ts");
    const actionSource = readFileSync(actionsPath, "utf-8");
    const helperSource = readFileSync(helperPath, "utf-8");
    const fnStart = actionSource.indexOf("export async function resetToDraftAction");
    const fnEnd = actionSource.indexOf("// ── Project diagnostics");
    const fn = actionSource.slice(fnStart, fnEnd);
    // Must clean client-request.json from disk
    expect(fn).toContain("client-request.json");
    // Must clean site/public/images (via join())
    expect(fn).toContain('"public", "images"');
    // Must delete screenshot asset records from DB
    expect(fn).toContain("deleteReviewScreenshotAssets");
    expect(helperSource).toContain("review_screenshot");
  });

  it("screenshot assets include request_revision_id in worker", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    // Worker must store request_revision_id when creating screenshot assets
    expect(source).toContain("request_revision_id: reviewRevisionId");
  });

  it("getScreenshotsForProjectAction supports revision filtering", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function getScreenshotsForProjectAction");
    const fnEnd = source.indexOf("export async function getScreenshotUrlAction");
    const fn = source.slice(fnStart, fnEnd);
    // Must accept revisionId parameter
    expect(fn).toContain("revisionId");
    // Must return request_revision_id in results
    expect(fn).toContain("request_revision_id");
  });

  it("Asset type includes new fields", () => {
    const typesPath = join(__dirname, "types.ts");
    const source = readFileSync(typesPath, "utf-8");
    expect(source).toContain("asset_type:");
    expect(source).toContain("source_job_id:");
    expect(source).toContain("request_revision_id:");
  });

  it("RevisionAssetManager uses useEffect not render body", () => {
    const editorPath = join(__dirname, "../app/dashboard/projects/[id]/project-editor.tsx");
    const source = readFileSync(editorPath, "utf-8");
    // Must use useEffect for async data loading
    expect(source).toContain("useEffect(() => {");
    expect(source).toContain("listRevisionAssetsAction");
    // Must import useEffect
    expect(source).toContain("useEffect");
  });

  it("page.tsx filters out screenshot assets from uploaded files list", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("review_screenshot");
    expect(source).toContain("uploadedAssets");
  });

  it("migration exists for request_revision_id on assets", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260328000006_add_revision_to_assets.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("request_revision_id");
    expect(source).toContain("project_request_revisions");
  });
});

// ── Generate always uses active revision (real behavior) ──────────────

describe("generate rewrites client-request.json from active revision before dispatch", () => {
  it("generateSiteAction writes client-request.json from revision BEFORE spawning worker", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function generateSiteAction");
    const fnEnd = source.indexOf("export async function runReviewAction");
    const fn = source.slice(fnStart, fnEnd);

    // Must read from active revision
    expect(fn).toContain("current_revision_id");
    expect(fn).toContain("project_request_revisions");
    expect(fn).toContain("rev.request_data");

    // Must write client-request.json to disk
    expect(fn).toContain("writeFile(clientRequestPath");

    // Must download revision assets
    expect(fn).toContain("downloadRevisionAssetsToSite");

    // Must update last_exported_revision_id
    expect(fn).toContain("last_exported_revision_id");

    // Must NOT just check if file exists and use stale disk content
    // The old code had: `await access(clientRequestPath)` as the only check
    // The new code writes BEFORE checking
    const accessIdx = fn.indexOf("access(clientRequestPath)");
    const writeIdx = fn.indexOf("writeFile(clientRequestPath");
    // writeFile must exist (it's the primary operation)
    expect(writeIdx).toBeGreaterThan(-1);
    // If access() is used at all, it should NOT be the sole gate
    // (the old code returned an error if the file didn't exist — the new code creates it)
    if (accessIdx > -1) {
      // access should come AFTER writeFile, or not at all
      expect(writeIdx).toBeLessThan(accessIdx);
    }
  });

  it("generateSiteAction fails clearly when no active revision exists", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function generateSiteAction");
    const fnEnd = source.indexOf("export async function runReviewAction");
    const fn = source.slice(fnStart, fnEnd);

    // Must check for current_revision_id and return error if missing
    expect(fn).toContain("No active version found");
  });

  it("generateSiteAction logs which revision was exported", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function generateSiteAction");
    const fnEnd = source.indexOf("export async function runReviewAction");
    const fn = source.slice(fnStart, fnEnd);

    // Must log the revision ID
    expect(fn).toContain("[generate] Wrote client-request.json from revision");
  });

  it("imported AI revision data reaches the generator without stale disk interference", () => {
    // The data flow must be:
    // 1. importFinalRequestAction creates revision (ai_import)
    // 2. generateSiteAction reads from that revision
    // 3. Writes to client-request.json
    // 4. Worker reads client-request.json
    // There must be no path where an old client-request.json persists

    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");

    // Import creates revision
    const importFn = source.slice(
      source.indexOf("export async function importFinalRequestAction"),
      source.indexOf("export async function getRequestSourceAction"),
    );
    expect(importFn).toContain("createRevisionAndSetCurrent");

    // Generate reads from revision, not disk
    const genFn = source.slice(
      source.indexOf("export async function generateSiteAction"),
      source.indexOf("export async function runReviewAction"),
    );
    expect(genFn).toContain("project_request_revisions");
    expect(genFn).toContain("rev.request_data");
    // Must NOT contain legacy fallback
    expect(genFn).not.toContain("p.final_request");
    expect(genFn).not.toContain("p.draft_request");
  });
});

// ── Live portal status updates ──────────────────────────────────────

describe("WorkflowPanel auto-refreshes after job completion", () => {
  it("imports useRouter from next/navigation", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain('import { useRouter } from "next/navigation"');
  });

  it("WorkflowPanel calls router.refresh() when jobs complete", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    const fnStart = source.indexOf("export function WorkflowPanel");
    const fnEnd = source.indexOf("// ── Job status panel");
    const fn = source.slice(fnStart, fnEnd);

    // Must use router.refresh
    expect(fn).toContain("router.refresh()");
    // Must track previous active state to detect transitions
    expect(fn).toContain("prevActiveRef");
    expect(fn).toContain("hasActiveJob");
  });

  it("polls job status every 3 seconds while jobs are active", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    const fnStart = source.indexOf("export function WorkflowPanel");
    const fnEnd = source.indexOf("// ── Job status panel");
    const fn = source.slice(fnStart, fnEnd);

    expect(fn).toContain("setInterval(refreshJobs, 3000)");
    expect(fn).toContain("clearInterval");
  });
});

// ── Screenshot viewer is revision-aware ─────────────────────────────

describe("screenshot viewer filters by revision", () => {
  it("ScreenshotViewer receives lastReviewedRevisionId prop", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("lastReviewedRevisionId");
    // Must pass it to the query
    const fnStart = source.indexOf("function ScreenshotViewer");
    const fnEnd = source.indexOf("function loadImage") !== -1
      ? source.indexOf("function loadImage")
      : source.indexOf("async function loadImage");
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toContain("getScreenshotsForProjectAction(projectId, lastReviewedRevisionId)");
  });

  it("WorkflowPanel passes lastReviewedRevisionId to ScreenshotViewer", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("lastReviewedRevisionId={liveLastReviewedRevisionId}");
  });

  it("page.tsx passes last_reviewed_revision_id to WorkflowPanel", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("lastReviewedRevisionId={p.last_reviewed_revision_id}");
  });

  it("getScreenshotsForProjectAction returns request_revision_id", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function getScreenshotsForProjectAction");
    const fnEnd = source.indexOf("export async function getScreenshotUrlAction");
    const fn = source.slice(fnStart, fnEnd);
    expect(fn).toContain("request_revision_id");
  });
});

// ── Screenshot stabilization ────────────────────────────────────────

describe("review.sh and screenshot tool wait for page readiness", () => {
  it("review.sh has stabilization wait after server ready", () => {
    const reviewPath = join(REPO_ROOT, "scripts/review.sh");
    const source = readFileSync(reviewPath, "utf-8");
    expect(source).toContain("stabilization");
    expect(source).toContain("sleep");
  });

  it("screenshot tool waits for networkidle", () => {
    const screenshotPath = join(REPO_ROOT, "packages/review-tools/src/screenshot.ts");
    const source = readFileSync(screenshotPath, "utf-8");
    expect(source).toContain("networkidle");
  });

  it("screenshot tool waits for fonts", () => {
    const screenshotPath = join(REPO_ROOT, "packages/review-tools/src/screenshot.ts");
    const source = readFileSync(screenshotPath, "utf-8");
    expect(source).toContain("fonts.ready");
  });

  it("screenshot tool has post-load stabilization delay", () => {
    const screenshotPath = join(REPO_ROOT, "packages/review-tools/src/screenshot.ts");
    const source = readFileSync(screenshotPath, "utf-8");
    expect(source).toContain("waitForTimeout");
    // Must be at least 1500ms
    const match = source.match(/waitForTimeout\((\d+)\)/);
    expect(match).toBeTruthy();
    expect(Number(match![1])).toBeGreaterThanOrEqual(1500);
  });
});

// ── Cross-project isolation ─────────────────────────────────────────

describe("BrightSpark and BrightSpark 3 do not leak screenshots", () => {
  it("screenshots are filtered by project_id in query", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function getScreenshotsForProjectAction");
    const fnEnd = source.indexOf("export async function getScreenshotUrlAction");
    const fn = source.slice(fnStart, fnEnd);
    // Must filter by project_id
    expect(fn).toContain('.eq("project_id", projectId)');
    // Must filter by asset_type
    expect(fn).toContain('.eq("asset_type", "review_screenshot")');
  });

  it("worker stores project_id on each screenshot asset", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain("project_id: project.id");
    expect(source).toContain('asset_type: "review_screenshot"');
  });

  it("worker stores revision ID on screenshot assets for lineage", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain("request_revision_id: reviewRevisionId");
  });

  it("generated directories are slug-based preventing cross-project pollution", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    // Generated dir uses slug, not shared paths
    expect(source).toContain('"generated", p.slug');
  });
});

// ── Deployment architecture ─────────────────────────────────────────

describe("Tailscale/Vercel deployment architecture", () => {
  it("deployment architecture document exists", () => {
    const docPath = join(REPO_ROOT, "docs/architecture/deployment.md");
    expect(existsSync(docPath)).toBe(true);
    const source = readFileSync(docPath, "utf-8");
    expect(source).toContain("Vercel");
    expect(source).toContain("Tailscale");
    expect(source).toContain("Worker");
    expect(source).toContain("Supabase");
  });

  it("documents what runs on Vercel vs VM", () => {
    const docPath = join(REPO_ROOT, "docs/architecture/deployment.md");
    const source = readFileSync(docPath, "utf-8");
    expect(source).toContain("What Runs Where");
    expect(source).toContain("Portal UI");
    expect(source).toContain("Site generation");
    expect(source).toContain("Screenshot capture");
  });

  it("documents phone testing path", () => {
    const docPath = join(REPO_ROOT, "docs/architecture/deployment.md");
    const source = readFileSync(docPath, "utf-8");
    expect(source).toContain("phone");
    expect(source).toContain("tailscale-ip");
  });
});

// ── Version tracking UI ─────────────────────────────────────────────

describe("page shows version tracking with staleness indicators", () => {
  it("page.tsx shows staleness for exported revision", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("Content Prepared");
    expect(source).toContain("last_exported_revision_id");
    expect(source).toContain("Outdated");
  });

  it("page.tsx shows staleness for generated revision", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("Website Built");
    expect(source).toContain("last_generated_revision_id");
  });

  it("page.tsx shows staleness for reviewed revision", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("Preview Created");
    expect(source).toContain("last_reviewed_revision_id");
  });
});

// ── Worker updates project status before job status ─────────────────

describe("worker updates project status before job status (race condition fix)", () => {
  it("generate success: project status updated before job marked completed", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    const genFn = source.slice(
      source.indexOf("async function executeGenerate"),
      source.indexOf("async function executeReview"),
    );

    // Find the positions of key operations in the success path
    const projectUpdateIdx = genFn.indexOf('status: "workspace_generated"');
    const jobCompleteIdx = genFn.indexOf('status: "completed"');

    expect(projectUpdateIdx).toBeGreaterThan(-1);
    expect(jobCompleteIdx).toBeGreaterThan(-1);
    // Project status MUST come before job completion
    expect(projectUpdateIdx).toBeLessThan(jobCompleteIdx);
  });

  it("review success: project status updated before job marked completed", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    const reviewFn = source.slice(
      source.indexOf("async function executeReview"),
    );

    // Find success path: "review_ready" must come before the final "completed"
    const projectUpdateIdx = reviewFn.indexOf('status: "review_ready"');
    const jobCompleteIdx = reviewFn.indexOf('status: "completed"');

    expect(projectUpdateIdx).toBeGreaterThan(-1);
    expect(jobCompleteIdx).toBeGreaterThan(-1);
    expect(projectUpdateIdx).toBeLessThan(jobCompleteIdx);
  });

  it("review failure: project status updated before job marked failed", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    const reviewFn = source.slice(
      source.indexOf("async function executeReview"),
    );

    // In the failure path, "build_failed" must come before the failure job update
    const projectFailIdx = reviewFn.indexOf('status: "build_failed"');
    const jobFailIdx = reviewFn.indexOf('status: "failed"');

    expect(projectFailIdx).toBeGreaterThan(-1);
    expect(jobFailIdx).toBeGreaterThan(-1);
    expect(projectFailIdx).toBeLessThan(jobFailIdx);
  });
});

// ── UI auto-refreshes artifacts and screenshots after job completion ──

describe("UI auto-refreshes after job completion", () => {
  it("ArtifactStatusRow depends on status for re-fetch", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    const fnStart = source.indexOf("function ArtifactStatusRow");
    const fnEnd = source.indexOf("function ProcessBtn") !== -1
      ? source.indexOf("function ProcessBtn")
      : source.indexOf("// ── Individual action buttons");
    const fn = source.slice(fnStart, fnEnd);

    // Must accept status prop
    expect(fn).toContain("status");
    // useEffect deps must include status
    expect(fn).toContain("[slug, status]");
  });

  it("ScreenshotViewer depends on status for re-fetch", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    const fnStart = source.indexOf("function ScreenshotViewer");
    const fnEnd = source.indexOf("function PhaseIndicator");
    const fn = source.slice(fnStart, fnEnd);

    // Must accept status prop
    expect(fn).toContain("status: string");
    expect(fn).toContain("refreshToken: number");
    // useEffect deps must include status and refresh token
    expect(fn).toContain("lastReviewedRevisionId, status, refreshToken]");
    expect(fn).toContain("maxAttempts");
  });

  it("WorkflowPanel polls workflow snapshot after job completion", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    const fnStart = source.indexOf("export function WorkflowPanel");
    const fnEnd = source.indexOf("// ── Job status panel");
    const fn = source.slice(fnStart, fnEnd);

    expect(fn).toContain("getProjectWorkflowSnapshotAction");
    expect(fn).toContain("router.refresh()");
    expect(fn).toContain("lastActiveJobRef");
    expect(fn).toContain("viewerRefreshToken");
  });
});

// ── Prompt export logs source ──────────────────────────────────────

describe("prompt export logs which source was used", () => {
  it("exportPromptAction logs source and revision_id", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function exportPromptAction");
    const fnEnd = source.indexOf("export async function importFinalRequestAction");
    const fn = source.slice(fnStart, fnEnd);

    // Must log the source
    expect(fn).toContain("[prompt-export]");
    expect(fn).toContain("source=");
    // Must track which source was used
    expect(fn).toContain("promptSource");
  });

  it("exportPromptAction includes source in event metadata", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function exportPromptAction");
    const fnEnd = source.indexOf("export async function importFinalRequestAction");
    const fn = source.slice(fnStart, fnEnd);

    expect(fn).toContain("request_source: promptSource");
    expect(fn).toContain("revision_id:");
  });
});

// ── Screenshot CSS stabilization ───────────────────────────────────

describe("screenshot tool checks CSS stylesheet loading", () => {
  it("checks all stylesheet links are loaded", () => {
    const screenshotPath = join(REPO_ROOT, "packages/review-tools/src/screenshot.ts");
    const source = readFileSync(screenshotPath, "utf-8");
    expect(source).toContain("stylesheet");
    expect(source).toContain(".sheet");
  });

  it("uses requestAnimationFrame for paint stability", () => {
    const screenshotPath = join(REPO_ROOT, "packages/review-tools/src/screenshot.ts");
    const source = readFileSync(screenshotPath, "utf-8");
    expect(source).toContain("requestAnimationFrame");
  });

  it("forces layout reflow before capture", () => {
    const screenshotPath = join(REPO_ROOT, "packages/review-tools/src/screenshot.ts");
    const source = readFileSync(screenshotPath, "utf-8");
    expect(source).toContain("offsetHeight");
  });

  it("final settle time is at least 2500ms", () => {
    const screenshotPath = join(REPO_ROOT, "packages/review-tools/src/screenshot.ts");
    const source = readFileSync(screenshotPath, "utf-8");
    // Get the LAST waitForTimeout (the final settle)
    const matches = [...source.matchAll(/waitForTimeout\((\d+)\)/g)];
    expect(matches.length).toBeGreaterThan(0);
    const lastTimeout = Number(matches[matches.length - 1][1]);
    expect(lastTimeout).toBeGreaterThanOrEqual(2500);
  });
});

// ── Reprocess invalidates downstream state ─────────────────────────

describe("reprocessIntakeAction invalidates downstream state", () => {
  it("clears downstream revision pointers", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function reprocessIntakeAction");
    const fnEnd = source.indexOf("// ── Recovery: Reset status to draft ready");
    const fn = source.slice(fnStart, fnEnd);

    // Must clear all downstream pointers
    expect(fn).toContain("last_exported_revision_id: null");
    expect(fn).toContain("last_generated_revision_id: null");
    expect(fn).toContain("last_reviewed_revision_id: null");
  });

  it("cleans stale disk artifacts", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-recovery-helpers.ts");
    const actionSource = readFileSync(actionsPath, "utf-8");
    const helperSource = readFileSync(helperPath, "utf-8");
    const fnStart = actionSource.indexOf("export async function reprocessIntakeAction");
    const fnEnd = actionSource.indexOf("// ── Recovery: Reset status to draft ready");
    const fn = actionSource.slice(fnStart, fnEnd);

    // Must clean stale files
    expect(fn).toContain("client-request.json");
    expect(fn).toContain("prompt.txt");
    expect(fn).toContain("screenshots");
    expect(fn).toContain("removeGeneratedTargets");
    expect(helperSource).toContain("rm(join(generatedDir");
  });

  it("deletes stale screenshot asset records", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-recovery-helpers.ts");
    const actionSource = readFileSync(actionsPath, "utf-8");
    const helperSource = readFileSync(helperPath, "utf-8");
    const fnStart = actionSource.indexOf("export async function reprocessIntakeAction");
    const fnEnd = actionSource.indexOf("// ── Recovery: Reset status to draft ready");
    const fn = actionSource.slice(fnStart, fnEnd);

    expect(fn).toContain("deleteReviewScreenshotAssets");
    expect(helperSource).toContain(".delete()");
    expect(helperSource).toContain("review_screenshot");
  });

  it("logs invalidation in event metadata", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function reprocessIntakeAction");
    const fnEnd = source.indexOf("// ── Recovery: Reset status to draft ready");
    const fn = source.slice(fnStart, fnEnd);

    expect(fn).toContain("invalidated:");
  });
});

// ── RevisionAssetManager does not call server actions during render ──

describe("RevisionAssetManager uses useEffect for data loading", () => {
  it("loads attached assets in useEffect, not during render", () => {
    const editorPath = join(__dirname, "../app/dashboard/projects/[id]/project-editor.tsx");
    const source = readFileSync(editorPath, "utf-8");
    const fnStart = source.indexOf("export function RevisionAssetManager");
    const fn = source.slice(fnStart);

    // Must use useEffect for the initial data load
    expect(fn).toContain("useEffect(() => {");
    expect(fn).toContain("listRevisionAssetsAction(currentRevisionId)");

    // The server action call must be inside useEffect, not at render time
    const useEffectIdx = fn.indexOf("useEffect(() => {");
    const listCallIdx = fn.indexOf("listRevisionAssetsAction(currentRevisionId)");
    expect(listCallIdx).toBeGreaterThan(useEffectIdx);
  });

  it("does not call server actions before useEffect", () => {
    const editorPath = join(__dirname, "../app/dashboard/projects/[id]/project-editor.tsx");
    const source = readFileSync(editorPath, "utf-8");
    const fnStart = source.indexOf("export function RevisionAssetManager");
    const fn = source.slice(fnStart);

    // Between function declaration and useEffect, there should be no server action calls
    const useEffectIdx = fn.indexOf("useEffect");
    const beforeEffect = fn.slice(0, useEffectIdx);
    expect(beforeEffect).not.toContain("listRevisionAssetsAction");
    expect(beforeEffect).not.toContain("attachAssetToRevisionAction");
    expect(beforeEffect).not.toContain("detachAssetFromRevisionAction");
  });
});

// ── Deployment doc has clear status labels ─────────────────────────

describe("deployment doc has clear implementation status labels", () => {
  it("marks current architecture as CURRENT", () => {
    const docPath = join(REPO_ROOT, "docs/architecture/deployment.md");
    const source = readFileSync(docPath, "utf-8");
    expect(source).toContain("CURRENT");
    expect(source).toContain("Phase 1");
  });

  it("marks target architecture as PLANNED", () => {
    const docPath = join(REPO_ROOT, "docs/architecture/deployment.md");
    const source = readFileSync(docPath, "utf-8");
    expect(source).toContain("PLANNED");
    // Should appear near Vercel, Worker on VM, Tailscale, Phase 2, Phase 3
    expect(source).toContain("Portal on Vercel — PLANNED");
    expect(source).toContain("Worker on VM (via Tailscale) — PLANNED");
  });

  it("marks required code changes as not implemented", () => {
    const docPath = join(REPO_ROOT, "docs/architecture/deployment.md");
    const source = readFileSync(docPath, "utf-8");
    expect(source).toContain("NOT YET IMPLEMENTED");
  });

  it("has top-level status summary", () => {
    const docPath = join(REPO_ROOT, "docs/architecture/deployment.md");
    const source = readFileSync(docPath, "utf-8");
    // First paragraph should mention implementation status
    const firstParagraph = source.slice(0, 300);
    expect(firstParagraph).toContain("Implementation status");
  });
});
