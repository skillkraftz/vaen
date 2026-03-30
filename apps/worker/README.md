# @vaen/worker

Background job runner for the vaen pipeline — processes generation, build, review, and deployment jobs.

**Status:** Supabase-polled worker implemented. Jobs are claimed from the DB, executed, and tracked with worker heartbeats.

## Architecture

The worker executes a pipeline of jobs for a given target:

```
intake_parse → workspace_generate → site_build → validate_build → capture_screenshots → prepare_deploy_payload → deploy_validate
```

Each job type has a registered handler. Jobs run sequentially within a pipeline. Failures stop the pipeline.

## Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Info / package entry point |
| `src/poll.ts` | Long-running Supabase poller + heartbeat loop |
| `src/run-job.ts` | Execute a single claimed job |
| `src/config.ts` | Worker configuration (concurrency, isolation, timeout) |
| `src/handlers.ts` | Job handler registry + built-in handlers |
| `src/pipeline.ts` | Pipeline runner with lifecycle callbacks |

## Runtime model

1. Portal inserts a `jobs` row
2. `src/poll.ts` claims the next pending job via `claim_next_job()`
3. Poller updates `worker_heartbeats`
4. `src/run-job.ts` executes the claimed job
5. Job + project state are written back to Supabase

Local direct execution still exists for debugging:

```bash
pnpm --filter @vaen/worker poll
pnpm --filter @vaen/worker run-job -- <job-id>
```

## VM runbook

For a real remote worker setup, use:

- [docs/architecture/worker-vm-runbook.md](/home/andy/projects/vaen/docs/architecture/worker-vm-runbook.md)

That runbook covers:

- required env vars
- Playwright/Chromium setup
- writable workspace expectations under `generated/`
- `systemd` and `pm2` examples
- portal heartbeat verification steps
- GitHub provider setup for real repository creation/push

## Usage (programmatic)

```typescript
import { runPipeline } from "@vaen/worker";

const pipeline = await runPipeline(
  { targetSlug: "flower-city-painting" },
  payloads,
);
```

## Remaining deployment work
- run the poller under a real process supervisor on a VM
- provision Playwright/build dependencies on that VM
- implement real provider adapters on top of the current deployment control plane
- add deploy-target orchestration on top of the job backbone
