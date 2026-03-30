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

Entrypoint split:

- `poll` is the long-running worker loop and should start without a job id
- `run-job` is the single-job CLI and requires an explicit `<job-id>`
- `src/poll.ts` imports `runJobById()` from `src/run-job.ts`, so `src/run-job.ts` must keep its CLI path guarded and import-safe

## VM runbook

For a real remote worker setup, use:

- [docs/architecture/worker-vm-runbook.md](/home/andy/projects/vaen/docs/architecture/worker-vm-runbook.md)

That runbook covers:

- required env vars
- `OPENAI_API_KEY` only for generator-backed jobs
- Playwright/Chromium setup
- writable workspace expectations under `generated/`
- `systemd` and `pm2` examples
- portal heartbeat verification steps
- GitHub provider setup for real repository creation/push
- Vercel preview deployment setup
- managed subdomain attachment under `VAEN_BASE_DOMAIN`
- the current limit that domain attachment uses Vercel APIs only, with manual registrar or DNS-host changes still required when the base domain is not already configured there

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
- add customer custom-domain onboarding and registrar-level automation on top of the current provider control plane
- add a real DNS-provider integration boundary, likely Cloudflare first and Namecheap separately if needed
- add deploy-target orchestration on top of the job backbone
