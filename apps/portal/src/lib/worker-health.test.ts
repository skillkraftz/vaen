import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getWorkerCurrentJobSummary,
  getWorkerHealthStatus,
  interpretJobLifecycleStatus,
  isWorkerHeartbeatFresh,
  summarizeWorkerHealth,
} from "./worker-health";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("worker health helpers", () => {
  it("treats recent heartbeats as healthy and old ones as stale", () => {
    const now = new Date("2026-03-29T12:00:00.000Z");

    expect(
      getWorkerHealthStatus({ last_seen_at: "2026-03-29T11:59:30.000Z" }, now),
    ).toBe("healthy");
    expect(
      getWorkerHealthStatus({ last_seen_at: "2026-03-29T11:57:00.000Z" }, now),
    ).toBe("stale");
    expect(isWorkerHeartbeatFresh(null, now)).toBe(false);
  });

  it("normalizes known job statuses and preserves unknowns separately", () => {
    expect(interpretJobLifecycleStatus("pending")).toBe("pending");
    expect(interpretJobLifecycleStatus("running")).toBe("running");
    expect(interpretJobLifecycleStatus("completed")).toBe("completed");
    expect(interpretJobLifecycleStatus("failed")).toBe("failed");
    expect(interpretJobLifecycleStatus(null)).toBe("unknown");
  });

  it("summarizes missing and stale worker states with operator guidance", () => {
    const now = new Date("2026-03-29T12:00:00.000Z");

    const missing = summarizeWorkerHealth(null, null, now);
    expect(missing.status).toBe("missing");
    expect(missing.heading).toContain("No worker heartbeat");
    expect(missing.nextStep).toContain("Start the worker poller");

    const stale = summarizeWorkerHealth(
      {
        last_seen_at: "2026-03-29T11:57:00.000Z",
        current_job_id: "job-123",
        metadata: { job_type: "generate", project_id: "proj-123" },
      },
      null,
      now,
    );
    expect(stale.status).toBe("stale");
    expect(stale.detail).toContain("may still have been running");
    expect(stale.currentJob?.jobType).toBe("generate");
  });

  it("prefers joined current job data over heartbeat metadata when available", () => {
    const result = getWorkerCurrentJobSummary(
      {
        current_job_id: "job-meta",
        metadata: { job_type: "review", project_id: "proj-meta" },
      },
      {
        id: "job-real",
        job_type: "deploy_prepare",
        project_id: "proj-real",
        status: "running",
      },
    );

    expect(result).toEqual({
      id: "job-real",
      jobType: "deploy_prepare",
      projectId: "proj-real",
      status: "running",
    });
  });
});

describe("supabase-polled worker architecture", () => {
  it("adds an atomic claim function and worker heartbeat migration", () => {
    const migrationPath = join(
      REPO_ROOT,
      "supabase/migrations/20260329000023_create_worker_heartbeats.sql",
    );
    expect(existsSync(migrationPath)).toBe(true);

    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table public.worker_heartbeats");
    expect(source).toContain("create or replace function public.claim_next_job");
    expect(source).toContain("for update skip locked");
    expect(source).toContain("status = 'running'");
  });

  it("adds a polling worker loop that claims jobs through Supabase", () => {
    const pollPath = join(REPO_ROOT, "apps/worker/src/poll.ts");
    const source = readFileSync(pollPath, "utf-8");

    expect(source).toContain('rpc("claim_next_job"');
    expect(source).toContain('from("worker_heartbeats").upsert');
    expect(source).toContain('status: "running"');
    expect(source).toContain("runJobById(job.id, { claimIfPending: false })");
  });

  it("keeps direct local spawning as an opt-in fallback instead of the normal path", () => {
    const helperPath = join(
      REPO_ROOT,
      "apps/portal/src/app/dashboard/projects/[id]/project-worker-helpers.ts",
    );
    const actionsPath = join(
      REPO_ROOT,
      "apps/portal/src/app/dashboard/projects/[id]/actions.ts",
    );
    const helperSource = readFileSync(helperPath, "utf-8");
    const actionsSource = readFileSync(actionsPath, "utf-8");
    const generateStart = actionsSource.indexOf("export async function generateSiteAction");
    const reviewStart = actionsSource.indexOf("export async function runReviewAction");
    const jobsStart = actionsSource.indexOf("export async function getProjectJobsAction");
    const generateFn = actionsSource.slice(generateStart, reviewStart);
    const reviewFn = actionsSource.slice(reviewStart, jobsStart);

    expect(helperSource).toContain("VAEN_ENABLE_LOCAL_WORKER_SPAWN");
    expect(generateFn).toContain("shouldUseLocalWorkerSpawn()");
    expect(reviewFn).toContain("shouldUseLocalWorkerSpawn()");
    expect(generateFn).not.toContain("spawnWorker(job.id);\n\n  revalidatePath");
    expect(reviewFn).not.toContain("spawnWorker(job.id);\n\n  revalidatePath");
  });

  it("adds a server helper and operator-facing UI for worker heartbeat visibility", () => {
    const helperPath = join(REPO_ROOT, "apps/portal/src/lib/worker-heartbeats-server.ts");
    const workerHealthHelperPath = join(REPO_ROOT, "apps/portal/src/lib/worker-health.ts");
    const deploymentPagePath = join(REPO_ROOT, "apps/portal/src/app/dashboard/settings/deployment/page.tsx");
    const viewerPath = join(REPO_ROOT, "apps/portal/src/app/dashboard/projects/[id]/project-job-artifact-viewer.tsx");
    const cardPath = join(REPO_ROOT, "apps/portal/src/app/dashboard/worker-health-card.tsx");
    const helperSource = readFileSync(helperPath, "utf-8");
    const workerHealthSource = readFileSync(workerHealthHelperPath, "utf-8");
    const deploymentPageSource = readFileSync(deploymentPagePath, "utf-8");
    const viewerSource = readFileSync(viewerPath, "utf-8");
    const cardSource = readFileSync(cardPath, "utf-8");

    expect(helperSource).toContain('from("worker_heartbeats")');
    expect(helperSource).toContain("loadLatestWorkerHeartbeat");
    expect(deploymentPageSource).toContain("deployment-worker-health");
    expect(viewerSource).toContain("project-worker-health");
    expect(workerHealthSource).toContain("No worker heartbeat detected");
    expect(cardSource).toContain("What to do next");
  });
});
