import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { summarizeProviderExecutionFromRun } from "./deployment-control-plane";
import {
  deriveGitHubRepoName,
  ensureGitHubRepository,
  GitHubProviderAdapter,
} from "../../../worker/src/providers/github";
import {
  deriveManagedDomain,
  DomainProviderAdapter,
} from "../../../worker/src/providers/domain";
import { VercelProviderAdapter } from "../../../worker/src/providers/vercel";

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

/* ── Worker provider adapters ───────────────────────────────────── */

describe("worker provider adapter stubs", () => {
  it("has GitHub adapter implementation", () => {
    const adapterPath = join(REPO_ROOT, "apps/worker/src/providers/github.ts");
    expect(existsSync(adapterPath)).toBe(true);
    const source = readFileSync(adapterPath, "utf-8");
    expect(source).toContain("class GitHubProviderAdapter");
    expect(source).toContain("implements DeploymentProviderAdapter");
    expect(source).toContain('type = "github"');
    expect(source).toContain("isConfigured()");
    expect(source).toContain("GITHUB_TOKEN");
    expect(source).toContain("GITHUB_ORG");
    expect(source).toContain("createRepository");
    expect(source).toContain("pushSiteSourceToGitHubRepo");
    expect(source).toContain('status: "succeeded"');
  });

  it("has Vercel adapter implementation", () => {
    const adapterPath = join(REPO_ROOT, "apps/worker/src/providers/vercel.ts");
    expect(existsSync(adapterPath)).toBe(true);
    const source = readFileSync(adapterPath, "utf-8");
    expect(source).toContain("class VercelProviderAdapter");
    expect(source).toContain("implements DeploymentProviderAdapter");
    expect(source).toContain('type = "vercel"');
    expect(source).toContain("VERCEL_TOKEN");
    expect(source).toContain("createProject");
    expect(source).toContain("createDeployment");
    expect(source).toContain('status: "succeeded"');
  });

  it("has Domain adapter implementation", () => {
    const adapterPath = join(REPO_ROOT, "apps/worker/src/providers/domain.ts");
    expect(existsSync(adapterPath)).toBe(true);
    const source = readFileSync(adapterPath, "utf-8");
    expect(source).toContain("class DomainProviderAdapter");
    expect(source).toContain("implements DeploymentProviderAdapter");
    expect(source).toContain('type = "domain"');
    expect(source).toContain("DNS_PROVIDER_TOKEN");
    expect(source).toContain("VAEN_BASE_DOMAIN");
    expect(source).toContain("createDeploymentAlias");
    expect(source).toContain("addProjectDomain");
    expect(source).toContain('status: "succeeded"');
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
    expect(source).toContain("priorSteps: steps");
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
    expect(source).toContain("deployment_provider_executed");
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
    expect(source).toContain("deployment-run-provider-reference");
    expect(source).toContain("Execute Providers");
  });
});

