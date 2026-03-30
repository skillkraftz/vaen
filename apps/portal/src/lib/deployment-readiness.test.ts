import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDeploymentReadiness } from "./deployment-readiness";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("deployment readiness helpers", () => {
  it("returns ready when core production envs are configured", () => {
    const readiness = getDeploymentReadiness({
      NEXT_PUBLIC_PORTAL_URL: "https://vaen.space",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      RESEND_WEBHOOK_SECRET: "whsec_test",
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.checks.portalUrl.ok).toBe(true);
    expect(readiness.checks.portalHost.ok).toBe(true);
    expect(readiness.checks.authCallback.ok).toBe(true);
    expect(readiness.checks.resendWebhook.ok).toBe(true);
    expect(readiness.values.authCallbackUrl).toBe("https://vaen.space/auth/callback");
    expect(readiness.values.resendWebhookUrl).toBe("https://vaen.space/api/webhooks/resend");
  });

  it("reports blockers and warnings separately", () => {
    const readiness = getDeploymentReadiness({
      NEXT_PUBLIC_PORTAL_URL: "https://staging.example.com",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((issue) => issue.includes("NEXT_PUBLIC_SUPABASE_URL"))).toBe(true);
    expect(readiness.blockers.some((issue) => issue.includes("SUPABASE_SERVICE_ROLE_KEY"))).toBe(true);
    expect(readiness.warnings.some((warning) => warning.includes("production should use vaen.space"))).toBe(true);
    expect(readiness.warnings.some((warning) => warning.includes("RESEND_WEBHOOK_SECRET"))).toBe(true);
  });

  it("documents deployment env and webhook expectations in the portal env example", () => {
    const envExample = readFileSync(join(REPO_ROOT, "apps/portal/.env.example"), "utf-8");
    expect(envExample).toContain("NEXT_PUBLIC_PORTAL_URL");
    expect(envExample).toContain("https://vaen.space/api/webhooks/resend");
    expect(envExample).toContain("RESEND_WEBHOOK_SECRET");
  });

  it("documents the worker vm runbook with real setup steps", () => {
    const runbookPath = join(REPO_ROOT, "docs/architecture/worker-vm-runbook.md");
    const tomorrowPackPath = join(REPO_ROOT, "docs/architecture/hosted-testing-pack.md");
    const runbook = readFileSync(runbookPath, "utf-8");
    const tomorrowPack = readFileSync(tomorrowPackPath, "utf-8");

    expect(runbook).toContain("SUPABASE_URL");
    expect(runbook).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(runbook).toContain("WORKER_ID");
    expect(runbook).toContain("OPENAI_API_KEY");
    expect(runbook).toContain("required only for generator-backed jobs");
    expect(runbook).toContain("DNS_PROVIDER_TOKEN");
    expect(runbook).toContain("Vercel domain-management token");
    expect(runbook).toContain("pnpm --filter @vaen/worker poll");
    expect(runbook).toContain("systemd");
    expect(runbook).toContain("pm2");
    expect(runbook).toContain("/dashboard/settings/deployment");
    expect(tomorrowPack).toContain("Tomorrow Setup Order");
    expect(tomorrowPack).toContain("Preflight Commands");
    expect(tomorrowPack).toContain("Failure Matrix");
    expect(tomorrowPack).toContain("PORTAL_SMOKE_PROJECT_ID");
    expect(tomorrowPack).toContain("Worker heartbeat is missing");
    expect(tomorrowPack).toContain("Vercel project already linked to the wrong repo");
    expect(tomorrowPack).toContain("Resend webhook verification fails");
  });

  it("keeps the shared deployment readiness helper bundle-safe", () => {
    const helperPath = join(__dirname, "deployment-readiness.ts");
    const serverHelperPath = join(__dirname, "deployment-readiness-server.ts");
    const helperSource = readFileSync(helperPath, "utf-8");
    const serverHelperSource = readFileSync(serverHelperPath, "utf-8");

    expect(helperSource).not.toContain('from "node:fs"');
    expect(helperSource).not.toContain('from "node:path"');
    expect(helperSource).not.toContain("import.meta.url");
    expect(serverHelperSource).toContain('import "server-only"');
    expect(serverHelperSource).toContain("hasDeploymentPayloadSupport");
  });
});

describe("deployment readiness ui integration", () => {
  it("adds a deployment settings page and nav link", () => {
    const pagePath = join(__dirname, "../app/dashboard/settings/deployment/page.tsx");
    const layoutPath = join(__dirname, "../app/dashboard/layout.tsx");
    const readmePath = join(REPO_ROOT, "apps/portal/README.md");
    const workerReadmePath = join(REPO_ROOT, "apps/worker/README.md");
    const rootReadmePath = join(REPO_ROOT, "README.md");
    const pageSource = readFileSync(pagePath, "utf-8");
    const layoutSource = readFileSync(layoutPath, "utf-8");
    const readmeSource = readFileSync(readmePath, "utf-8");
    const workerReadmeSource = readFileSync(workerReadmePath, "utf-8");
    const rootReadmeSource = readFileSync(rootReadmePath, "utf-8");

    expect(pageSource).toContain('data-testid="deployment-settings-page"');
    expect(pageSource).toContain('data-testid="deployment-readiness-badge"');
    expect(pageSource).toContain('data-testid="deployment-blockers"');
    expect(pageSource).toContain('data-testid="deployment-warnings"');
    expect(pageSource).toContain('testId="deployment-worker-health"');
    expect(pageSource).toContain('data-testid="deployment-hosted-testing-checklist"');
    expect(pageSource).toContain('data-testid="deployment-tomorrow-pack"');
    expect(pageSource).toContain('data-testid="deployment-env-ownership"');
    expect(pageSource).toContain('data-testid="deployment-worker-vm-checklist"');
    expect(pageSource).toContain("Hosted testing checklist");
    expect(pageSource).toContain("Configure the Supabase auth callback as");
    expect(pageSource).toContain("https://vaen.space/api/webhooks/resend");
    expect(pageSource).toContain("verify the GitHub repo URL, Vercel preview URL, and managed subdomain URL");
    expect(pageSource).toContain("Portal env vars live on Vercel");
    expect(pageSource).toContain("Worker and provider env vars live on the remote worker VM");
    expect(pageSource).toContain("DNS_PROVIDER_TOKEN");
    expect(pageSource).toContain("not generic registrar automation yet");
    expect(pageSource).toContain("OPENAI_API_KEY");
    expect(pageSource).toContain("generator-backed jobs");
    expect(pageSource).toContain("Worker VM checklist");
    expect(pageSource).toContain("Tomorrow setup pack");
    expect(pageSource).toContain("hosted-testing-pack.md");
    expect(pageSource).toContain("docs/architecture/worker-vm-runbook.md");
    expect(pageSource).toContain("pnpm --filter @vaen/worker poll");
    expect(pageSource).toContain("active revision request payload");
    expect(pageSource).toContain("Worker heartbeat");
    expect(layoutSource).toContain("/dashboard/settings/deployment");
    expect(layoutSource).toContain("Deployment");
    expect(readmeSource).toContain("/dashboard/settings/deployment");
    expect(readmeSource).toContain("worker-vm-runbook.md");
    expect(rootReadmeSource).toContain("hosted-testing-pack.md");
    expect(workerReadmeSource).toContain("managed subdomain attachment");
    expect(workerReadmeSource).toContain("OPENAI_API_KEY");
    expect(workerReadmeSource).toContain("customer custom-domain onboarding");
    expect(rootReadmeSource).toContain("https://vaen.space/auth/callback");
    expect(rootReadmeSource).toContain("https://vaen.space/api/webhooks/resend");
    expect(rootReadmeSource).toContain("worker-vm-runbook.md");
    expect(rootReadmeSource).toContain("Vercel is implemented enough to create or reuse a project");
    expect(rootReadmeSource).toContain("Vercel domain-management token");
    expect(rootReadmeSource).toContain("OPENAI_API_KEY");
  });
});
