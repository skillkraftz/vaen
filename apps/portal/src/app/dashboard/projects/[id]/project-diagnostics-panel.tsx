"use client";

import { useState } from "react";
import { getProjectDiagnosticsAction } from "./actions";
import type { ProjectDiagnostics } from "./project-diagnostics-types";
import type { JobRecord } from "@/lib/types";
import { JobStatusBadge } from "./project-workflow-job-status";

export function DiagnosticsPanel({ projectId, slug }: { projectId: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState<ProjectDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!open) {
      setOpen(true);
      setLoading(true);
      const result = await getProjectDiagnosticsAction(projectId, slug);
      setDiag(result);
      setLoading(false);
    } else {
      setOpen(false);
    }
  }

  async function refresh() {
    setLoading(true);
    const result = await getProjectDiagnosticsAction(projectId, slug);
    setDiag(result);
    setLoading(false);
  }

  return (
    <div data-testid="diagnostics-panel" style={{ borderBottom: "1px solid var(--color-border)" }}>
      <div
        data-testid="diagnostics-toggle"
        style={{
          padding: "0.75rem 1.25rem",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
        onClick={load}
      >
        <span
          className="text-sm"
          style={{
            color: "var(--color-text-muted)",
            fontWeight: 500,
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Diagnostics {open ? "▾" : "▸"}
        </span>
        {open && (
          <button
            className="btn btn-sm"
            style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}
            onClick={(e) => {
              e.stopPropagation();
              refresh();
            }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        )}
      </div>

      {open && diag && (
        <div
          style={{
            padding: "0 1.25rem 1rem",
            fontSize: "0.8rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          <DiagSection title="Request Source">
            <p
              className="text-sm"
              style={{
                fontWeight: 600,
                color:
                  diag.requestSource === "final"
                    ? "#065f46"
                    : diag.requestSource === "draft"
                      ? "#92400e"
                      : "#b71c1c",
              }}
            >
              {diag.requestSource === "final" && "Using: Final (AI-improved) request"}
              {diag.requestSource === "draft" && "Using: Draft request"}
              {diag.requestSource === "none" && "No request available"}
            </p>
            {diag.hasFinalRequest && (
              <p className="text-sm" style={{ color: "#065f46" }}>
                [ok] Final request imported
              </p>
            )}
          </DiagSection>

          <DiagSection title="Draft Request">
            <DiagRow label="Exists" ok={diag.draft.exists} />
            <DiagRow label="version" ok={diag.draft.hasVersion} />
            <DiagRow label="business" ok={diag.draft.hasBusiness} />
            <DiagRow label="contact" ok={diag.draft.hasContact} />
            <DiagRow label={`services (${diag.draft.servicesCount})`} ok={diag.draft.hasServices} />
            <p className="text-mono" style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
              Keys: {diag.draft.topLevelKeys.join(", ") || "none"}
            </p>
          </DiagSection>

          <DiagSection title="Files on Disk">
            <DiagRow label="client-request.json (exported)" ok={diag.files.hasExportedRequest} />
            <DiagRow label="prompt.txt" ok={diag.files.hasPromptTxt} />
            <DiagRow label="Generated workspace" ok={diag.files.hasWorkspace} />
            <DiagRow label="Site build (.next)" ok={diag.files.hasBuild} />
            <DiagRow label={`Screenshots (${diag.files.screenshotCount})`} ok={diag.files.hasScreenshots} />
            {diag.screenshotsStale && diag.files.hasScreenshots && (
              <p className="text-sm" style={{ color: "#b45309", fontWeight: 500 }}>
                Screenshots are STALE — site was regenerated after last review
              </p>
            )}
          </DiagSection>

          <DiagSection title="Last Jobs">
            {diag.jobs.lastGenerate ? (
              <p className="text-sm">
                Generate: <JobStatusBadge status={diag.jobs.lastGenerate.status as JobRecord["status"]} />
                <span className="text-mono" style={{ fontSize: "0.65rem", marginLeft: "0.35rem" }}>
                  {diag.jobs.lastGenerate.id.slice(0, 8)}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted">No generate jobs</p>
            )}
            {diag.jobs.lastReview ? (
              <p className="text-sm">
                Review: <JobStatusBadge status={diag.jobs.lastReview.status as JobRecord["status"]} />
                <span className="text-mono" style={{ fontSize: "0.65rem", marginLeft: "0.35rem" }}>
                  {diag.jobs.lastReview.id.slice(0, 8)}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted">No review jobs</p>
            )}
          </DiagSection>

          <DiagSection title="Timestamps">
            <p className="text-sm">
              Last processed: {diag.timestamps.lastProcessedAt ? new Date(diag.timestamps.lastProcessedAt).toLocaleString() : "never"}
            </p>
            <p className="text-sm">
              Last exported: {diag.timestamps.lastExportedAt ? new Date(diag.timestamps.lastExportedAt).toLocaleString() : "never"}
            </p>
            <p className="text-sm">
              Last generated: {diag.timestamps.lastGeneratedAt ? new Date(diag.timestamps.lastGeneratedAt).toLocaleString() : "never"}
            </p>
            <p className="text-sm">
              Last reviewed: {diag.timestamps.lastReviewedAt ? new Date(diag.timestamps.lastReviewedAt).toLocaleString() : "never"}
            </p>
          </DiagSection>

          {diag.revisions && (
            <DiagSection title={`Revisions (${diag.revisions.count})`}>
              <p className="text-sm">Current source: {diag.revisions.currentSource ?? "none"}</p>
              <DiagRow label="Export up-to-date" ok={!diag.revisions.exportStale} />
              <DiagRow label="Generation up-to-date" ok={!diag.revisions.generateStale} />
              <DiagRow label="Review up-to-date" ok={!diag.revisions.reviewStale} />
            </DiagSection>
          )}

          <DiagSection title={`Live Missing Info (${diag.liveMissingInfo.length})`}>
            {diag.liveMissingInfo.length === 0 ? (
              <p className="text-sm text-muted">All clear</p>
            ) : (
              diag.liveMissingInfo.map((item, index) => (
                <p key={index} className="text-sm">
                  <span
                    style={{
                      color:
                        item.severity === "required"
                          ? "var(--color-error)"
                          : item.severity === "recommended"
                            ? "#b45309"
                            : "var(--color-text-muted)",
                      fontWeight: 500,
                    }}
                  >
                    [{item.severity}]
                  </span>{" "}
                  {item.label}
                  {item.hint && <span className="text-muted"> — {item.hint}</span>}
                </p>
              ))
            )}
          </DiagSection>
        </div>
      )}

      {open && loading && !diag && (
        <div style={{ padding: "0 1.25rem 1rem" }}>
          <span className="text-sm text-muted">Loading diagnostics...</span>
        </div>
      )}
    </div>
  );
}

function DiagSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: "0.75rem", marginBottom: "0.25rem" }}>{title}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", paddingLeft: "0.5rem" }}>
        {children}
      </div>
    </div>
  );
}

function DiagRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <p className="text-sm" style={{ color: ok ? "var(--color-success)" : "var(--color-text-muted)" }}>
      {ok ? "[ok]" : "[--]"} {label}
    </p>
  );
}