describe("github provider helpers", () => {
  it("derives sane repo names from target slugs", () => {
    expect(deriveGitHubRepoName("flower-city-painting")).toBe("vaen-flower-city-painting");
    expect(deriveGitHubRepoName("Flower City Painting!!")).toBe("vaen-flower-city-painting");
    expect(deriveGitHubRepoName("vaen-existing-slug")).toBe("vaen-existing-slug");
  });

  it("reuses an existing repo instead of creating a duplicate", async () => {
    const calls: string[] = [];
    const repo = await ensureGitHubRepository(
      {
        async getRepository() {
          calls.push("get");
          return {
            name: "vaen-flower-city-painting",
            htmlUrl: "https://github.com/acme/vaen-flower-city-painting",
            cloneUrl: "https://github.com/acme/vaen-flower-city-painting.git",
            defaultBranch: "main",
            existed: true,
          };
        },
        async createRepository() {
          calls.push("create");
          throw new Error("should not create");
        },
      },
      "acme",
      "vaen-flower-city-painting",
      "flower-city-painting",
    );

    expect(repo.existed).toBe(true);
    expect(calls).toEqual(["get"]);
  });

  it("creates a repo when missing and returns a real provider reference", async () => {
    process.env.GITHUB_TOKEN = "gh-test";
    process.env.GITHUB_ORG = "acme";

    const adapter = new GitHubProviderAdapter({
      apiClient: {
        async getRepository() {
          return null;
        },
        async createRepository(_org, name) {
          return {
            name,
            htmlUrl: `https://github.com/acme/${name}`,
            cloneUrl: `https://github.com/acme/${name}.git`,
            defaultBranch: "main",
            existed: false,
          };
        },
      },
      resolveSiteDir: () => "/tmp/generated/site",
      pushSiteSource: async () => ({
        commitSha: "abc123",
        pushedFilesCount: 14,
      }),
    });

    const result = await adapter.execute({
      deploymentRunId: "run-1",
      projectId: "project-1",
      targetSlug: "flower-city-painting",
      payload: { framework: "nextjs", sitePath: "generated/flower-city-painting/site" },
      payloadSummary: {},
    });

    expect(result.status).toBe("succeeded");
    expect(result.providerReference).toBe("https://github.com/acme/vaen-flower-city-painting");
    expect(result.metadata).toMatchObject({
      repoName: "vaen-flower-city-painting",
      existed: false,
      commitSha: "abc123",
      pushedFilesCount: 14,
    });

    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_ORG;
  });

  it("returns unsupported instead of faking success for non-nextjs payloads", async () => {
    process.env.GITHUB_TOKEN = "gh-test";
    process.env.GITHUB_ORG = "acme";

    const adapter = new GitHubProviderAdapter({
      apiClient: {
        async getRepository() {
          throw new Error("should not query");
        },
        async createRepository() {
          throw new Error("should not create");
        },
      },
      resolveSiteDir: () => null,
      pushSiteSource: async () => {
        throw new Error("should not push");
      },
    });

    const result = await adapter.execute({
      deploymentRunId: "run-1",
      projectId: "project-1",
      targetSlug: "flower-city-painting",
      payload: { framework: "static" },
      payloadSummary: {},
    });

    expect(result.status).toBe("unsupported");
    expect(result.providerReference).toBeNull();

    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_ORG;
  });
});

