import type { ArtifactStatus } from "./project-review-types";
import type { JobRecord, WorkerHeartbeat } from "@/lib/types";
import {
  getJobRelatedArtifacts,
  getLatestAttemptedJob,
  getLatestSuccessfulJob,
  getProjectArtifactViewerItems,
  summarizeJobForOperator,
} from "@/lib/project-job-artifact-view";
import { WorkerHealthCard } from "@/app/dashboard/worker-health-card";

function formatDate(iso: string | null) {
  if (!iso) return "Not yet";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadge(status: JobRecord["status"]) {
  switch (status) {
    case "completed":
      return "badge-green";
    case "failed":
      return "badge-red";
    case "running":
      return "badge-yellow";
    default:
      return "badge-blue";
  }
}

export function ProjectJobArtifactViewer({
  jobs,
  artifacts,
  workerHeartbeat,
  workerCurrentJob,
}: {
  jobs: JobRecord[];
  artifacts: ArtifactStatus;
  workerHeartbeat: Pick<WorkerHeartbeat, "worker_id" | "hostname" | "last_seen_at" | "status" | "current_job_id" | "metadata"> | null;
  workerCurrentJob?: Pick<JobRecord, "id" | "job_type" | "project_id" | "status"> | null;
}) {
  const latestGenerate = getLatestAttemptedJob(jobs, "generate");
  const latestReview = getLatestAttemptedJob(jobs, "review");
  const latestDeploy = getLatestAttemptedJob(jobs, "deploy_prepare");
  const jobCards = [
    { label: "Build Website", job: latestGenerate, latestSuccess: getLatestSuccessfulJob(jobs, "generate") },
    { label: "Create Preview", job: latestReview, latestSuccess: getLatestSuccessfulJob(jobs, "review") },
    { label: "Prepare Deployment", job: latestDeploy, latestSuccess: getLatestSuccessfulJob(jobs, "deploy_prepare") },
  ];
  const artifactItems = getProjectArtifactViewerItems(artifacts);

  return (
    <div className="section">
      <div className="card" data-testid="project-job-artifact-viewer">
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Jobs & Artifacts
            </h2>
            <p className="text-sm text-muted">
              This view explains what was attempted, what succeeded last, what files exist, and what to do next.
            </p>
          </div>

          <WorkerHealthCard
            heartbeat={workerHeartbeat}
            currentJob={workerCurrentJob}
            title="Worker status"
            testId="project-worker-health"
          />

          <div className="detail-grid" data-testid="job-artifact-latest-jobs">
            {jobCards.map(({ label, job, latestSuccess }) => {
              const summary = job ? summarizeJobForOperator(job) : null;
              return (
                <div
                  key={label}
                  className="card"
                  style={{ padding: "0.75rem", background: "var(--color-surface-subtle)" }}
                  data-testid={`job-artifact-card-${label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="wrap-between" style={{ gap: "0.5rem", marginBottom: "0.35rem" }}>
                    <strong>{label}</strong>
                    <span className={`badge ${job ? statusBadge(job.status) : ""}`}>
                      {job ? job.status : "not run"}
                    </span>
                  </div>

                  {job ? (
                    <>
                      <p className="text-sm" style={{ fontWeight: 500 }}>
                        {summary?.heading}
                      </p>
                      <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                        {summary?.happened}
                      </p>
                      <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                        Latest attempted: {formatDate(job.started_at ?? job.created_at)}
                      </p>
                      <p className="text-sm text-muted">
                        Latest successful: {latestSuccess ? formatDate(latestSuccess.completed_at ?? latestSuccess.created_at) : "None yet"}
                      </p>
                      <p className="text-sm" style={{ marginTop: "0.35rem" }}>
                        <strong>Next:</strong> {summary?.nextStep}
                      </p>
                      {summary?.logSummary && (
                        <details style={{ marginTop: "0.5rem" }}>
                          <summary className="text-sm text-muted">Latest message</summary>
                          <pre
                            style={{
                              marginTop: "0.5rem",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              overflowX: "auto",
                              fontSize: "0.75rem",
                              background: "var(--color-surface)",
                              borderRadius: "6px",
                              padding: "0.5rem",
                            }}
                          >
                            {summary.logSummary}
                          </pre>
                        </details>
                      )}
                      <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
                        Related artifacts: {getJobRelatedArtifacts(job.job_type).join(", ") || "None"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted">No attempt recorded yet.</p>
                      <p className="text-sm" style={{ marginTop: "0.35rem" }}>
                        <strong>Next:</strong>{" "}
                        {label === "Build Website"
                          ? "Prepare and build the current request."
                          : label === "Create Preview"
                            ? "Build the website first, then create a preview."
                            : "Build and preview the site before preparing deployment."}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div data-testid="job-artifact-artifacts">
            <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Artifacts
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {artifactItems.map((item) => (
                <div
                  key={item.key}
                  className="card"
                  style={{ padding: "0.75rem" }}
                  data-testid={`artifact-view-item-${item.key}`}
                >
                  <div className="wrap-between" style={{ gap: "0.5rem" }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>{item.label}</strong>
                      <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                        {item.description}
                      </p>
                      <p className="text-sm" style={{ marginTop: "0.35rem" }}>
                        <strong>Next:</strong> {item.nextStep}
                      </p>
                    </div>
                    <span className={`badge ${item.available ? "badge-green" : "badge-yellow"}`}>
                      {item.available ? "available" : "missing"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
