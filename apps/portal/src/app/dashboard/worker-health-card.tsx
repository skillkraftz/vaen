import type { JobRecord, WorkerHeartbeat } from "@/lib/types";
import { summarizeWorkerHealth } from "@/lib/worker-health";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getBadgeClass(status: "healthy" | "stale" | "missing") {
  switch (status) {
    case "healthy":
      return "badge-green";
    case "stale":
      return "badge-yellow";
    default:
      return "badge-red";
  }
}

function formatJobLabel(job: ReturnType<typeof summarizeWorkerHealth>["currentJob"]) {
  if (!job) return "No current job";
  const parts = [
    job.jobType ? job.jobType.replace(/_/g, " ") : "unknown job",
    job.projectId ? `project ${job.projectId.slice(0, 8)}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function WorkerHealthCard({
  heartbeat,
  currentJob,
  title = "Worker Health",
  testId = "worker-health-card",
}: {
  heartbeat: Pick<WorkerHeartbeat, "worker_id" | "hostname" | "last_seen_at" | "status" | "current_job_id" | "metadata"> | null;
  currentJob?: Pick<JobRecord, "id" | "job_type" | "project_id" | "status"> | null;
  title?: string;
  testId?: string;
}) {
  const summary = summarizeWorkerHealth(heartbeat, currentJob);

  return (
    <div className="card" data-testid={testId}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div className="wrap-between" style={{ gap: "0.5rem" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h2>
            <p className="text-sm text-muted">{summary.detail}</p>
          </div>
          <span className={`badge ${getBadgeClass(summary.status)}`} data-testid={`${testId}-badge`}>
            {summary.status}
          </span>
        </div>

        <div className="detail-grid">
          <div data-testid={`${testId}-last-seen`}>
            <strong>Last seen:</strong> {formatDate(heartbeat?.last_seen_at)}
          </div>
          <div data-testid={`${testId}-current-job`}>
            <strong>Current job:</strong> {formatJobLabel(summary.currentJob)}
          </div>
          <div>
            <strong>Worker:</strong> {heartbeat ? `${heartbeat.worker_id} on ${heartbeat.hostname}` : "No worker has checked in yet"}
          </div>
          <div>
            <strong>What to do next:</strong> {summary.nextStep}
          </div>
        </div>

        {summary.currentJob && (
          <p className="text-sm text-muted">
            This worker signal helps explain why jobs may still be pending or why a running job has not advanced yet.
          </p>
        )}

        {!summary.currentJob && summary.status !== "healthy" && (
          <p className="text-sm text-muted">
            If jobs stay pending, check the worker process before retrying project actions.
          </p>
        )}
      </div>
    </div>
  );
}
