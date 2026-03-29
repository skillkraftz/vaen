import type { JobRecord, WorkerHeartbeat } from "./types";

const DEFAULT_STALE_AFTER_MS = 90_000;

export type WorkerHealthStatus = "healthy" | "stale" | "missing";

export interface WorkerJobSummary {
  id: string | null;
  jobType: string | null;
  projectId: string | null;
  status: JobRecord["status"] | null;
}

export interface WorkerHealthDisplay {
  status: WorkerHealthStatus;
  heading: string;
  detail: string;
  nextStep: string;
  currentJob: WorkerJobSummary | null;
}

export function getWorkerHealthStatus(
  heartbeat: Pick<WorkerHeartbeat, "last_seen_at"> | null | undefined,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): WorkerHealthStatus {
  if (!heartbeat?.last_seen_at) {
    return "missing";
  }

  const lastSeenMs = new Date(heartbeat.last_seen_at).getTime();
  if (Number.isNaN(lastSeenMs)) {
    return "stale";
  }

  return now.getTime() - lastSeenMs > staleAfterMs ? "stale" : "healthy";
}

export function isWorkerHeartbeatFresh(
  heartbeat: Pick<WorkerHeartbeat, "last_seen_at"> | null | undefined,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): boolean {
  return getWorkerHealthStatus(heartbeat, now, staleAfterMs) === "healthy";
}

export function getWorkerCurrentJobSummary(
  heartbeat: Pick<WorkerHeartbeat, "current_job_id" | "metadata"> | null | undefined,
  currentJob?: Pick<JobRecord, "id" | "job_type" | "project_id" | "status"> | null,
): WorkerJobSummary | null {
  if (currentJob) {
    return {
      id: currentJob.id,
      jobType: currentJob.job_type,
      projectId: currentJob.project_id,
      status: currentJob.status,
    };
  }

  const metadata = (heartbeat?.metadata as Record<string, unknown> | undefined) ?? {};
  const jobId = heartbeat?.current_job_id ?? null;
  const jobType = typeof metadata.job_type === "string" ? metadata.job_type : null;
  const projectId = typeof metadata.project_id === "string" ? metadata.project_id : null;

  if (!jobId && !jobType && !projectId) {
    return null;
  }

  return {
    id: jobId,
    jobType,
    projectId,
    status: null,
  };
}

export function summarizeWorkerHealth(
  heartbeat: Pick<WorkerHeartbeat, "last_seen_at" | "current_job_id" | "metadata"> | null | undefined,
  currentJob?: Pick<JobRecord, "id" | "job_type" | "project_id" | "status"> | null,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): WorkerHealthDisplay {
  const status = getWorkerHealthStatus(heartbeat, now, staleAfterMs);
  const currentJobSummary = getWorkerCurrentJobSummary(heartbeat, currentJob);

  if (status === "missing") {
    return {
      status,
      heading: "No worker heartbeat detected",
      detail: "The portal has not seen any polling worker yet, so queued jobs will wait.",
      nextStep: "Start the worker poller and confirm it begins updating worker heartbeats.",
      currentJob: null,
    };
  }

  if (status === "stale") {
    return {
      status,
      heading: "Worker heartbeat is stale",
      detail: currentJobSummary
        ? "The worker stopped checking in while a job may still have been running."
        : "The worker has not checked in recently, so pending jobs may be stuck waiting.",
      nextStep: "Verify the worker process is still running and restart it before retrying queued jobs.",
      currentJob: currentJobSummary,
    };
  }

  return {
    status,
    heading: currentJobSummary ? "Worker is healthy and processing work" : "Worker is healthy",
    detail: currentJobSummary
      ? "The worker is actively checking in and has a current job assigned."
      : "The worker is checking in normally and ready to claim new jobs.",
    nextStep: currentJobSummary
      ? "If a job looks stuck, compare its last update time with the worker heartbeat before retrying."
      : "You can queue generation, review, or deployment preparation jobs normally.",
    currentJob: currentJobSummary,
  };
}

export function interpretJobLifecycleStatus(
  status: JobRecord["status"] | null | undefined,
): "pending" | "running" | "completed" | "failed" | "unknown" {
  switch (status) {
    case "pending":
    case "running":
    case "completed":
    case "failed":
      return status;
    default:
      return "unknown";
  }
}
