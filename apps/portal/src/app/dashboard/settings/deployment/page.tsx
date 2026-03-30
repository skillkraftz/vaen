import Link from "next/link";
import { getServerDeploymentReadiness } from "@/lib/deployment-readiness-server";
import { createClient } from "@/lib/supabase/server";
import { loadLatestWorkerHeartbeat } from "@/lib/worker-heartbeats-server";
import { WorkerHealthCard } from "@/app/dashboard/worker-health-card";

export default async function DeploymentSettingsPage() {
  const supabase = await createClient();
  const readiness = getServerDeploymentReadiness();
  const workerSnapshot = await loadLatestWorkerHeartbeat(supabase);

  return (
    <div className="section" data-testid="deployment-settings-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Deployment Readiness</h1>
          <p className="text-sm text-muted">
            This surface documents the runtime assumptions for hosting the portal on <strong>vaen.space</strong>.
            It does not trigger deployments itself. Use it to verify the hosted-testing path: deploy the portal to Vercel,
            confirm auth and webhook URLs, confirm the remote worker heartbeat, then use project pages to create deployment runs and execute providers.
          </p>
        </div>
        <span className="badge" data-testid="deployment-readiness-badge">
          {readiness.ready ? "ready" : "blocked"}
        </span>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="text-sm text-muted">
          Generation and future deployment rely on the active revision request payload, not just visible form state.
          Before release work, verify Business Details and Request Data (JSON) are in sync on the project page so
          downstream export and deployment-payload generation use authoritative data.
        </p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <WorkerHealthCard
          heartbeat={workerSnapshot.heartbeat}
          currentJob={workerSnapshot.currentJob}
          title="Worker heartbeat"
          testId="deployment-worker-health"
        />
      </div>

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="deployment-hosted-testing-checklist">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Hosted testing checklist</h2>
        <div className="detail-grid">
          <ul className="text-sm text-muted" style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li>Deploy <code>apps/portal</code> to Vercel with <code>NEXT_PUBLIC_PORTAL_URL=https://vaen.space</code>.</li>
            <li>Configure the Supabase auth callback as <code>https://vaen.space/auth/callback</code>.</li>
            <li>Set the Resend webhook target to <code>https://vaen.space/api/webhooks/resend</code> if live outreach/webhook testing is in scope.</li>
            <li>Confirm this page shows a healthy worker heartbeat before trusting pending jobs.</li>
            <li>Create a deployment run from a project whose active revision is already exported and generated.</li>
            <li>Execute providers, then verify the GitHub repo URL, Vercel preview URL, and managed subdomain URL on the project deployment history when domain testing is configured.</li>
          </ul>
          <p className="text-sm text-muted" data-testid="deployment-hosted-smoke-command">
            Repeat this with the lightweight hosted smoke audit:
            {" "}
            <code>pnpm --filter @vaen/portal smoke:hosted</code>
            {" "}
            after setting <code>PORTAL_URL</code>, <code>PORTAL_EMAIL</code>, <code>PORTAL_PASSWORD</code>, and <code>PORTAL_SMOKE_PROJECT_ID</code>.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="deployment-env-ownership">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Environment ownership</h2>
        <div className="detail-grid">
          <p className="text-sm text-muted">
            Portal env vars live on Vercel. Worker and provider env vars live on the remote worker VM. A ready portal build
            alone is not enough for generation, review, or provider execution.
          </p>
          <p className="text-sm text-muted">
            GitHub and Vercel provider execution depend on worker-side credentials. The current domain provider also runs on the
            worker and uses <code>DNS_PROVIDER_TOKEN</code> for Vercel domain and alias API calls under <code>VAEN_BASE_DOMAIN</code>;
            it is not generic registrar automation yet.
          </p>
          <p className="text-sm text-muted">
            <code>OPENAI_API_KEY</code> is required for generator-backed jobs. If tomorrow&apos;s testing is limited to review,
            deployment run creation, and provider execution on an already generated project, missing OpenAI credentials will not
            block those deployment-only steps.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="deployment-worker-vm-checklist">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Worker VM checklist</h2>
        <div className="detail-grid">
          <p className="text-sm text-muted">
            For real remote testing, run the worker poller on a separate VM with a writable repo checkout and
            Playwright Chromium installed. The detailed runbook lives in <code>docs/architecture/worker-vm-runbook.md</code>.
          </p>
          <ul className="text-sm text-muted" style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li>Set <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>WORKER_ID</code>, and <code>NEXT_PUBLIC_PORTAL_URL=https://vaen.space</code>.</li>
            <li>Add <code>OPENAI_API_KEY</code> only if the worker must run generator-backed jobs.</li>
            <li>Build the repo and install Chromium with <code>pnpm --filter @vaen/review-tools exec playwright install --with-deps chromium</code>.</li>
            <li>Run <code>pnpm --filter @vaen/worker poll</code> under <code>systemd</code> or <code>pm2</code>.</li>
            <li>Confirm this page shows a healthy worker heartbeat before trusting pending jobs.</li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Checks</h2>
        <div className="detail-grid">
          {Object.entries(readiness.checks).map(([key, check]) => (
            <div
              key={key}
              className="wrap-between"
              style={{ paddingBottom: "0.75rem", borderBottom: "1px solid var(--color-border)" }}
            >
              <div style={{ minWidth: 0 }}>
                <strong>{check.label}</strong>
                <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                  {check.message}
                </p>
              </div>
              <span className={`badge ${check.ok ? "badge-green" : check.level === "required" ? "badge-red" : "badge-yellow"}`}>
                {check.ok ? "ok" : check.level}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Derived URLs</h2>
        <div className="detail-grid">
          <div><strong>Portal base URL:</strong> {readiness.values.portalUrl ?? "Not configured"}</div>
          <div><strong>Expected production host:</strong> {readiness.values.expectedProductionHost}</div>
          <div><strong>Auth callback:</strong> {readiness.values.authCallbackUrl ?? "Unavailable until base URL is configured"}</div>
          <div><strong>Resend webhook:</strong> {readiness.values.resendWebhookUrl ?? "Unavailable until base URL is configured"}</div>
        </div>
      </div>

      {readiness.blockers.length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }} data-testid="deployment-blockers">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Blocking Issues</h2>
          <div className="detail-grid">
            {readiness.blockers.map((issue) => (
              <p key={issue} className="text-sm" style={{ color: "var(--color-error)" }}>
                {issue}
              </p>
            ))}
          </div>
        </div>
      )}

      {readiness.warnings.length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }} data-testid="deployment-warnings">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Warnings</h2>
          <div className="detail-grid">
            {readiness.warnings.map((warning) => (
              <p key={warning} className="text-sm" style={{ color: "var(--color-warning)" }}>
                {warning}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>What Exists Already</h2>
        <div className="detail-grid">
          <p className="text-sm text-muted">
            The repo already contains deployment-payload schema/generator support, deploy statuses in the workflow model,
            and a real Resend webhook route. GitHub, Vercel, and managed-subdomain provider execution are now wired for hosted testing.
            What is still missing is customer custom-domain onboarding, production promotion flow, and richer worker/deployment orchestration.
          </p>
          <p className="text-sm text-muted">
            For a real worker VM setup, use the repo runbook at <code>docs/architecture/worker-vm-runbook.md</code>.
          </p>
          <Link href="/dashboard/settings/outreach" className="text-sm text-muted">
            Review outreach/webhook readiness
          </Link>
        </div>
      </div>
    </div>
  );
}
