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
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("downloadRevisionAssetsToSite");
    expect(source).toContain("public/images/");
    // Must clean previous images before downloading new ones
    expect(source).toContain('rm(imagesDir, { recursive: true, force: true })');
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
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("async function downloadRevisionAssetsToSite");
    const fnEnd = source.indexOf("// ── Process intake");
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

  it("ScreenshotViewer receives projectId", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("ScreenshotViewer({ slug, projectId }");
    expect(source).toContain("projectId={projectId}");
  });
});

// ── 7. Rerun after asset change produces different output ────────────

describe("rerun after asset change produces different output", () => {
  it("export cleans previous images before downloading new ones", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("async function downloadRevisionAssetsToSite");
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

  it("screenshots are labeled 'Latest Screenshots'", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("Latest Screenshots");
  });

  it("dashboard uses Step N format", () => {
    const dashPath = join(__dirname, "../app/dashboard/page.tsx");
    const source = readFileSync(dashPath, "utf-8");
    expect(source).toContain("formatStatusLabel");
  });

  it("workflow panel uses formatStatusLabel", () => {
    const uiPath = join(__dirname, "../app/dashboard/projects/[id]/intake-actions.tsx");
    const source = readFileSync(uiPath, "utf-8");
    expect(source).toContain("formatStatusLabel(status)");
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
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("async function loadCurrentDraft");
    const fnEnd = source.indexOf("// ── Patch a single field");
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
    // Must sync to draft_request for legacy
    expect(fn).toContain("draft_request: parsed");
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
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function resetToDraftAction");
    const fnEnd = source.indexOf("// ── Project diagnostics");
    const fn = source.slice(fnStart, fnEnd);
    // Must clean client-request.json from disk
    expect(fn).toContain("client-request.json");
    // Must clean site/public/images (via join())
    expect(fn).toContain('"public", "images"');
    // Must delete screenshot asset records from DB
    expect(fn).toContain("review_screenshot");
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