describe("vercel provider helpers", () => {
  it("returns not_configured when token is missing", async () => {
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_TEAM_ID;

    const adapter = new VercelProviderAdapter();
    const result = await adapter.execute({
      deploymentRunId: "run-1",
      projectId: "project-1",
      targetSlug: "flower-city-painting",
      payload: { framework: "nextjs", buildCommand: "next build", outputDir: ".next" },
      payloadSummary: {},
    });

    expect(result.status).toBe("not_configured");
    expect(result.providerReference).toBeNull();
  });

  it("reuses an existing vercel project and returns a deployment url", async () => {
    process.env.VERCEL_TOKEN = "vercel-test";
    process.env.VERCEL_TEAM_ID = "team_123";

    const adapter = new VercelProviderAdapter({
      apiClient: {
        async getProject(name) {
          return {
            id: "prj_123",
            name,
            framework: "nextjs",
            link: {
              type: "github",
              org: "acme",
              repo: "vaen-flower-city-painting",
              productionBranch: "main",
            },
          };
        },
        async createProject() {
          throw new Error("should not create");
        },
        async createDeployment() {
          return {
            id: "dpl_123",
            url: "flower-city-painting-preview.vercel.app",
            inspectorUrl: "https://vercel.com/acme/flower-city-painting/dpl_123",
            status: "BUILDING",
          };
        },
      },
    });

    const result = await adapter.execute({
      deploymentRunId: "run-1",
      projectId: "project-1",
      targetSlug: "flower-city-painting",
      payload: {
        framework: "nextjs",
        buildCommand: "next build",
        outputDir: ".next",
        nodeVersion: "20.x",
      },
      payloadSummary: {},
      priorSteps: [
        {
          provider: "github",
          status: "succeeded",
          message: "ok",
          providerReference: "https://github.com/acme/vaen-flower-city-painting",
          executedAt: new Date().toISOString(),
          metadata: {
            org: "acme",
            repoName: "vaen-flower-city-painting",
            defaultBranch: "main",
            commitSha: "abc123",
            repoUrl: "https://github.com/acme/vaen-flower-city-painting",
          },
        },
      ],
    });

    expect(result.status).toBe("succeeded");
    expect(result.providerReference).toBe("https://flower-city-painting-preview.vercel.app");
    expect(result.metadata).toMatchObject({
      projectId: "prj_123",
      projectCreated: false,
      deploymentId: "dpl_123",
      linkedRepo: "vaen-flower-city-painting",
    });

    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_TEAM_ID;
  });

  it("creates a new vercel project when missing", async () => {
    process.env.VERCEL_TOKEN = "vercel-test";

    const adapter = new VercelProviderAdapter({
      apiClient: {
        async getProject() {
          return null;
        },
        async createProject(input) {
          expect(input.repo).toBe("vaen-flower-city-painting");
          return {
            id: "prj_new",
            name: input.name,
            framework: "nextjs",
            link: {
              type: "github",
              org: input.org,
              repo: input.repo,
              productionBranch: input.productionBranch,
            },
          };
        },
        async createDeployment() {
          return {
            id: "dpl_new",
            url: "https://flower-city-painting-git-main-acme.vercel.app",
            inspectorUrl: null,
            status: "QUEUED",
          };
        },
      },
    });

    const result = await adapter.execute({
      deploymentRunId: "run-1",
      projectId: "project-1",
      targetSlug: "flower-city-painting",
      payload: { framework: "nextjs", buildCommand: "next build", outputDir: ".next" },
      payloadSummary: {},
      priorSteps: [
        {
          provider: "github",
          status: "succeeded",
          message: "ok",
          providerReference: "https://github.com/acme/vaen-flower-city-painting",
          executedAt: new Date().toISOString(),
          metadata: {
            org: "acme",
            repoName: "vaen-flower-city-painting",
            defaultBranch: "main",
          },
        },
      ],
    });

    expect(result.status).toBe("succeeded");
    expect(result.metadata).toMatchObject({
      projectCreated: true,
      projectId: "prj_new",
    });

    delete process.env.VERCEL_TOKEN;
  });

  it("returns unsupported when the existing project is linked to a different repo", async () => {
    process.env.VERCEL_TOKEN = "vercel-test";

    const adapter = new VercelProviderAdapter({
      apiClient: {
        async getProject(name) {
          return {
            id: "prj_conflict",
            name,
            framework: "nextjs",
            link: {
              type: "github",
              org: "acme",
              repo: "other-repo",
              productionBranch: "main",
            },
          };
        },
        async createProject() {
          throw new Error("should not create");
        },
        async createDeployment() {
          throw new Error("should not deploy");
        },
      },
    });

    const result = await adapter.execute({
      deploymentRunId: "run-1",
      projectId: "project-1",
      targetSlug: "flower-city-painting",
      payload: { framework: "nextjs" },
      payloadSummary: {},
      priorSteps: [
        {
          provider: "github",
          status: "succeeded",
          message: "ok",
          providerReference: "https://github.com/acme/vaen-flower-city-painting",
          executedAt: new Date().toISOString(),
          metadata: {
            org: "acme",
            repoName: "vaen-flower-city-painting",
            defaultBranch: "main",
          },
        },
      ],
    });

    expect(result.status).toBe("unsupported");
    expect(result.providerReference).toBeNull();

    delete process.env.VERCEL_TOKEN;
  });
});

