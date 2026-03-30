import { test as base, expect, BrowserContext, Page } from "@playwright/test";
import {
  addObservation,
  createOutputDir,
  resetAuditSession,
  snap,
  writeBusinessAuditNotes,
} from "./helpers";

const EMAIL = process.env.PORTAL_EMAIL ?? "";
const PASSWORD = process.env.PORTAL_PASSWORD ?? "";
const PORTAL_URL = process.env.PORTAL_URL ?? "http://localhost:3100";

const RUN_ID = Date.now().toString(36);
const PROSPECT_NAME = `Audit Prospect ${RUN_ID}`;
const PROSPECT_WEBSITE = `https://example.com/${RUN_ID}`;
const CAMPAIGN_NAME = `Audit Campaign ${RUN_ID}`;

let ctx: BrowserContext;
let pg: Page;
let outputDir: string;
const startTime = new Date();
const covered: string[] = [];
const skipped: string[] = [];
let prospectId: string | null = null;
let campaignId: string | null = null;
let projectId: string | null = null;

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

test.beforeAll(async ({ browser }) => {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Set PORTAL_EMAIL and PORTAL_PASSWORD before running portal:audit.");
  }
  outputDir = createOutputDir();
  resetAuditSession();
  console.log(`\n  Business audit output → ${outputDir}\n`);

  if (!ctx) {
    ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    pg = await ctx.newPage();
  }

  await login(pg);
});

test.afterAll(async () => {
  if (outputDir) {
    writeBusinessAuditNotes(outputDir, {
      portalUrl: PORTAL_URL,
      startTime,
      title: "Portal Business Surfaces Audit",
      covered,
      skipped,
    });
  }
  await ctx?.close();
});

async function login(page: Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  if (await page.getByTestId("dashboard-header").isVisible().catch(() => false)) {
    return;
  }

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  if (await page.getByTestId("dashboard-header").isVisible().catch(() => false)) {
    return;
  }

  await expect(page.getByTestId("login-page")).toBeVisible();
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByTestId("login-submit").click();

  try {
    await Promise.race([
      page.waitForURL("**/dashboard**", {
        timeout: 20_000,
        waitUntil: "domcontentloaded",
      }),
      page.getByTestId("dashboard-header").waitFor({ timeout: 20_000 }),
      page.locator(".alert-error").waitFor({ timeout: 20_000 }).then(async () => {
        const msg = await page.locator(".alert-error").textContent();
        throw new Error(`Login failed: ${msg} — check PORTAL_EMAIL and PORTAL_PASSWORD`);
      }),
    ]);
  } catch (err) {
    throw err;
  }

  await expect(page.getByTestId("dashboard-header")).toBeVisible();
}

