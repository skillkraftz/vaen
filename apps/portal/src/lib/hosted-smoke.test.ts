import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("hosted smoke audit path", () => {
  it("adds a dedicated hosted smoke playwright script", () => {
    const packageJson = readFileSync(
      join(REPO_ROOT, "apps/portal/package.json"),
      "utf-8",
    );

    expect(packageJson).toContain('"smoke:hosted"');
    expect(packageJson).toContain("e2e/hosted-smoke.spec.ts");
  });

  it("adds a focused hosted smoke audit spec for deployment testing", () => {
    const specSource = readFileSync(
      join(REPO_ROOT, "apps/portal/e2e/hosted-smoke.spec.ts"),
      "utf-8",
    );

    expect(specSource).toContain("PORTAL_SMOKE_PROJECT_ID");
    expect(specSource).toContain("PORTAL_SMOKE_WAIT_FOR_PROVIDER_REFERENCE");
    expect(specSource).toContain('deployment-settings-page');
    expect(specSource).toContain('deployment-worker-health');
    expect(specSource).toContain('deployment-runs-section');
    expect(specSource).toContain('create-deployment-run');
    expect(specSource).toContain("Provider execution queued");
    expect(specSource).toContain("Deployment run queued");
    expect(specSource).toContain('deployment-run-provider-reference-');
  });

  it("documents the hosted smoke path in deployment-facing docs", () => {
    const rootReadme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
    const portalReadme = readFileSync(
      join(REPO_ROOT, "apps/portal/README.md"),
      "utf-8",
    );
    const deploymentDoc = readFileSync(
      join(REPO_ROOT, "docs/architecture/deployment.md"),
      "utf-8",
    );
    const deploymentPage = readFileSync(
      join(
        REPO_ROOT,
        "apps/portal/src/app/dashboard/settings/deployment/page.tsx",
      ),
      "utf-8",
    );

    expect(rootReadme).toContain("smoke:hosted");
    expect(rootReadme).toContain("PORTAL_SMOKE_PROJECT_ID");
    expect(portalReadme).toContain("smoke:hosted");
    expect(portalReadme).toContain("PORTAL_SMOKE_PROJECT_ID");
    expect(deploymentDoc).toContain("smoke:hosted");
    expect(deploymentDoc).toContain("PORTAL_SMOKE_PROJECT_ID");
    expect(deploymentPage).toContain('data-testid="deployment-hosted-smoke-command"');
    expect(deploymentPage).toContain("pnpm --filter @vaen/portal smoke:hosted");
  });
});
