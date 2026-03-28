# Vaen Deployment Architecture

> **Implementation status:** Phase 1 (local) is **CURRENT**. Phases 2-3 are **PLANNED** — not yet implemented.

## Overview

Vaen splits into two runtime contexts: the **portal** (web UI, database access) and the **worker** (site generation, build, screenshot capture). This split allows the portal to run on Vercel while heavy compute runs on a local/cloud VM.

## Components

### Portal (Vercel)
- **Runtime**: Next.js App Router
- **URL**: `https://vaen.vercel.app` (or custom domain)
- **Database**: Supabase (hosted)
- **Storage**: Supabase Storage (intake-assets, review-screenshots buckets)
- **Responsibilities**:
  - Project CRUD
  - Intake processing (pure computation, runs in server actions)
  - Revision management
  - File upload to Supabase Storage
  - Job dispatch (creates job record in DB)
  - Status display, screenshot viewing

### Worker (VM / local machine)
- **Runtime**: Node.js process spawned per job
- **Location**: Any machine with Tailscale access to Supabase
- **Responsibilities**:
  - Poll for pending jobs in the `jobs` table
  - Run `@vaen/generator` (AI-powered site generation)
  - Run `review.sh` (build + Playwright screenshot capture)
  - Upload screenshots to Supabase Storage
  - Update job status and project status in DB

### Database (Supabase)
- **Tables**: projects, project_request_revisions, assets, revision_assets, jobs, project_events
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

## Current Architecture (Development) — STATUS: CURRENT

Portal and worker run on the same machine. The portal spawns the worker as a detached child process:

```
Portal (localhost:3100)
  |
  +---> spawn("node", [workerScript, jobId])
  |       |
  |       +---> reads client-request.json from disk
  |       +---> runs generator
  |       +---> runs review.sh
  |       +---> uploads to Supabase
  |
  +---> Supabase DB (remote)
```

## Target Architecture (Production) — STATUS: PLANNED (not implemented)

### Portal on Vercel — PLANNED
- Deploy `apps/portal` to Vercel
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- No filesystem access — all data goes through Supabase DB/Storage
- Job dispatch: insert into `jobs` table (no child_process spawn)

### Worker on VM (via Tailscale) — PLANNED
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
OPENAI_API_KEY=sk-...  # for generator AI calls
```

## Migration Path

### Phase 1: Everything local — CURRENT
- Portal and worker on same machine
- `child_process.spawn()` for job execution
- Disk-based artifact sharing

### Phase 2: Portal on Vercel, worker local — PLANNED (next)
- Deploy portal to Vercel
- Add `apps/worker/src/poll.ts` — polls jobs table
- Portal inserts jobs; worker polls and executes
- Remove `spawnWorker()` from portal actions
- Add fallback: portal detects no worker polling → shows message

### Phase 3: Worker on cloud VM — PLANNED (future)
- Move worker to cloud VM with Tailscale
- Same polling mechanism as Phase 2
- Add health check: worker reports last poll time to DB
- Portal shows worker health status

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

## Required Code Changes for Phase 2 — NOT YET IMPLEMENTED

1. **`apps/worker/src/poll.ts`** (new) — Long-running process that polls `jobs` table
2. **`apps/portal/src/app/dashboard/projects/[id]/actions.ts`** — Remove `spawnWorker()`, replace with job-insert-only
3. **Worker health table** — `worker_heartbeats` table for monitoring
4. **Vercel config** — `vercel.json` with build settings for portal