async function navigate(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

async function readCurrentRole(page: Page) {
  return ((await page.getByTestId("current-user-role").textContent()) ?? "").trim();
}

test("01 — core portal surfaces", async ({ shared: page }) => {
  console.log("  [audit] core portal surfaces");

  await navigate(page, "/dashboard");
  await expect(page.getByTestId("dashboard-header")).toBeVisible();
  await expect(page.getByTestId("dashboard-prospect-section")).toBeVisible();
  await snap(page, outputDir, "core-dashboard", {
    note: "Dashboard with project list and prospect section",
  });

  await navigate(page, "/dashboard/settings/deployment");
  await expect(page.getByTestId("deployment-settings-page")).toBeVisible();
  await expect(page.getByTestId("deployment-worker-health")).toBeVisible();
  await expect(page.getByTestId("deployment-hosted-testing-checklist")).toBeVisible();
  await snap(page, outputDir, "core-deployment-settings", {
    note: "Portal hosting readiness and worker heartbeat",
  });

  await navigate(page, "/dashboard/settings/outreach");
  await expect(page.getByTestId("outreach-settings-page")).toBeVisible();
  await expect(page.getByTestId("outreach-readiness-badge")).toBeVisible();
  await snap(page, outputDir, "core-outreach-settings", {
    note: "Outreach configuration and send readiness",
  });

  covered.push("Dashboard", "Deployment readiness", "Outreach settings");
});

test("02 — prospects, clients, and campaign assignment surfaces", async ({ shared: page }) => {
  console.log("  [audit] prospects, clients, campaigns");

  await navigate(page, "/dashboard/prospects/new");
  await expect(page.getByTestId("new-prospect-form")).toBeVisible();
  await page.fill("#companyName", PROSPECT_NAME);
  await page.fill("#websiteUrl", PROSPECT_WEBSITE);
  await page.fill("#contactName", "Audit Contact");
  await page.fill("#contactEmail", "audit-prospect@example.com");
  await page.fill("#contactPhone", "(555) 111-2222");
  await page.fill("#source", "portal:audit");
  await page.fill("#campaign", "Audit warm list");
  await page.fill("#notes", "Seeded by the broader business audit harness.");
  await snap(page, outputDir, "prospect-new-filled", {
    note: "New prospect form before submission",
    cta: "Create Prospect",
  });
  await page.getByTestId("create-prospect-submit").click();

  await expect(page.getByTestId("prospect-detail-page")).toBeVisible();
  prospectId = page.url().split("/").pop() ?? null;
  await expect(page.getByTestId("prospect-actions")).toBeVisible();
  await expect(page.getByTestId("prospect-edit-form")).toBeVisible();
  await snap(page, outputDir, "prospect-detail", {
    note: "Prospect detail with edit path, enrichment, readiness, and outreach surfaces",
  });

  await page.selectOption('[data-testid="prospect-automation-level"]', "convert_only");
  await page.getByTestId("prospect-convert-button").click();
  await expect.poll(async () => page.getByText("Project:").textContent(), { timeout: 15000 }).not.toBeNull();
  const linkedProject = page.locator('a[href^="/dashboard/projects/"]').first();
  await expect(linkedProject).toBeVisible();
  const linkedProjectHref = await linkedProject.getAttribute("href");
  projectId = linkedProjectHref?.split("/").pop() ?? null;
  await snap(page, outputDir, "prospect-converted", {
    note: "Prospect conversion creates linked client and project surfaces",
  });

  await navigate(page, "/dashboard/new");
  await expect(page.getByTestId("new-intake-form")).toBeVisible();
  await page.locator('input[name="clientModeToggle"]').nth(1).check();
  await expect(page.locator('input[name="clientModeToggle"]').nth(1)).toBeChecked();
  await expect(page.locator("#existingClientId")).toContainText(PROSPECT_NAME);
  await snap(page, outputDir, "client-reuse-on-new-intake", {
    note: "Client surface is currently exercised through existing-client intake reuse",
  });

  await navigate(page, "/dashboard/campaigns");
  await expect(page.getByTestId("campaign-list-page")).toBeVisible();
  await page.getByTestId("campaign-name-input").fill(CAMPAIGN_NAME);
  await page.getByTestId("campaign-description-input").fill("Audit campaign for broader portal coverage.");
  await page.getByTestId("campaign-create-button").click();
  await expect(page.getByTestId("campaign-list")).toContainText(CAMPAIGN_NAME);
  const createdCampaignCard = page.locator('[data-testid^="campaign-card-"]', { hasText: CAMPAIGN_NAME }).first();
  const cardTestId = await createdCampaignCard.getAttribute("data-testid");
  campaignId = cardTestId?.replace("campaign-card-", "") ?? null;
  await snap(page, outputDir, "campaign-list", {
    note: "Campaign list with create form and metrics cards",
  });

  if (prospectId && campaignId) {
    await navigate(page, "/dashboard/prospects");
    await expect(page.getByTestId("prospect-list-page")).toBeVisible();
    await page.getByTestId(`prospect-select-${prospectId}`).check();
    await page.getByTestId("prospect-bulk-campaign-select").selectOption(campaignId);
    await page.getByTestId("prospect-bulk-assign-button").click();
    await expect(page.getByTestId(`prospect-card-${prospectId}`)).toContainText(CAMPAIGN_NAME);
    await snap(page, outputDir, "prospect-list-assigned", {
      note: "Prospect list with bulk campaign assignment",
    });

    await navigate(page, `/dashboard/campaigns/${campaignId}`);
    await expect(page.getByTestId("campaign-detail-page")).toBeVisible();
    await expect(page.getByTestId("campaign-analytics-row")).toBeVisible();
    await expect(page.getByTestId("campaign-analytics-needs-attention")).toBeVisible();
    await expect(page.getByTestId("campaign-sequence-builder")).toBeVisible();
    await expect(page.getByTestId("campaign-batch-actions")).toBeVisible();
    await snap(page, outputDir, "campaign-detail", {
      note: "Campaign detail with analytics, batch actions, and sequence builder",
    });
  }

  covered.push("Prospects list/detail/create/edit", "Client reuse in new intake", "Campaign list/detail/assignment");
});

test("03 — project quotes and deployment surfaces", async ({ shared: page }) => {
  console.log("  [audit] project delivery surfaces");
  test.skip(!projectId, "No converted project available from prospect flow.");

  await navigate(page, `/dashboard/projects/${projectId}`);
  await expect(page.getByTestId("project-header")).toBeVisible();
  await expect(page.getByTestId("quote-section")).toBeVisible();
  await expect(page.getByTestId("deployment-runs-section")).toBeVisible();
  await expect(page.getByTestId("project-job-artifact-viewer")).toBeVisible();
  await snap(page, outputDir, "project-delivery-surfaces", {
    note: "Project detail with quote, deployment, and job/artifact surfaces",
  });

  const createQuoteButton = page.getByTestId("btn-create-quote");
  if (await createQuoteButton.isVisible().catch(() => false)) {
    await createQuoteButton.click();
    const quoteCard = page.locator('[data-testid^="quote-card-"]').first();
    await expect(quoteCard).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid^="quote-client-send-summary-"]').first()).toBeVisible();
    await snap(page, outputDir, "project-quote-created", {
      note: "Quote surface now includes a client-sendable summary and email draft",
    });
  } else {
    addObservation("Quote already existed before the business audit; skipped quote creation.");
  }

  covered.push("Project quote/contracts surface", "Project deployment history", "Project jobs/artifacts surface");
});

