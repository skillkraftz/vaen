# Job Model

## Overview

Vaen jobs are persisted in Supabase and executed by a long-running worker poller.

- **Portal** inserts a row into `public.jobs`
- **Worker** claims one `pending` job at a time through `claim_next_job()`
- **Database** remains the source of truth for job status, timing, and result metadata
- **Heartbeats** in `public.worker_heartbeats` are the health signal for worker presence

This is intentionally thin: no Redis, no BullMQ, no hidden queue service.

## Current Job Types

Portal-facing jobs currently use these types:

| Job Type | Purpose |
|----------|---------|
| `generate` | Run the generator for the exported `client-request.json` |
| `review` | Build the generated site and capture review screenshots |

## Job Status Lifecycle

```
pending -> running -> completed
                  -> failed
```

`claim_next_job()` transitions the row from `pending` to `running` atomically.

## Job Record

```ts
interface JobRecord {
  id: string;
  project_id: string;
  job_type: string;
  status: "pending" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  result: { success: boolean; message: string; artifacts?: string[]; error?: string } | null;
  stdout: string | null;
  stderr: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}
```

## Atomic Claiming

The worker does **not** race on `select ... where status = 'pending'` in application code.
Instead it uses the SQL helper:

```sql
public.claim_next_job(p_worker_id text)
```

That function:

- selects the oldest pending job
- locks it with `FOR UPDATE SKIP LOCKED`
- marks it `running`
- stamps `started_at`
- records basic worker claim metadata in `result`

This makes multiple pollers safe to run later.

## Worker Heartbeats

`public.worker_heartbeats` stores:

- `worker_id`
- `hostname`
- `current_job_id`
- `last_seen_at`
- `status`
- `metadata`

Portal helpers interpret heartbeat freshness as:

- `healthy`
- `stale`
- `missing`

## Execution Path

1. Portal writes the active revision to `generated/<slug>/client-request.json`
2. Portal inserts a `jobs` row
3. Worker poller claims the next pending job
4. Worker executes the existing `run-job.ts` path
5. Worker updates project status, job status, artifacts, and logs

## Local Development Fallback

Direct local spawning still exists only as an opt-in fallback:

```bash
VAEN_ENABLE_LOCAL_WORKER_SPAWN=true
```

Normal behavior should use the poller, not the portal process.

## What This Is Not

- not BullMQ
- not Redis-backed
- not automatic retries yet
- not VM orchestration yet
- not full deployment automation

Those remain future work on top of the Supabase-backed source-of-truth model.
