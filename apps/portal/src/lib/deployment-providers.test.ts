import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { summarizeProviderExecutionFromRun } from "./deployment-control-plane";

const REPO_ROOT = resolve(__dirname, "../../../..");
const SRC_ROOT = resolve(__dirname, "..");

/* ── Shared interface tests ─────────────────────────────────────── */

describe("provider adapter shared types", () => {
  it("defines all three provider types with labels in providers.ts", () => {
    const sharedPath = join(REPO_ROOT, "packages/shared/src/providers.ts");
    expect(existsSync(sharedPath)).toBe(true);
    const source = readFileSync(sharedPath, "utf-8");
    expect(source).toContain('"github"');
    expect(source).toContain('"vercel"');
    expect(source).toContain('"domain"');
    expect(source).toContain("GitHub Repository");
    expect(source).toContain("Vercel Deployment");
    expect(source).toContain("Domain Configuration");
  });

  it("defines execution order as github → vercel → domain", () => {
    const sharedPath = join(REPO_ROOT, "packages/shared/src/providers.ts");
    const source = readFileSync(sharedPath, "utf-8");
    // Verify the array contains providers in order
    const orderMatch = source.match(/PROVIDER_EXECUTION_ORDER.*?\[([^\]]+)\]/s);
    expect(orderMatch).toBeTruthy();
    const orderContent = orderMatch![1];
    const githubIdx = orderContent.indexOf('"github"');
    const vercelIdx = orderContent.indexOf('"vercel"');
    const domainIdx = orderContent.indexOf('"domain"');
    expect(githubIdx).toBeLessThan(vercelIdx);
    expect(vercelIdx).toBeLessThan(domainIdx);
  });

  it("exports provider interfaces from the shared package", () => {
    const sharedPath = join(REPO_ROOT, "packages/shared/src/providers.ts");
    const source = readFileSync(sharedPath, "utf-8");
    expect(source).toContain("export type DeploymentProviderType");
    expect(source).toContain("export interface DeploymentProviderAdapter");
    expect(source).toContain("export interface ProviderStepResult");
    expect(source).toContain("export interface ProviderExecutionResult");
    expect(source).toContain("export interface ProviderExecutionContext");
    expect(source).toContain("export type ProviderResultStatus");
  });

  it("re-exports provider types from the shared index", () => {
    const indexPath = join(REPO_ROOT, "packages/shared/src/index.ts");
    const source = readFileSync(indexPath, "utf-8");
    expect(source).toContain("PROVIDER_LABELS");
    expect(source).toContain("PROVIDER_EXECUTION_ORDER");
    expect(source).toContain("DeploymentProviderAdapter");
    expect(source).toContain("ProviderExecutionContext");
    expect(source).toContain("isProviderExecutionSuccessful");
    expect(source).toContain("hasAnyConfiguredProvider");
    expect(source).toContain("summarizeProviderExecution");
  });
});

/* ── Shared helper logic tests ──────────────────────────────────── */

describe("provider execution shared helpers", () => {
  it("isProviderExecutionSuccessful checks status === succeeded", () => {
    const source = readFileSync(join(REPO_ROOT, "packages/shared/src/providers.ts"), "utf-8");
    expect(source).toContain("export function isProviderExecutionSuccessful");
    expect(source).toContain('result.status === "succeeded"');
  });

  it("hasAnyConfiguredProvider checks adapter.isConfigured()", () => {
    const source = readFileSync(join(REPO_ROOT, "packages/shared/src/providers.ts"), "utf-8");
    expect(source).toContain("export function hasAnyConfiguredProvider");
    expect(source).toContain("adapter.isConfigured()");
  });

  it("summarizeProviderExecution handles empty steps, all-not-configured, and mixed results", () => {
    const source = readFileSync(join(REPO_ROOT, "packages/shared/src/providers.ts"), "utf-8");
    expect(source).toContain("export function summarizeProviderExecution");
    expect(source).toContain("No provider steps executed");
    expect(source).toContain("No providers are configured");
    expect(source).toContain("not implemented");
    expect(source).toContain("unsupported");
    expect(source).toContain("succeeded");
    expect(source).toContain("failed");
  });

  it("defines explicit provider result statuses for unconfigured and stubbed execution", () => {
    const source = readFileSync(join(REPO_ROOT, "packages/shared/src/providers.ts"), "utf-8");
    expect(source).toContain('"not_configured"');
    expect(source).toContain('"not_implemented"');
    expect(source).toContain('"unsupported"');
    expect(source).toContain('"succeeded"');
    expect(source).toContain('"failed"');
    expect(source).toContain('"skipped"');
  });
});

/* ── Portal control plane helpers ───────────────────────────────── */

describe("provider execution summary from deployment run", () => {
  it("extracts summary from payload_metadata.provider_execution", () => {
    const run = {
      payload_metadata: {
        provider_execution: {
          status: "not_configured",
          summary: "No deployment providers are configured.",
          steps: [],
        },
      },
    };
    expect(summarizeProviderExecutionFromRun(run)).toBe("No deployment providers are configured.");
  });

  it("returns null when no provider execution data", () => {
    expect(summarizeProviderExecutionFromRun({ payload_metadata: {} })).toBe(null);
    expect(summarizeProviderExecutionFromRun({ payload_metadata: { summary: "foo" } })).toBe(null);
  });

  it("returns null for null payload_metadata", () => {
    expect(summarizeProviderExecutionFromRun({ payload_metadata: null as unknown as Record<string, unknown> })).toBe(null);
  });
});