test("04 — analytics and admin/settings surfaces", async ({ shared: page }) => {
  console.log("  [audit] analytics and admin surfaces");

  const role = await readCurrentRole(page);
  addObservation(`Audit running as role: ${role}`);

  await navigate(page, "/dashboard/settings/pricing");
  await expect(page.getByTestId("pricing-settings-page")).toBeVisible();
  await expect(page.getByTestId("pricing-history-list")).toBeVisible();
  await snap(page, outputDir, "settings-pricing", {
    note: "Pricing settings and audit history",
  });
  covered.push("Pricing settings");

  if (role === "admin" || role === "sales" || role === "operator") {
    await navigate(page, "/dashboard/analytics");
    await expect(page.getByTestId("analytics-page")).toBeVisible();
    await expect(page.getByTestId("analytics-funnel-metrics")).toBeVisible();
    await expect(page.getByTestId("analytics-campaign-rollups")).toBeVisible();
    await snap(page, outputDir, "analytics", {
      note: "Sales and campaign analytics",
    });
    covered.push("Analytics dashboard");
  } else {
    skipped.push("Analytics dashboard hidden for current role");
  }

  if (role === "admin") {
    await page.goto("/dashboard/settings/team");
    await expect(page.getByTestId("team-settings-page")).toBeVisible();
    await expect(page.getByTestId("team-role-guide")).toBeVisible();
    await snap(page, outputDir, "team-settings", {
      note: "Team role management and invite stub",
    });

    await page.goto("/dashboard/approvals");
    await expect(page.getByTestId("approvals-page")).toBeVisible();
    await expect(page.getByTestId("pending-approvals-list")).toBeVisible();
    await snap(page, outputDir, "approvals", {
      note: "Admin approval queue",
    });

    covered.push("Team settings", "Approvals queue");
  } else {
    skipped.push("Team settings require admin");
    skipped.push("Approvals queue requires admin");
  }
});
