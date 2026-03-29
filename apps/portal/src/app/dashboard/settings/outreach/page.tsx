import Link from "next/link";
import { getOutreachConfigReadiness } from "@/lib/outreach-config";

export default async function OutreachSettingsPage() {
  const readiness = getOutreachConfigReadiness();

  return (
    <div className="section" data-testid="outreach-settings-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Outreach Readiness</h1>
          <p className="text-sm text-muted">
            This page checks the configuration required for operator-controlled Resend outreach. Missing values will block sends before they reach the provider.
          </p>
        </div>
        <span className="badge" data-testid="outreach-readiness-badge">
          {readiness.ready ? "ready" : "blocked"}
        </span>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="text-sm text-muted">
          Future quote and project workflow behavior is unchanged. This surface exists so operators can see exactly why outreach is send-ready or blocked.
        </p>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Configuration Checks</h2>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {Object.entries(readiness.checks).map(([key, check]) => (
            <div
              key={key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.75rem",
                alignItems: "baseline",
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>{check.env}</strong>
                <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                  {check.message}
                </p>
              </div>
              <span className="badge">{check.ok ? "configured" : "missing"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Resolved Values</h2>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <div><strong>From email:</strong> {readiness.values.fromEmail ?? "Not configured"}</div>
          <div><strong>Portal URL:</strong> {readiness.values.portalUrl ?? "Not configured"}</div>
        </div>
      </div>

      {!readiness.ready && (
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Why Sending Is Blocked</h2>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {readiness.issues.map((issue) => (
              <p key={issue} className="text-sm" style={{ color: "var(--color-warning)" }}>
                {issue}
              </p>
            ))}
          </div>
          <p className="text-sm text-muted" style={{ marginTop: "0.75rem" }}>
            Update your portal environment and restart the app. The required variables are documented in <code>apps/portal/.env.example</code> and the repo README.
          </p>
          <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>
            Prospect-level send readiness is also visible directly on each prospect detail page.
          </p>
        </div>
      )}

      <div className="card" style={{ marginTop: "1rem" }}>
        <Link href="/dashboard/prospects" className="text-sm text-muted">
          Review prospects and send readiness
        </Link>
      </div>
    </div>
  );
}