describe("domain provider helpers", () => {
  it("derives a managed subdomain from the target slug and payload domain settings", () => {
    expect(
      deriveManagedDomain(
        "flower-city-painting",
        { domain: { subdomain: "flower-city-painting" } },
        "vaen.space",
      ),
    ).toBe("flower-city-painting.vaen.space");
    expect(
      deriveManagedDomain(
        "Flower City Painting",
        { domain: { subdomain: "Flower City Painting!!" } },
        "vaen.space",
      ),
    ).toBe("flower-city-painting.vaen.space");
  });

  it("returns not_configured when dns env is missing", async () => {
    delete process.env.DNS_PROVIDER_TOKEN;
    delete process.env.VAEN_BASE_DOMAIN;
    delete process.env.VERCEL_TEAM_ID;

    const adapter = new DomainProviderAdapter();
    const result = await adapter.execute({
      deploymentRunId: "run-1",
      projectId: "project-1",
      targetSlug: "flower-city-painting",
      payload: { framework: "nextjs", domain: { subdomain: "flower-city-painting" } },
      payloadSummary: {},
    });

    expect(result.status).toBe("not_configured");
    expect(result.providerReference).toBeNull();
  });

  it("returns unsupported for custom domains outside the managed base domain", async () => {
    process.env.DNS_PROVIDER_TOKEN = "dns-test";
    process.env.VAEN_BASE_DOMAIN = "vaen.space";

    const adapter = new DomainProviderAdapter({
      apiClient: {
        async getProjectDomain() {
          throw new Error("should not query");
        },
        async addProjectDomain() {
          throw new Error("should not create");
        },
        async createDeploymentAlias() {
          throw new Error("should not alias");
        },
      },
    });

    const result = await adapter.execute({
      deploymentRunId: "run-1",
      projectId: "project-1",
      targetSlug: "flower-city-painting",
      payload: {
        framework: "nextjs",
        domain: {
          subdomain: "flower-city-painting",
          customDomain: "www.customer-site.com",
        },
      },
      payloadSummary: {},
      priorSteps: [
        {
          provider: "vercel",
          status: "succeeded",
          message: "ok",
          providerReference: "https://flower-city-painting-preview.vercel.app",
          executedAt: new Date().toISOString(),
          metadata: {
            projectName: "flower-city-painting",
            projectId: "prj_123",
            deploymentId: "dpl_123",
          },
        },
      ],
    });

    expect(result.status).toBe("unsupported");
    expect(result.providerReference).toBeNull();

    delete process.env.DNS_PROVIDER_TOKEN;
    delete process.env.VAEN_BASE_DOMAIN;
  });

  it("attaches a managed domain and aliases the current vercel deployment", async () => {
    process.env.DNS_PROVIDER_TOKEN = "dns-test";
    process.env.VAEN_BASE_DOMAIN = "vaen.space";
    process.env.VERCEL_TEAM_ID = "team_123";

    const adapter = new DomainProviderAdapter({
      apiClient: {
        async getProjectDomain() {
          return null;
        },
        async addProjectDomain(projectName, domain) {
          expect(projectName).toBe("flower-city-painting");
          expect(domain).toBe("flower-city-painting.vaen.space");
          return {
            name: domain,
            verified: true,
          };
        },
        async createDeploymentAlias(deploymentId, domain) {
          expect(deploymentId).toBe("dpl_123");
          expect(domain).toBe("flower-city-painting.vaen.space");
          return {
            alias: domain,
            deploymentId,
          };
        },
      },
    });

    const result = await adapter.execute({
      deploymentRunId: "run-1",
      projectId: "project-1",
      targetSlug: "flower-city-painting",
      payload: {
        framework: "nextjs",
        domain: { subdomain: "flower-city-painting" },
      },
      payloadSummary: {},
      priorSteps: [
        {
          provider: "vercel",
          status: "succeeded",
          message: "ok",
          providerReference: "https://flower-city-painting-preview.vercel.app",
          executedAt: new Date().toISOString(),
          metadata: {
            projectName: "flower-city-painting",
            projectId: "prj_123",
            deploymentId: "dpl_123",
            deploymentUrl: "https://flower-city-painting-preview.vercel.app",
          },
        },
      ],
    });

    expect(result.status).toBe("succeeded");
    expect(result.providerReference).toBe("https://flower-city-painting.vaen.space");
    expect(result.metadata).toMatchObject({
      managedDomain: "flower-city-painting.vaen.space",
      projectName: "flower-city-painting",
      projectId: "prj_123",
      deploymentId: "dpl_123",
      createdProjectDomain: true,
      teamId: "team_123",
    });

    delete process.env.DNS_PROVIDER_TOKEN;
    delete process.env.VAEN_BASE_DOMAIN;
    delete process.env.VERCEL_TEAM_ID;
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
    expect(source).toContain("GitHub Provider — STATUS: REAL REPO PUSH IMPLEMENTED");
    expect(source).toContain("Vercel Provider — STATUS: REAL PREVIEW DEPLOYMENT IMPLEMENTED");
    expect(source).toContain("Domain Provider — STATUS: REAL MANAGED SUBDOMAIN ATTACHMENT IMPLEMENTED");
    expect(source).toContain("repository URL");
    expect(source).toContain("preview deployment URL");
    expect(source).toContain("managed subdomain");
    expect(source).toContain("Vercel domain-management access");
    expect(source).toContain("not a generic registrar-token abstraction yet");
  });
});
