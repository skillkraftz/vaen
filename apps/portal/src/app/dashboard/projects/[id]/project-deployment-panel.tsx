"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeploymentRun, Project } from "@/lib/types";
import { createDeploymentRunAction, executeDeploymentProvidersAction } from "./actions";
import { summarizeDeploymentPayloadMetadata, summarizeProviderExecutionFromRun } from "@/lib/deployment-control-plane";

function formatDate(iso: string | null) {
  if (!iso) return "Not started";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadge(status: DeploymentRun["status"]) {
  switch (status) {
    case "validated":
      return "badge-green";
    case "failed":
      return "badge-red";
    case "running":
      return "badge-yellow";
    default:
      return "badge-blue";
  }
}

export function DeploymentRunsSection({
  projectId,
  project,
  deploymentRuns,
}: {
  projectId: string;
  project: Pick<
    Project,
    "current_revision_id" | "last_exported_revision_id" | "last_generated_revision_id"
  >;
  deploymentRuns: DeploymentRun[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const revisionReady = Boolean(project.current_revision_id);
  const exportReady = project.last_exported_revision_id === project.current_revision_id;
  const buildReady = project.last_generated_revision_id === project.current_revision_id;
  const latestRun = deploymentRuns[0] ?? null;

  function createRun() {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await createDeploymentRunAction(projectId);
      if (result.error) {
        setError(result.error);
        return;
      }

      setNotice(
        result.deploymentRunId
          ? `Deployment run queued (${result.deploymentRunId.slice(0, 8)}).`
          : "Deployment run queued.",
      );
      router.refresh();
    });
  }

  function executeProviders(runId: string) {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await executeDeploymentProvidersAction(projectId, runId);
      if (result.error) {
        setError(result.error);
        return;
      }

      setNotice(result.jobId ? `Provider execution queued (${result.jobId.slice(0, 8)}).` : "Provider execution queued.");
      router.refresh();
    });
  }

  return (
    <div className="section">
      <div className="card" data-testid="deployment-runs-section">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div className="wrap-between" style={{ gap: "0.75rem" }}>
            <div>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                Deployment Control
              </h2>
              <p className="text-sm text-muted">
                Creates a tracked deployment run from the authoritative revision/export state and validates the generated deployment payload.
                Provider automation remains a separate future layer.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={isPending}
              onClick={createRun}
              data-testid="create-deployment-run"
            >
              {isPending ? "Queueing..." : "Prepare Deployment"}
            </button>
          </div>

          <div className="detail-grid">
            <div data-testid="deployment-run-revision-state">
              <strong>Active revision:</strong> {revisionReady ? "ready" : "missing"}
            </div>
            <div data-testid="deployment-run-export-state">
              <strong>Exported:</strong> {exportReady ? "current" : "outdated"}
            </div>
            <div data-testid="deployment-run-build-state">
              <strong>Generated site:</strong> {buildReady ? "current" : "outdated"}
            </div>
          </div>

          {notice && (
            <p className="text-sm" style={{ color: "var(--color-success)" }}>
              {notice}
            </p>
          )}

          {error && (
            <p className="text-sm" style={{ color: "var(--color-error)" }}>
              {error}
            </p>
          )}

          {latestRun && (
            <div
              className="card"
              style={{ padding: "0.75rem", background: "var(--color-surface-subtle)" }}
              data-testid="deployment-run-latest"
            >
              <div className="wrap-between" style={{ gap: "0.75rem" }}>
                <div>
                  <strong>Latest attempt</strong>
                  <p className="text-sm text-muted" style={{ marginTop: "0.2rem" }}>
                    Started {formatDate(latestRun.started_at ?? latestRun.created_at)}
                  </p>
                </div>
                <span className={`badge ${statusBadge(latestRun.status)}`}>
                  {latestRun.status}
                </span>
              </div>
            </div>
          )}

          {deploymentRuns.length === 0 ? (
            <p className="text-sm text-muted">
              No deployment runs yet. This control plane only prepares and validates deployment metadata today.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {deploymentRuns.map((run) => (
                <div
                  key={run.id}
                  className="card"
                  style={{ padding: "0.75rem" }}
                  data-testid={`deployment-run-${run.id}`}
                >
                  <div className="wrap-between" style={{ gap: "0.75rem", marginBottom: "0.5rem" }}>
                    <div>
                      <strong>Run {run.id.slice(0, 8)}</strong>
                      <p className="text-sm text-muted" style={{ marginTop: "0.2rem" }}>
                        Trigger: {run.trigger_source} · Provider: {run.provider ?? "pending"}
                      </p>
                    </div>
                    <span className={`badge ${statusBadge(run.status)}`}>
                      {run.status}
                    </span>
                  </div>

                  <div className="detail-grid">
                    <div><strong>Job:</strong> {run.job_id ? run.job_id.slice(0, 8) : "None"}</div>
                    <div><strong>Revision:</strong> {run.revision_id ? run.revision_id.slice(0, 8) : "None"}</div>
                    <div><strong>Started:</strong> {formatDate(run.started_at ?? run.created_at)}</div>
                    <div><strong>Completed:</strong> {formatDate(run.completed_at)}</div>
                  </div>

                  {run.status === "validated" && (
                    <div style={{ marginTop: "0.75rem" }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={isPending}
                        onClick={() => executeProviders(run.id)}
                        data-testid={`execute-deployment-providers-${run.id}`}
                      >
                        {isPending ? "Queueing..." : "Execute Providers"}
                      </button>
                    </div>
                  )}

                  {summarizeDeploymentPayloadMetadata(run.payload_metadata) && (
                    <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
                      Payload: {summarizeDeploymentPayloadMetadata(run.payload_metadata)}
                    </p>
                  )}

                  {run.log_summary && (
                    <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
                      {run.log_summary}
                    </p>
                  )}

                  {run.error_summary && (
                    <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.5rem" }}>
                      {run.error_summary}
                    </p>
                  )}

                  {summarizeProviderExecutionFromRun(run) && (
                    <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }} data-testid={`deployment-run-provider-summary-${run.id}`}>
                      Providers: {summarizeProviderExecutionFromRun(run)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
