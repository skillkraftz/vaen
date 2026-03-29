"use client";

import Link from "next/link";
import type { AnalyticsData } from "@/lib/analytics";

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card" style={{ padding: "0.75rem", textAlign: "center" }}>
      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{value}</div>
      <div className="text-sm text-muted">{label}</div>
      {sub && <div className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    sent: "badge-green",
    replied: "badge-blue",
    failed: "badge-red",
    blocked: "badge-red",
    pending: "badge-yellow",
    active: "badge-green",
    paused: "badge-yellow",
    draft: "",
    completed: "badge-blue",
    archived: "",
  };
  return (
    <span className={`badge ${colorMap[status] ?? ""}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  const { funnel, sends, campaignRollups, followUpsDue, quotePipeline } = data;

  return (
    <div className="section" data-testid="analytics-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Analytics</h1>
          <p className="text-sm text-muted">
            Outbound pipeline visibility across prospects, campaigns, and sends.
          </p>
        </div>
      </div>

      {/* ── Send Metrics Summary ───────────────────────────── */}
      <div
        className="card"
        style={{ marginBottom: "1rem", padding: "0.75rem" }}
        data-testid="analytics-send-metrics"
      >
        <strong style={{ fontSize: "0.85rem" }}>Send Metrics</strong>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            marginTop: "0.5rem",
            fontSize: "0.85rem",
          }}
        >
          <span>Total: <strong>{sends.total}</strong></span>
          <span>Sent: <strong>{sends.sent}</strong></span>
          <span>Pending: <strong>{sends.pending}</strong></span>
          <span style={{ color: sends.failed > 0 ? "var(--color-error)" : undefined }}>
            Failed: <strong>{sends.failed}</strong>
          </span>
          <span style={{ color: sends.blocked > 0 ? "var(--color-error)" : undefined }}>
            Blocked: <strong>{sends.blocked}</strong>
          </span>
        </div>
      </div>

      {/* ── Funnel Metrics ─────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gap: "0.75rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          marginBottom: "1rem",
        }}
        data-testid="analytics-funnel-metrics"
      >
        <MetricCard label="Total Prospects" value={funnel.totalProspects} />
        <MetricCard label="In Campaigns" value={funnel.assignedToCampaign} />
        <MetricCard label="Packages Ready" value={funnel.withOutreachPackageReady} />
        <MetricCard label="Sent Outreach" value={funnel.withSentOutreach} />
        <MetricCard label="Replied" value={funnel.replied} />
        <MetricCard label="Follow-ups Due" value={funnel.followUpsDueNow} sub={`${funnel.followUpsOverdue} overdue`} />
        <MetricCard label="Paused" value={funnel.pausedInSequence} />
        <MetricCard
          label="Converted"
          value={funnel.convertedToClient}
          sub={`${funnel.convertedToProject} projects`}
        />
      </div>

      {/* ── Prospect Status Breakdown ──────────────────────── */}
      <div className="two-col-grid" style={{ marginBottom: "1rem" }}>
        <div className="card" style={{ padding: "0.75rem" }} data-testid="analytics-prospect-status">
          <strong style={{ fontSize: "0.85rem" }}>Prospects by Status</strong>
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {Object.entries(funnel.prospectsByStatus).map(([status, count]) => (
              <div key={status} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                <span>{status.replaceAll("_", " ")}</span>
                <strong>{count}</strong>
              </div>
            ))}
            {Object.keys(funnel.prospectsByStatus).length === 0 && (
              <p className="text-sm text-muted">No prospects yet.</p>
            )}
          </div>
        </div>
        <div className="card" style={{ padding: "0.75rem" }} data-testid="analytics-outreach-status">
          <strong style={{ fontSize: "0.85rem" }}>Prospects by Outreach Status</strong>
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {Object.entries(funnel.prospectsByOutreachStatus).map(([status, count]) => (
              <div key={status} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                <span>{status.replaceAll("_", " ")}</span>
                <strong>{count}</strong>
              </div>
            ))}
            {Object.keys(funnel.prospectsByOutreachStatus).length === 0 && (
              <p className="text-sm text-muted">No outreach statuses yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Quote Pipeline ─────────────────────────────────── */}
      {quotePipeline.totalQuotes > 0 ? (
        <div
          className="card"
          style={{ marginBottom: "1rem", padding: "0.75rem" }}
          data-testid="analytics-quote-pipeline"
        >
          <strong style={{ fontSize: "0.85rem" }}>Quote Pipeline</strong>
          <div
            style={{
              display: "flex",
              gap: "1.5rem",
              flexWrap: "wrap",
              marginTop: "0.5rem",
              fontSize: "0.85rem",
            }}
          >
            <span>Total Quotes: <strong>{quotePipeline.totalQuotes}</strong></span>
            <span>Open Pipeline: <strong>{formatCents(quotePipeline.pipelineSetupCents)}</strong> setup</span>
            <span>
              Accepted: <strong>{formatCents(quotePipeline.acceptedSetupCents)}</strong> setup
              {quotePipeline.acceptedRecurringCents > 0 && (
                <> + <strong>{formatCents(quotePipeline.acceptedRecurringCents)}</strong>/mo</>
              )}
            </span>
          </div>
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {Object.entries(quotePipeline.quotesByStatus).map(([status, count]) => (
              <span key={status} className="text-sm text-muted">
                {status}: {count}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="card"
          style={{ marginBottom: "1rem", padding: "0.75rem" }}
          data-testid="analytics-quote-pipeline-empty"
        >
          <strong style={{ fontSize: "0.85rem" }}>Quote Pipeline</strong>
          <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
            No quotes have been created yet.
          </p>
        </div>
      )}

      {/* ── Campaign Rollups ───────────────────────────────── */}
      <div className="card" style={{ marginBottom: "1rem", padding: "0.75rem" }} data-testid="analytics-campaign-rollups">
        <strong style={{ fontSize: "0.85rem" }}>Campaign Rollups</strong>
        {campaignRollups.length === 0 ? (
          <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>No campaigns with prospects.</p>
        ) : (
          <div style={{ marginTop: "0.5rem", overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Campaign</th>
                  <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Prospects</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Sent</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Replied</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Follow-up</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Paused</th>
                  <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Converted</th>
                </tr>
              </thead>
              <tbody>
                {campaignRollups.map((r) => (
                  <tr key={r.campaignId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "0.35rem 0.5rem" }}>
                      <Link href={`/dashboard/campaigns/${r.campaignId}`} className="text-link">
                        {r.campaignName}
                      </Link>
                    </td>
                    <td style={{ padding: "0.35rem 0.5rem" }}>
                      <StatusBadge status={r.campaignStatus} />
                    </td>
                    <td style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>{r.totalProspects}</td>
                    <td style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>{r.sent}</td>
                    <td style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>{r.replied}</td>
                    <td style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>
                      {r.followUpDue > 0 ? (
                        <strong style={{ color: "var(--color-warning, #e68a00)" }}>{r.followUpDue}</strong>
                      ) : (
                        r.followUpDue
                      )}
                    </td>
                    <td style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>{r.paused}</td>
                    <td style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>{r.converted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Follow-ups Due Panel ───────────────────────────── */}
      <div className="card" style={{ padding: "0.75rem" }} data-testid="analytics-followups-due">
        <strong style={{ fontSize: "0.85rem" }}>Follow-ups Due</strong>
        {followUpsDue.length === 0 ? (
          <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>No follow-ups due.</p>
        ) : (
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {followUpsDue.map((item) => (
              <div
                key={item.prospectId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                  padding: "0.35rem 0",
                  borderBottom: "1px solid var(--color-border)",
                  fontSize: "0.85rem",
                }}
              >
                <div>
                  <Link href={`/dashboard/prospects/${item.prospectId}`} className="text-link">
                    {item.companyName}
                  </Link>
                  {item.campaignName && (
                    <span className="text-sm text-muted" style={{ marginLeft: "0.5rem" }}>
                      in{" "}
                      <Link href={`/dashboard/campaigns/${item.campaignId}`} className="text-link">
                        {item.campaignName}
                      </Link>
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  {item.outreachStatus && <StatusBadge status={item.outreachStatus} />}
                  <span
                    className="text-sm"
                    style={{ color: item.overdue ? "var(--color-error)" : "var(--color-warning, #e68a00)" }}
                  >
                    {item.overdue ? "Overdue" : "Due"}{" "}
                    {new Date(item.nextFollowUpDueAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Campaigns count footer ─────────────────────────── */}
      <p className="text-sm text-muted" style={{ marginTop: "0.75rem" }}>
        {funnel.campaignsCount} total campaign{funnel.campaignsCount !== 1 ? "s" : ""} ·{" "}
        <Link href="/dashboard/campaigns" className="text-link">
          View all campaigns
        </Link>
      </p>
    </div>
  );
}
