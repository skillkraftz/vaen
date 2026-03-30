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
    const hostedPack = readFileSync(
      join(REPO_ROOT, "docs/architecture/hosted-testing-pack.md"),
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
    expect(deploymentDoc).toContain("does **not** prove");
    expect(hostedPack).toContain("Covered by this smoke path");
    expect(hostedPack).toContain("Not covered by this smoke path");
    expect(hostedPack).toContain("manually confirming GitHub repo contents");
    expect(hostedPack).toContain("manually confirming the Vercel deployment");
    expect(hostedPack).toContain("manually confirming managed subdomain resolution");
    expect(deploymentPage).toContain('data-testid="deployment-hosted-smoke-command"');
    expect(deploymentPage).toContain('data-testid="deployment-hosted-smoke-coverage"');
    expect(deploymentPage).toContain("pnpm --filter @vaen/portal smoke:hosted");
    expect(deploymentPage).toContain("portal reachability, auth, worker heartbeat visibility, deployment run creation");
    expect(deploymentPage).toContain("provider execution queue visibility");
    expect(deploymentPage).toContain("does not prove GitHub repo contents");
    expect(deploymentPage).toContain("live Vercel deployment health");
    expect(deploymentPage).toContain("final DNS propagation");
  });
});
