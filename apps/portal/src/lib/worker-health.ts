import type { JobRecord, WorkerHeartbeat } from "./types";

const DEFAULT_STALE_AFTER_MS = 90_000;

export type WorkerHealthStatus = "healthy" | "stale" | "missing";

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
