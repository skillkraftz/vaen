import { test as base, expect, BrowserContext, Page } from "@playwright/test";
import {
  createOutputDir,
  resetStepIndex,
  snap,
  snapLocator,
  getStatusText,
  waitForRevisionsLoaded,
  waitForJobCompletion,
  addBlocker,
  addFailure,
  addObservation,
  writeAuditNotes,
} from "./helpers";

/**
 * Portal UX Audit Flow — Full Workflow
 *
 * Captures every major workflow milestone from login through
 * post-review screenshot inspection. Used as the basis for
 * portal UX redesign.
 *
 * Run with:  pnpm portal:audit
 *
 * Prerequisites:
 *   - Portal running at PORTAL_URL (default http://localhost:3100)
 *   - PORTAL_EMAIL and PORTAL_PASSWORD env vars set
 *   - Worker packages built (pnpm build)
 */

const EMAIL = process.env.PORTAL_EMAIL ?? "";
const PASSWORD = process.env.PORTAL_PASSWORD ?? "";
const PORTAL_URL = process.env.PORTAL_URL ?? "http://localhost:3100";

const SLUG = `audit-${Date.now().toString(36)}`;
const PROJECT_NAME = `Audit Run ${SLUG}`;

// Track workflow progress for notes artifact
let reachedGenerate = false;
let reachedReview = false;
let reachedScreenshots = false;

// Shared browser context so auth persists
let ctx: BrowserContext;
let pg: Page;
let outputDir: string;
const startTime = new Date();

const test = base.extend<{ shared: Page }>({
  shared: async ({ browser }, use) => {
    if (!ctx) {
      ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      pg = await ctx.newPage();
    }
    await use(pg);
  },
});

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Set PORTAL_EMAIL and PORTAL_PASSWORD env vars before running the audit.",
    );
  }
  outputDir = createOutputDir();
  resetStepIndex();
  console.log(`\n  Audit output → ${outputDir}\n`);
});

test.afterAll(async () => {
  writeAuditNotes(outputDir, {
    portalUrl: PORTAL_URL,
    projectName: PROJECT_NAME,
    slug: SLUG,
    startTime,
    reachedGenerate,
    reachedReview,
    reachedScreenshots,
  });
  console.log(`\n  Audit complete → ${outputDir}\n`);
  await ctx?.close();
});

// ── 1. Login ──────────────────────────────────────────────────────────

