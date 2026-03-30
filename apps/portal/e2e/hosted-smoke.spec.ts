import { test, expect, type Page } from "@playwright/test";

const EMAIL = process.env.PORTAL_EMAIL ?? "";
const PASSWORD = process.env.PORTAL_PASSWORD ?? "";
const PROJECT_ID = process.env.PORTAL_SMOKE_PROJECT_ID ?? "";
const WAIT_FOR_PROVIDER_REFERENCE = process.env.PORTAL_SMOKE_WAIT_FOR_PROVIDER_REFERENCE === "1";
const PROVIDER_REFERENCE_TIMEOUT_MS = Number(
  process.env.PORTAL_SMOKE_PROVIDER_REFERENCE_TIMEOUT_MS ?? "90000",
);

function requireHostedSmokeEnv() {
  const missing = [
    !EMAIL ? "PORTAL_EMAIL" : null,
    !PASSWORD ? "PORTAL_PASSWORD" : null,
    !PROJECT_ID ? "PORTAL_SMOKE_PROJECT_ID" : null,
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Set ${missing.join(", ")} before running the hosted smoke audit.`,
    );
  }
}

async function login(page: Page) {
  await page.goto("/login");
  await expect(page.getByTestId("login-page")).toBeVisible();

  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByTestId("login-submit").click();

  await page.waitForURL("**/dashboard**", { timeout: 20_000 });
  await expect(page.getByTestId("dashboard-header")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  requireHostedSmokeEnv();
});

test("hosted smoke audit", async ({ page }) => {
  await login(page);

  await page.goto("/dashboard/settings/deployment");
  await expect(page.getByTestId("deployment-settings-page")).toBeVisible();
  await expect(page.getByTestId("deployment-worker-health")).toBeVisible();
  await expect(page.getByTestId("deployment-hosted-testing-checklist")).toBeVisible();

  await page.goto(`/dashboard/projects/${PROJECT_ID}`);
  await expect(page.getByTestId("project-header")).toBeVisible();
  await expect(page.getByTestId("deployment-runs-section")).toBeVisible();

  await page.getByTestId("create-deployment-run").click();
  await expect(page.getByText(/Deployment run queued/i)).toBeVisible({
    timeout: 15_000,
  });

  const executeButtons = page.locator('[data-testid^="execute-deployment-providers-"]');
  const executeCount = await executeButtons.count();

  if (executeCount > 0) {
    await executeButtons.first().click();
    await expect(page.getByText(/Provider execution queued/i)).toBeVisible({
      timeout: 15_000,
    });
  }

  if (WAIT_FOR_PROVIDER_REFERENCE) {
    const providerReference = page.locator(
      '[data-testid^="deployment-run-provider-reference-"]',
    );
    await expect(providerReference.first()).toBeVisible({
      timeout: PROVIDER_REFERENCE_TIMEOUT_MS,
    });
  }
});
