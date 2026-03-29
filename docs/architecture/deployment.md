# Vaen Deployment Architecture

> **Implementation status:** Phase 2 (Supabase-polled worker) is **CURRENT**. VM/Tailscale deployment remains **PLANNED**.

## Overview

Vaen splits into two runtime contexts: the **portal** (web UI, database access) and the **worker** (site generation, build, screenshot capture). This split allows the portal to run on Vercel while heavy compute runs on a local/cloud VM.

## Components

### Portal (Vercel)
- **Runtime**: Next.js App Router
- **URL**: `https://vaen.space` (production target)
- **Database**: Supabase (hosted)
- **Storage**: Supabase Storage (intake-assets, review-screenshots buckets)
- **Responsibilities**:
  - Project CRUD
  - Intake processing (pure computation, runs in server actions)
  - Revision management
  - File upload to Supabase Storage
  - Job dispatch (creates job record in DB)
  - Worker heartbeat visibility
  - Deployment run creation and history
  - Status display, screenshot viewing

### Worker (VM / local machine)
- **Runtime**: Long-running Node.js poller
- **Location**: Any machine with Tailscale access to Supabase
- **Responsibilities**:
  - Poll for pending jobs in the `jobs` table
  - Atomically claim one pending job at a time
  - Write worker heartbeat state to `worker_heartbeats`
  - Run `@vaen/generator` (AI-powered site generation)
  - Run `review.sh` (build + Playwright screenshot capture)
  - Upload screenshots to Supabase Storage
  - Update job status and project status in DB

### Database (Supabase)
- **Tables**: projects, project_request_revisions, assets, revision_assets, jobs, project_events, worker_heartbeats, deployment_runs
- **Storage buckets**: intake-assets, review-screenshots
- **Auth**: Supabase Auth (portal), Service Role Key (worker)

## Communication Flow

```
User (browser)
  |
  v
Portal (Vercel) ---> Supabase DB (hosted)
                          ^
                          |
Worker (VM) polls jobs ---+
  |
  +---> generates site on local disk
  +---> builds site (next build)
  +---> captures screenshots (Playwright)
  +---> uploads screenshots to Supabase Storage
  +---> updates job/project status in Supabase DB
```

## Current Architecture — STATUS: CURRENT

Portal and worker can run on separate machines. The portal inserts jobs into Supabase, and the worker poller claims them:

```
Portal (localhost:3100 or https://vaen.space)
  |
  +---> insert into jobs (status: pending)
  |
  +---> Supabase DB (remote)
            ^
            |
Worker poller +---> claim_next_job() -> status: running
  |               |
  |               +---> reads client-request.json from disk
  |               +---> runs generator / review
  |               +---> validates deployment-payload.json for deploy runs
  |               +---> uploads to Supabase
  |               +---> writes job + project results
  |
  +---> upsert worker_heartbeats
```

## Production Direction — STATUS: PARTIALLY IMPLEMENTED

### Portal on Vercel — READY IN PRINCIPLE
- Deploy `apps/portal` to Vercel
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- No filesystem access — all data goes through Supabase DB/Storage
- Job dispatch: insert into `jobs` table (normal path no longer depends on `child_process.spawn`)
- Deployment control plane: project pages can create tracked deployment runs backed by worker jobs
- Supabase auth callback should be configured as `https://vaen.space/auth/callback`
- Resend webhook target should be `https://vaen.space/api/webhooks/resend`
- Deployment trust depends on active revision request data and exported `client-request.json`, not just visible project fields

### Worker on VM (via Tailscale) — NEXT
- Install Tailscale on VM
- Worker polls `jobs` table for pending work
- On new job: claim it (status: running), execute, update (status: completed/failed)
- VM has local disk for generation workspace
- VM has Playwright installed for screenshots
- Communication: VM ↔ Supabase (direct, no portal involvement)

### Tailscale for phone testing — PLANNED
- Install Tailscale on phone and VM
- Portal on Vercel is publicly accessible
- For previewing generated sites before deploy:
  - Worker VM starts `next start` on a port
  - Phone accesses `http://<tailscale-ip>:<port>` to preview
  - No DNS, no port forwarding, no public exposure

## Environment Variables

### Portal (Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Worker (VM)
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
WORKER_ID=worker-prod-1
OPENAI_API_KEY=sk-...  # for generator AI calls
```

## Migration Path

### Phase 1: Everything local — COMPLETE
- Portal and worker on same machine
- Direct local child-process execution from portal
- Disk-based artifact sharing

### Phase 2: Portal inserts jobs, worker polls Supabase — CURRENT
- `apps/worker/src/poll.ts` claims pending jobs from Supabase
- Portal inserts jobs; worker polls and executes
- `worker_heartbeats` is the worker health source
- Portal now surfaces worker heartbeat state on deployment settings and project job/artifact views
- `deployment_runs` track deploy-prepare history from authoritative revision/build state
- Local direct spawn remains available only as an opt-in dev fallback

### Phase 3: Worker on cloud VM — PLANNED (future)
- Move worker to cloud VM with Tailscale
- Same polling mechanism as Phase 2
- Operationalize heartbeat monitoring
- Run poller under a real process manager (systemd/pm2/container)

## What Runs Where

| Component | Vercel | VM | Both |
|-----------|--------|-----|------|
| Portal UI | x | | |
| Server actions | x | | |
| Intake processing | x | | |
| Job dispatch | x | | |
| Site generation | | x | |
| Build (next build) | | x | |
| Screenshot capture | | x | |
| Screenshot upload | | x | |
| Supabase DB access | x | x | |
| File storage | | | Supabase Storage |

## Remaining Work For True VM Deployment

1. Run the worker poller under a persistent supervisor on the VM
2. Provision Playwright/build dependencies on that VM
3. Decide the shared/generated workspace location and retention policy
4. Add provider adapters for GitHub/Vercel/domain wiring on top of deployment runs
