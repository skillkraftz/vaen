import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDeploymentEligibility, summarizeDeploymentPayloadMetadata } from "./deployment-control-plane";
import { getDeploymentReadiness } from "./deployment-readiness";

const REPO_ROOT = resolve(__dirname, "../../../..");

function readyReadiness() {
  return getDeploymentReadiness({
    NEXT_PUBLIC_PORTAL_URL: "https://vaen.space",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    RESEND_WEBHOOK_SECRET: "whsec_test",
  });
}

describe("deployment control plane helpers", () => {
  it("blocks deployment run creation until revision, export, and generate pointers align", () => {
    const readiness = readyReadiness();

    expect(
      getDeploymentEligibility(
        {
          current_revision_id: null,
          last_exported_revision_id: null,
          last_generated_revision_id: null,
        },
        readiness,
      ),
    ).toEqual({
      allowed: false,
      reason: "No active version found. Process the intake first.",
    });

    expect(
      getDeploymentEligibility(
        {
          current_revision_id: "rev-1",
          last_exported_revision_id: null,
          last_generated_revision_id: null,
        },
        readiness,
      ).reason,
    ).toContain("Export the current revision");

    expect(
      getDeploymentEligibility(
        {
          current_revision_id: "rev-1",
          last_exported_revision_id: "rev-1",
          last_generated_revision_id: null,
        },
        readiness,
      ).reason,
    ).toContain("Generate the current revision");

    expect(
      getDeploymentEligibility(
        {
          current_revision_id: "rev-1",
          last_exported_revision_id: "rev-1",
          last_generated_revision_id: "rev-1",
        },
        readiness,
      ),
    ).toEqual({ allowed: true, reason: null });
  });

  it("surfaces readiness blockers before project-state checks", () => {
    const readiness = getDeploymentReadiness({
      NEXT_PUBLIC_PORTAL_URL: "https://vaen.space",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    });

    const result = getDeploymentEligibility(
      {
        current_revision_id: "rev-1",
        last_exported_revision_id: "rev-1",
        last_generated_revision_id: "rev-1",
      },
      readiness,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("summarizes validated payload metadata for compact history display", () => {
    expect(
      summarizeDeploymentPayloadMetadata({
        summary: {
          framework: "nextjs",
          subdomain: "flower-city-painting",
          templateId: "service-core",
          moduleCount: 3,
        },
      }),
    ).toBe("nextjs · flower-city-painting · service-core · 3 modules");
  });
});

describe("deployment control plane integration", () => {
  it("adds a deployment history section to the project page", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const panelPath = join(__dirname, "../app/dashboard/projects/[id]/project-deployment-panel.tsx");
    const pageSource = readFileSync(pagePath, "utf-8");
    const panelSource = readFileSync(panelPath, "utf-8");

    expect(pageSource).toContain("DeploymentRunsSection");
    expect(pageSource).toContain('from("deployment_runs")');
    expect(panelSource).toContain('data-testid="deployment-runs-section"');
    expect(panelSource).toContain('data-testid="create-deployment-run"');
    expect(panelSource).toContain('data-testid="deployment-run-latest"');
  });

  it("creates deployment runs through a deploy_prepare job instead of faking provider deployment", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const fnStart = source.indexOf("export async function createDeploymentRunAction");
    const fnEnd = source.indexOf("export async function getProjectJobsAction");
    const fn = source.slice(fnStart, fnEnd);

    expect(fn).toContain("getDeploymentReadiness()");
    expect(fn).toContain("getDeploymentEligibility");
    expect(fn).toContain('job_type: "deploy_prepare"');
    expect(fn).toContain('from("deployment_runs")');
    expect(fn).toContain('provider: "unconfigured"');
    expect(fn).toContain('status: "deploying"');
  });

  it("worker validates deployment payloads and records structured deployment run results", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");

    expect(source).toContain('case "deploy_prepare"');
    expect(source).toContain("executeDeploymentPrepare");
    expect(source).toContain('from("deployment_runs")');
    expect(source).toContain('status: "validated"');
    expect(source).toContain('status: "deploy_ready"');
    expect(source).toContain("deployment-payload.json");
  });
});
