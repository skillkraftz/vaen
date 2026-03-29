#!/usr/bin/env node

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import { createWorkerClient } from "./db.js";
import { runJobById } from "./run-job.js";

const __workerDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(__workerDir, "..", ".env") });

const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const workerId = process.env.WORKER_ID?.trim() || `${hostname()}:${process.pid}`;

type ClaimedJobRow = {
  id: string;
  project_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
};

async function upsertWorkerHeartbeat(params: {
  currentJobId?: string | null;
  status: "idle" | "running" | "error";
  metadata?: Record<string, unknown>;
}) {
  const db = createWorkerClient();
  const now = new Date().toISOString();
  const { error } = await db.from("worker_heartbeats").upsert({
    worker_id: workerId,
    hostname: hostname(),
    current_job_id: params.currentJobId ?? null,
    last_seen_at: now,
    status: params.status,
    metadata: params.metadata ?? {},
    updated_at: now,
  });

  if (error) {
    throw new Error(`Failed to upsert worker heartbeat: ${error.message}`);
  }
}

async function claimNextPendingJob(): Promise<ClaimedJobRow | null> {
  const db = createWorkerClient();
  const { data, error } = await db.rpc("claim_next_job", { p_worker_id: workerId });
  if (error) {
    throw new Error(`Failed to claim next job: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return ((rows[0] as ClaimedJobRow | undefined) ?? null);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`[worker] Polling Supabase jobs as ${workerId}`);

  await upsertWorkerHeartbeat({
    status: "idle",
    metadata: { mode: "poll", phase: "startup" },
  });

  let lastHeartbeatAt = 0;

  while (true) {
    try {
      if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        await upsertWorkerHeartbeat({
          status: "idle",
          metadata: { mode: "poll" },
        });
        lastHeartbeatAt = Date.now();
      }

      const job = await claimNextPendingJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const jobHeartbeat = setInterval(() => {
        void upsertWorkerHeartbeat({
          currentJobId: job.id,
          status: "running",
          metadata: {
            mode: "poll",
            job_type: job.job_type,
            project_id: job.project_id,
          },
        }).catch((error) => {
          console.error("[worker] Heartbeat update failed:", error);
        });
      }, HEARTBEAT_INTERVAL_MS);

      try {
        await upsertWorkerHeartbeat({
          currentJobId: job.id,
          status: "running",
          metadata: {
            mode: "poll",
            job_type: job.job_type,
            project_id: job.project_id,
          },
        });
        lastHeartbeatAt = Date.now();
        await runJobById(job.id, { claimIfPending: false });
      } finally {
        clearInterval(jobHeartbeat);
        await upsertWorkerHeartbeat({
          currentJobId: null,
          status: "idle",
          metadata: { mode: "poll", last_job_id: job.id },
        });
        lastHeartbeatAt = Date.now();
      }
    } catch (error) {
      console.error("[worker] Poll loop error:", error);
      await upsertWorkerHeartbeat({
        status: "error",
        metadata: {
          mode: "poll",
          error: error instanceof Error ? error.message : String(error),
        },
      }).catch((heartbeatError) => {
        console.error("[worker] Failed to record error heartbeat:", heartbeatError);
      });
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

main().catch((error) => {
  console.error("[worker] Fatal poller error:", error);
  process.exit(1);
});