/* ── Worker adapter stubs ───────────────────────────────────────── */

describe("worker provider adapter stubs", () => {
  it("has GitHub adapter stub", () => {
    const adapterPath = join(REPO_ROOT, "apps/worker/src/providers/github.ts");
    expect(existsSync(adapterPath)).toBe(true);
    const source = readFileSync(adapterPath, "utf-8");
    expect(source).toContain("class GitHubProviderAdapter");
    expect(source).toContain("implements DeploymentProviderAdapter");
    expect(source).toContain('type = "github"');
    expect(source).toContain("isConfigured()");
    expect(source).toContain("GITHUB_TOKEN");
    expect(source).toContain("GITHUB_ORG");
    expect(source).toContain('"not_implemented"');
  });

  it("has Vercel adapter stub", () => {
    const adapterPath = join(REPO_ROOT, "apps/worker/src/providers/vercel.ts");
    expect(existsSync(adapterPath)).toBe(true);
    const source = readFileSync(adapterPath, "utf-8");
    expect(source).toContain("class VercelProviderAdapter");
    expect(source).toContain("implements DeploymentProviderAdapter");
    expect(source).toContain('type = "vercel"');
    expect(source).toContain("VERCEL_TOKEN");
    expect(source).toContain('"not_implemented"');
  });

  it("has Domain adapter stub", () => {
    const adapterPath = join(REPO_ROOT, "apps/worker/src/providers/domain.ts");
    expect(existsSync(adapterPath)).toBe(true);
    const source = readFileSync(adapterPath, "utf-8");
    expect(source).toContain("class DomainProviderAdapter");
    expect(source).toContain("implements DeploymentProviderAdapter");
    expect(source).toContain('type = "domain"');
    expect(source).toContain("DNS_PROVIDER_TOKEN");
    expect(source).toContain("VAEN_BASE_DOMAIN");
    expect(source).toContain('"not_implemented"');
  });

  it("has provider registry with execution function", () => {
    const indexPath = join(REPO_ROOT, "apps/worker/src/providers/index.ts");
    expect(existsSync(indexPath)).toBe(true);
    const source = readFileSync(indexPath, "utf-8");
    expect(source).toContain("createProviderAdapters");
    expect(source).toContain("executeProviderAdapters");
    expect(source).toContain("PROVIDER_EXECUTION_ORDER");
    expect(source).toContain("GitHubProviderAdapter");
    expect(source).toContain("VercelProviderAdapter");
    expect(source).toContain("DomainProviderAdapter");
  });
});

/* ── Worker integration ─────────────────────────────────────────── */

describe("worker deploy_execute integration", () => {
  it("adds deploy_execute job type to shared definitions", () => {
    const jobsPath = join(REPO_ROOT, "packages/shared/src/jobs.ts");
    const source = readFileSync(jobsPath, "utf-8");
    expect(source).toContain('"deploy_execute"');
    expect(source).toContain('deploy_execute: "Execute provider deployment"');
    expect(source).toContain("DeployExecutePayload");
  });

  it("routes deploy_execute jobs in the worker job dispatcher", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain('case "deploy_execute"');
    expect(source).toContain("executeDeploymentProviders");
    expect(source).toContain("executeProviderAdapters");
  });

  it("records provider execution results in deployment run metadata", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain("provider_execution");
    expect(source).toContain("deployment_providers_not_configured");
    expect(source).toContain("deployment_providers_not_implemented");
    expect(source).toContain("deployment_providers_unsupported");
    expect(source).toContain("deployment_completed");
    expect(source).toContain("deployment_provider_failed");
  });

  it("requires validated deployment run before provider execution", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain('deploymentRun.status !== "validated"');
    expect(source).toContain("Cannot execute providers");
  });
});

/* ── Portal UI integration ──────────────────────────────────────── */

describe("deployment panel provider display", () => {
  it("shows provider execution summary on deployment runs", () => {
    const panelPath = join(SRC_ROOT, "app/dashboard/projects/[id]/project-deployment-panel.tsx");
    const source = readFileSync(panelPath, "utf-8");
    expect(source).toContain("summarizeProviderExecutionFromRun");
    expect(source).toContain("deployment-run-provider-summary");
    expect(source).toContain("Execute Providers");
  });
});

/* ── Documentation ──────────────────────────────────────────────── */

describe("deployment docs", () => {
  it("documents the provider adapter foundation", () => {
    const docsPath = join(REPO_ROOT, "docs/architecture/deployment.md");
    const source = readFileSync(docsPath, "utf-8");
    expect(source).toContain("Provider Adapter Foundation");
    expect(source).toContain("DeploymentProviderAdapter");
    expect(source).toContain("GitHubProviderAdapter");
    expect(source).toContain("VercelProviderAdapter");
    expect(source).toContain("DomainProviderAdapter");
    expect(source).toContain("not_configured");
    expect(source).toContain("not_implemented");
    expect(source).toContain("GITHUB_TOKEN");
    expect(source).toContain("VERCEL_TOKEN");
    expect(source).toContain("DNS_PROVIDER_TOKEN");
  });
});