test("01 — login", async ({ shared: page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-page")).toBeVisible();
  await snap(page, outputDir, "login-form", { note: "Clean login page" });

  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByTestId("login-submit").click();

  try {
    await Promise.race([
      page.waitForURL("**/dashboard**", { timeout: 20_000 }),
      page.locator(".alert-error").waitFor({ timeout: 20_000 }).then(async () => {
        const msg = await page.locator(".alert-error").textContent();
        throw new Error(`Login failed: ${msg} — check PORTAL_EMAIL and PORTAL_PASSWORD`);
      }),
    ]);
  } catch (err) {
    await snap(page, outputDir, "login-FAILED", { note: "Auth failure" });
    throw err;
  }

  await expect(page.getByTestId("dashboard-header")).toBeVisible();
  await snap(page, outputDir, "dashboard-after-login", {
    note: "Dashboard with project list",
    cta: "+ New Intake",
  });
});

// ── 2. Dashboard ──────────────────────────────────────────────────────

test("02 — dashboard", async ({ shared: page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-header")).toBeVisible();
  await snap(page, outputDir, "dashboard-project-list", {
    cta: "+ New Intake",
    note: "Full project list view",
  });
});

// ── 3. Create project ─────────────────────────────────────────────────

test("03 — create project", async ({ shared: page }) => {
  await page.goto("/dashboard/new");
  await expect(page.getByTestId("new-intake-form")).toBeVisible();
  await snap(page, outputDir, "new-intake-empty", { cta: "Create Intake" });

  await page.fill("#name", PROJECT_NAME);
  await page.fill("#slug", SLUG);
  await page.fill("#businessType", "Painting contractor");
  await page.fill("#contactName", "Audit Runner");
  await page.fill("#contactEmail", "audit@example.com");
  await page.fill("#contactPhone", "(555) 000-0000");
  await page.fill(
    "#notes",
    "Automated UX audit run. Full-service interior and exterior painting for residential and commercial properties. We specialize in cabinet refinishing, deck staining, and color consultations.",
  );

  await snap(page, outputDir, "new-intake-filled", { cta: "Create Intake" });
  await page.getByTestId("create-intake-submit").click();

  await page.waitForURL("**/dashboard/projects/**", { timeout: 15_000 });
  await expect(page.getByTestId("project-header")).toBeVisible();

  const status = await getStatusText(page);
  await snap(page, outputDir, "project-created", {
    status,
    note: "Redirected to project detail after creation",
  });
});

// ── 4. Initial project state ──────────────────────────────────────────

test("04 — initial project state", async ({ shared: page }) => {
  await goToProject(page);

  const status = await getStatusText(page);
  await snap(page, outputDir, "project-initial-full", {
    status,
    cta: "Create Website Plan",
    note: "Full page at intake_received",
  });

  // Wait for revisions to load before capturing version tracking
  await waitForRevisionsLoaded(page);
  await page.getByTestId("version-tracking").scrollIntoViewIfNeeded();
  await snap(page, outputDir, "version-tracking-initial", {
    status,
    note: "Version tracking with revisions loaded",
  });
});

// ── 5. Process intake ─────────────────────────────────────────────────

test("05 — process intake", async ({ shared: page }) => {
  await goToProject(page);

  const processBtn = page.getByTestId("btn-create-website-plan");
  await expect(processBtn).toBeVisible();
  await snap(page, outputDir, "before-process", {
    status: await getStatusText(page),
    cta: "Create Website Plan",
  });

  await processBtn.click();

  // intake_draft_ready → "Step 3: Review Plan"
  await expect(page.getByTestId("workflow-status-label")).toContainText(
    "Review Plan",
    { timeout: 30_000 },
  );

  const status = await getStatusText(page);
  await snap(page, outputDir, "after-process", {
    status,
    cta: "Approve Plan",
    note: "Plan generated, recommendations visible",
  });
});

// ── 6. Approve ────────────────────────────────────────────────────────

test("06 — approve", async ({ shared: page }) => {
  await goToProject(page);

  const approveBtn = page.getByTestId("btn-approve-plan");
  await expect(approveBtn).toBeVisible({ timeout: 10_000 });
  await approveBtn.click();

  // intake_approved → "Step 4: Approve Plan"
  await expect(page.getByTestId("workflow-status-label")).toContainText(
    "Approve Plan",
    { timeout: 15_000 },
  );

  const status = await getStatusText(page);
  await snap(page, outputDir, "after-approve", {
    status,
    cta: "Prepare Content",
  });
});

// ── 7. Export ─────────────────────────────────────────────────────────

test("07 — export", async ({ shared: page }) => {
  await goToProject(page);

  const exportBtn = page.getByTestId("btn-prepare-content");
  await expect(exportBtn).toBeVisible({ timeout: 10_000 });
  await exportBtn.click();

  // intake_parsed → "Step 5: Prepare Content"
  await expect(page.getByTestId("workflow-status-label")).toContainText(
    "Prepare Content",
    { timeout: 15_000 },
  );

  const status = await getStatusText(page);
  await snap(page, outputDir, "after-export", {
    status,
    cta: "Build Website",
    note: "Build section now visible",
  });
});

// ── 8. AI handoff ─────────────────────────────────────────────────────

test("08 — AI handoff", async ({ shared: page }) => {
  await goToProject(page);

  // AI Handoff is inside collapsible Advanced Tools
  const advToggle = page.getByTestId("advanced-toggle");
  await advToggle.scrollIntoViewIfNeeded();
  await advToggle.click();

  const section = page.getByTestId("section-handoff");
  await expect(section).toBeVisible({ timeout: 10_000 });
  await section.scrollIntoViewIfNeeded();

  const status = await getStatusText(page);
  await snap(page, outputDir, "handoff-section", {
    status,
    cta: "Export prompt.txt / Import Final Request",
    note: "AI handoff section with export + import options",
  });

  // Export the prompt
  await page.getByTestId("btn-export-prompt").click();
  await expect(section.locator("pre")).toBeVisible({ timeout: 15_000 });
  await snap(page, outputDir, "handoff-prompt-expanded", {
    status,
    note: "Prompt content visible — long scrollable pre block",
  });
});

// ── 9. Generate site ──────────────────────────────────────────────────

test("09 — generate site", async ({ shared: page }) => {
  await goToProject(page);

  // Generate button is in the NextStep banner (not section-build) when nextStep is active
  const generateBtn = page.getByTestId("build-generate-site");

  if (!(await generateBtn.isVisible({ timeout: 10_000 }).catch(() => false))) {
    const detail = "Generate Site button (build-generate-site) not visible — may be in wrong status";
    addFailure("Generate Site", "button_not_present", detail);
    addBlocker(detail);
    await snap(page, outputDir, "generate-BLOCKED", {
      status: await getStatusText(page),
      note: detail,
    });
    return;
  }

  await snap(page, outputDir, "before-generate", {
    status: await getStatusText(page),
    cta: "Build Website",
    note: "Clicking generate button from NextStep banner",
  });

  await generateBtn.click();

  // Wait for job to be dispatched — running indicator or job panel appears
  await page.waitForTimeout(2000);
  const status1 = await getStatusText(page);
  await snap(page, outputDir, "generate-dispatched", {
    status: status1,
    note: "Job dispatched to worker — polling active",
  });

  reachedGenerate = true;

  // Wait for generate job to complete (timeout: 120s)
  try {
    const finalStatus = await waitForJobCompletion(page, 120_000);

    // Reload to ensure fresh server-rendered state
    await goToProject(page);
    const status2 = await getStatusText(page);
    await snap(page, outputDir, "generate-complete", {
      status: status2,
      cta: "Build & Review",
      note: `Generate finished. Status: ${status2}`,
    });

    // Check if it actually succeeded
    if (status2.includes("Generate") || status2.includes("Step 7")) {
      addObservation("Generate completed successfully — workspace_generated");
    } else {
      addObservation(`Generate ended with status: ${status2}`);
      if (finalStatus.toLowerCase().includes("failed") || status2.toLowerCase().includes("failed")) {
        addFailure("Generate Site", "job_failed", `Generate completed with status "${status2}"`);
        addBlocker(`Generate failed after dispatch — final status: ${status2}`);
      }
    }
  } catch (err) {
    await snap(page, outputDir, "generate-TIMEOUT", {
      status: await getStatusText(page),
      note: "Generate job timed out",
    });
    addFailure("Generate Site", "job_timed_out", String(err));
    addBlocker(`Generate timed out: ${err}`);
  }
});

// ── 10. Build & Review ────────────────────────────────────────────────

test("10 — build and review", async ({ shared: page }) => {
  await goToProject(page);

  // Review button is in the NextStep banner when nextStep is active
  const reviewBtn = page.getByTestId("build-review");

  if (!(await reviewBtn.isVisible({ timeout: 10_000 }).catch(() => false))) {
    const detail = "Build & Review button (build-review) not visible — may be in wrong status";
    addFailure("Build & Review", "button_not_present", detail);
    addBlocker(detail);
    await snap(page, outputDir, "review-BLOCKED", {
      status: await getStatusText(page),
      note: detail,
    });
    return;
  }

  await snap(page, outputDir, "before-review", {
    status: await getStatusText(page),
    cta: "Create Preview",
    note: "Clicking review button from NextStep banner",
  });

  await reviewBtn.click();
  await page.waitForTimeout(2000);
  await snap(page, outputDir, "review-dispatched", {
    status: await getStatusText(page),
    note: "Review job dispatched — build + screenshot capture running",
  });

  reachedReview = true;

  // Wait for review to complete (timeout: 180s — build + screenshots)
  try {
    await waitForJobCompletion(page, 180_000);

    // Reload to get fresh state
    await goToProject(page);
    const status = await getStatusText(page);
    await snap(page, outputDir, "review-complete", {
      status,
      note: `Review finished. Status: ${status}`,
    });

    if (status.includes("Review") || status.includes("Step 9")) {
      addObservation("Review completed successfully — review_ready");
    } else if (status.includes("failed") || status.includes("Failed")) {
      addObservation(`Review ended with failure: ${status}`);
      addFailure("Build & Review", "job_failed", `Review completed with status "${status}"`);
      addBlocker("Build & Review failed — screenshots may not be available");
    }
  } catch (err) {
    await snap(page, outputDir, "review-TIMEOUT", {
      status: await getStatusText(page),
      note: "Review job timed out",
    });
    addFailure("Build & Review", "job_timed_out", String(err));
    addBlocker(`Review timed out: ${err}`);
  }
});

// ── 11. Screenshot viewer ─────────────────────────────────────────────

test("11 — screenshot viewer", async ({ shared: page }) => {
  await goToProject(page);

  const viewer = page.getByTestId("screenshot-viewer");
  await expect(viewer).toBeVisible({ timeout: 10_000 });

  // Wait for viewer to finish loading (transitions from loading → loaded/empty).
  // The viewer now always renders with data-viewer-state to distinguish states.
  await expect(viewer).not.toHaveAttribute("data-viewer-state", "loading", {
    timeout: 15_000,
  });

  const viewerState = await viewer.getAttribute("data-viewer-state");

  if (viewerState === "empty") {
    addBlocker("Screenshot viewer loaded but found no screenshots");
    await snap(page, outputDir, "screenshots-EMPTY", {
      status: await getStatusText(page),
      note: "Viewer fetched but no screenshots found for this project/revision",
    });
    return;
  }

  reachedScreenshots = true;
  await viewer.scrollIntoViewIfNeeded();

  const screenshotCount = await viewer.getAttribute("data-screenshot-count");
  const status = await getStatusText(page);

  // Read provenance metadata if present
  const provenance = page.getByTestId("screenshot-provenance");
  const provenanceText = await provenance.isVisible().catch(() => false)
    ? await provenance.textContent()
    : null;
  const manifestPath = await viewer.getAttribute("data-manifest-path");
  const verification = page.getByTestId("screenshot-verification");
  const verificationText = await verification.textContent();
  const verificationState = await verification.getAttribute("data-verification-state");
  const contentVerification = page.getByTestId("screenshot-content-verification");
  const contentVerificationText = await contentVerification.isVisible().catch(() => false)
    ? await contentVerification.textContent()
    : null;
  const runtimeConfig = page.getByTestId("screenshot-runtime-config");
  const runtimeConfigText = await runtimeConfig.isVisible().catch(() => false)
    ? await runtimeConfig.textContent()
    : null;

  await snap(page, outputDir, "screenshot-viewer-thumbnails", {
    status,
    note:
      `${screenshotCount} screenshots loaded` +
      `${provenanceText ? ` (${provenanceText})` : ""}` +
      `${manifestPath ? ` · manifest ${manifestPath}` : ""}` +
      `${verificationText ? ` · ${verificationText}` : ""}` +
      `${contentVerificationText ? ` · ${contentVerificationText}` : ""}` +
      `${runtimeConfigText ? ` · ${runtimeConfigText}` : ""}`,
  });

  if (provenanceText) {
    addObservation(`Screenshot provenance: ${provenanceText}`);
  }
  if (manifestPath) {
    addObservation(`Screenshot manifest: ${manifestPath}`);
  }
  if (verificationText) {
    addObservation(`Screenshot verification (${verificationState}): ${verificationText}`);
    if (verificationState === "mismatch") {
      addFailure("Screenshot Viewer", "upload_mismatch", verificationText);
      addBlocker(`Screenshot manifest/upload mismatch: ${verificationText}`);
    }
  }
  if (contentVerificationText) {
    addObservation(`Screenshot content verification: ${contentVerificationText}`);
  }
  if (runtimeConfigText) {
    addObservation(`Screenshot runtime config: ${runtimeConfigText}`);
  }

  // Click the first thumbnail to open a preview
  const firstThumb = viewer.getByTestId("screenshot-thumbnails").locator("button").first();
  if (await firstThumb.isVisible().catch(() => false)) {
    const clickedLabel = (await firstThumb.textContent())?.trim() ?? "unknown";
    await firstThumb.click();

    const preview = page.getByTestId("screenshot-preview");
    await expect(preview).toBeVisible({ timeout: 15_000 });

    const previewImage = page.getByTestId("screenshot-preview-image");
    await expect(previewImage).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => {
        const src = await previewImage.getAttribute("src");
        return src && src.length > 0 ? "set" : "empty";
      }, { timeout: 15_000 })
      .toBe("set");
    await expect
      .poll(
        async () =>
          previewImage.evaluate((img) => {
            const node = img as HTMLImageElement;
            return node.complete && node.naturalWidth > 0 && node.naturalHeight > 0;
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    await previewImage.evaluate(async (img) => {
      const node = img as HTMLImageElement;
      if ("decode" in node) {
        await node.decode().catch(() => undefined);
      }
    });
    await previewImage.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await page.waitForTimeout(500);

    const previewMeta = page.getByTestId("screenshot-preview-meta");
    const previewMetaText = await previewMeta.textContent();
    const previewSrc = await previewImage.getAttribute("src");

    await snap(page, outputDir, "screenshot-viewer-preview", {
      status,
      note:
        `Preview loaded for ${clickedLabel}` +
        `${previewMetaText ? ` · ${previewMetaText}` : ""}` +
        `${previewSrc ? ` · src ${previewSrc.slice(0, 120)}` : ""}`,
    });
    await snapLocator(preview, outputDir, "screenshot-preview-focused", {
      status,
      note: `Focused preview capture for ${clickedLabel}`,
    });
  }
});

// ── 12. Post-review version tracking ──────────────────────────────────

test("12 — post-review version tracking", async ({ shared: page }) => {
  await goToProject(page);
  await waitForRevisionsLoaded(page);

  const vt = page.getByTestId("version-tracking");
  await vt.scrollIntoViewIfNeeded();

  const status = await getStatusText(page);
  await snap(page, outputDir, "version-tracking-final", {
    status,
    note: "Version tracking after full workflow",
  });
});

// ── 13. Diagnostics ───────────────────────────────────────────────────

test("13 — diagnostics", async ({ shared: page }) => {
  await goToProject(page);

  // Diagnostics is inside collapsible Advanced Tools
  const advToggle = page.getByTestId("advanced-toggle");
  await advToggle.scrollIntoViewIfNeeded();
  await advToggle.click();

  const toggle = page.getByTestId("diagnostics-toggle");
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();

  const panel = page.getByTestId("diagnostics-panel");
  await expect(panel.locator("text=Request Source")).toBeVisible({
    timeout: 10_000,
  });

  const status = await getStatusText(page);
  await snap(page, outputDir, "diagnostics-open", {
    status,
    note: "Full diagnostics panel expanded",
  });
});

// ── 14. Recovery section ──────────────────────────────────────────────

test("14 — recovery", async ({ shared: page }) => {
  await goToProject(page);

  // Recovery is inside collapsible Advanced Tools
  const advToggle = page.getByTestId("advanced-toggle");
  await advToggle.scrollIntoViewIfNeeded();
  await advToggle.click();

  const section = page.getByTestId("section-recovery");
  await section.scrollIntoViewIfNeeded();

  const status = await getStatusText(page);
  await snap(page, outputDir, "recovery-section", {
    status,
    note: "Recovery actions: Re-process, Re-export, Reset to Draft",
  });

  // Check for duplicate action buttons
  const buildSection = page.getByTestId("section-build");
  if (await buildSection.isVisible().catch(() => false)) {
    const buildBtns = await buildSection.locator("button").allTextContents();
    const recoveryBtns = await section.locator("button").allTextContents();
    const duplicates = buildBtns.filter((b) => recoveryBtns.includes(b));
    if (duplicates.length > 0) {
      addObservation(
        `Duplicate action buttons in Build and Recovery sections: ${duplicates.join(", ")}`,
      );
    }
  }
});

// ── 15. Activity log ──────────────────────────────────────────────────

test("15 — activity log", async ({ shared: page }) => {
  await goToProject(page);

  const log = page.getByTestId("activity-log");
  await log.scrollIntoViewIfNeeded();

  const status = await getStatusText(page);
  await snap(page, outputDir, "activity-log", {
    status,
    note: "Full activity history",
  });
});

// ── 16. Final full-page state ─────────────────────────────────────────

test("16 — final state", async ({ shared: page }) => {
  await goToProject(page);
  await waitForRevisionsLoaded(page);

  // Small settle for all async sections
  await page.waitForTimeout(1500);

  const status = await getStatusText(page);
  await snap(page, outputDir, "final-full-page", {
    status,
    note: "Complete project page at final workflow state",
  });

  // Observe page structure
  const sections = [
    { id: "workflow-panel", name: "Workflow Panel" },
    { id: "version-tracking", name: "Version Tracking" },
    { id: "activity-log", name: "Activity Log" },
    { id: "section-recovery", name: "Recovery" },
    { id: "diagnostics-panel", name: "Diagnostics" },
    { id: "screenshot-viewer", name: "Screenshot Viewer" },
    { id: "artifact-status", name: "Artifact Status" },
  ];

  const visible: string[] = [];
  for (const s of sections) {
    if (await page.getByTestId(s.id).isVisible().catch(() => false)) {
      visible.push(s.name);
    }
  }
  addObservation(`Sections visible on final page: ${visible.join(", ")}`);
});

// ── Helpers ───────────────────────────────────────────────────────────

async function goToProject(page: Page) {
  await page.goto("/dashboard");
  const card = page.getByTestId(`project-card-${SLUG}`);
  if (!(await card.isVisible({ timeout: 10_000 }).catch(() => false))) {
    await snap(page, outputDir, "DEBUG-no-card");
    throw new Error(`Project card project-card-${SLUG} not found`);
  }
  await card.click();
  await expect(page.getByTestId("project-header")).toBeVisible({
    timeout: 10_000,
  });
}
