import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { JobRecord, WorkerHeartbeat } from "./types";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

export interface WorkerHeartbeatSnapshot {
  heartbeat: WorkerHeartbeat | null;
  currentJob: Pick<JobRecord, "id" | "job_type" | "project_id" | "status" | "created_at" | "started_at" | "completed_at"> | null;
}

export async function loadLatestWorkerHeartbeat(
  supabase: PortalSupabase,
): Promise<WorkerHeartbeatSnapshot> {
  const { data: heartbeatRow } = await supabase
    .from("worker_heartbeats")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const heartbeat = (heartbeatRow as WorkerHeartbeat | null) ?? null;
  if (!heartbeat?.current_job_id) {
    return { heartbeat, currentJob: null };
  }

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, job_type, project_id, status, created_at, started_at, completed_at")
    .eq("id", heartbeat.current_job_id)
    .maybeSingle();

  return {
    heartbeat,
    currentJob: (jobRow as WorkerHeartbeatSnapshot["currentJob"]) ?? null,
  };
}
