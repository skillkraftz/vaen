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
            It does not trigger deployments itself. Project pages can now create tracked deployment runs, while provider automation remains a separate future layer.
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
            and a real Resend webhook route. What is still missing is provider automation for GitHub, Vercel, domains,
            and richer worker/deployment orchestration.
          </p>
          <Link href="/dashboard/settings/outreach" className="text-sm text-muted">
            Review outreach/webhook readiness
          </Link>
        </div>
      </div>
    </div>
  );
}
