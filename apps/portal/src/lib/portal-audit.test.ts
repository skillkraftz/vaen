import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("portal audit harness", () => {
  it("keeps portal:audit scoped to the modular portal audit specs", () => {
    const rootPackage = readFileSync(join(REPO_ROOT, "package.json"), "utf-8");
    const portalPackage = readFileSync(join(REPO_ROOT, "apps/portal/package.json"), "utf-8");

    expect(rootPackage).toContain('"portal:audit"');
    expect(portalPackage).toContain('"ux-audit"');
    expect(portalPackage).toContain("e2e/portal-*.spec.ts");
    expect(portalPackage).not.toContain('ux-audit": "npx playwright test --config playwright.config.ts"');
  });

  it("adds a broader business-surface audit spec alongside the original workflow audit", () => {
    const newSpec = readFileSync(join(REPO_ROOT, "apps/portal/e2e/portal-business-surfaces.spec.ts"), "utf-8");
    const originalSpec = readFileSync(join(REPO_ROOT, "apps/portal/e2e/portal-audit.spec.ts"), "utf-8");
    const helpers = readFileSync(join(REPO_ROOT, "apps/portal/e2e/helpers.ts"), "utf-8");

    expect(newSpec).toContain("core portal surfaces");
    expect(newSpec).toContain("prospects, clients, campaigns");
    expect(newSpec).toContain("project quotes and deployment surfaces");
    expect(newSpec).toContain("analytics and admin/settings surfaces");
    expect(newSpec).toContain('deployment-settings-page');
    expect(newSpec).toContain('campaign-detail-page');
    expect(newSpec).toContain('pricing-settings-page');
    expect(newSpec).toContain('quote-client-send-summary-');
    expect(newSpec).toContain('page.goto("/dashboard", { waitUntil: "domcontentloaded" })');
    expect(newSpec).toContain('page.getByTestId("dashboard-header").isVisible()');
    expect(newSpec).toContain('page.getByTestId("login-page")');
    expect(newSpec).toContain('waitUntil: "domcontentloaded"');
    expect(newSpec).toContain("async function navigate(page: Page, path: string)");
    expect(newSpec).toContain("test.beforeAll(async ({ browser }) =>");
    expect(newSpec).toContain("await login(pg);");
    expect(newSpec).toContain('page.waitForURL("**/dashboard**"');
    expect(newSpec).toContain('page.getByTestId("dashboard-header").waitFor({ timeout: 20_000 })');
    expect(newSpec).toContain('page.locator(".alert-error").waitFor({ timeout: 20_000 })');
    expect(newSpec).not.toContain('console.log("  [audit] core portal surfaces");\n  await login(page);');
    expect(originalSpec).toContain("Portal UX Audit Flow — Full Workflow");
    expect(originalSpec).toContain("const verificationVisible = await verification.isVisible().catch(() => false)");
    expect(helpers).toContain("resetAuditSession");
    expect(helpers).toContain("writeBusinessAuditNotes");
  });

  it("documents portal:audit as the broader business audit path", () => {
    const rootReadme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
    const portalReadme = readFileSync(join(REPO_ROOT, "apps/portal/README.md"), "utf-8");
    const config = readFileSync(join(REPO_ROOT, "apps/portal/playwright.config.ts"), "utf-8");

    expect(rootReadme).toContain("pnpm portal:audit");
    expect(rootReadme).toContain("portal-*.spec.ts");
    expect(portalReadme).toContain("pnpm ux-audit");
    expect(portalReadme).toContain("pnpm portal:audit");
    expect(portalReadme).toContain("dashboard navigation, prospects, campaigns, pricing, deployment readiness");
    expect(config).toContain("modular `portal-*.spec.ts` suite");
    expect(config).toContain("Hosted deployment verification remains a separate explicit path");
  });
});
