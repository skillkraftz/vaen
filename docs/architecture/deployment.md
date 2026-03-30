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

### Hosted testing checklist — CURRENT PATH

1. deploy the portal to Vercel at `https://vaen.space`
2. set `NEXT_PUBLIC_PORTAL_URL=https://vaen.space`
3. configure the Supabase auth callback as `https://vaen.space/auth/callback`
4. configure the Resend webhook target as `https://vaen.space/api/webhooks/resend` if webhook-backed outreach testing is needed
5. start the remote worker and confirm the heartbeat in `/dashboard/settings/deployment`
6. open a project whose active revision is already exported and generated
7. create a deployment run
8. execute providers
9. verify:
   - GitHub repo reference
   - Vercel preview deployment URL
   - any failure summary if provider execution is rejected

### Hosted smoke audit — CURRENT PATH

Use the lightweight Playwright smoke audit when you want a repeatable operator check
against the hosted portal without running the full UX audit:

```bash
PORTAL_URL=https://vaen.space \
PORTAL_EMAIL=<operator-email> \
PORTAL_PASSWORD=<operator-password> \
PORTAL_SMOKE_PROJECT_ID=<ready-project-id> \
pnpm --filter @vaen/portal smoke:hosted
```

Optional:

- `PORTAL_SMOKE_WAIT_FOR_PROVIDER_REFERENCE=1` waits for a provider URL to appear after queueing provider execution
- `PORTAL_SMOKE_PROVIDER_REFERENCE_TIMEOUT_MS=90000` controls that wait window

This smoke path checks:

1. portal login
2. deployment settings reachability
3. worker heartbeat visibility
4. deployment run creation
5. provider execution queueing
6. provider reference visibility when the optional wait is enabled

### Worker on VM (via Tailscale) — NEXT
- Install Tailscale on VM
- Worker polls `jobs` table for pending work
- On new job: claim it (status: running), execute, update (status: completed/failed)
- VM has local disk for generation workspace
- VM has Playwright installed for screenshots
- Communication: VM ↔ Supabase (direct, no portal involvement)
- Use [worker-vm-runbook.md](/home/andy/projects/vaen/docs/architecture/worker-vm-runbook.md) for the concrete setup steps, env vars, and supervisor examples

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
NEXT_PUBLIC_PORTAL_URL=https://vaen.space
RESEND_WEBHOOK_SECRET=whsec_...
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

## Provider Adapter Foundation — STATUS: ADAPTER BOUNDARY READY

The provider adapter layer sits between validated deployment runs and actual hosting
platforms. Each adapter is independently implementable and returns a structured result.

### Architecture

```
deployment_run (status: validated)
  │
  ├─ deploy_execute job dispatched
  │
  └─ Worker: executeProviderAdapters()
       ├─ GitHubProviderAdapter  (push site to repo)
       ├─ VercelProviderAdapter  (deploy from repo)
       └─ DomainProviderAdapter  (DNS / custom domain)
```

### Adapter Interface

Each adapter implements `DeploymentProviderAdapter` from `@vaen/shared`:
- `isConfigured()` — checks env vars for required credentials
- `execute(context)` — returns a `ProviderStepResult` with explicit status

### Provider Execution Flow

1. Adapters run in order: github → vercel → domain
2. If a required adapter fails, subsequent adapters are skipped
3. Results are recorded in `deployment_run.payload_metadata.provider_execution`
4. Portal can queue a `deploy_execute` job from a validated deployment run
5. No adapter fakes success — unconfigured adapters return `{ status: "not_configured" }`, and configured-but-stubbed adapters return `{ status: "not_implemented" }`

### Result Statuses

| Status | Meaning |
|--------|---------|
| `not_configured` | Adapter lacks required env vars (e.g. `GITHUB_TOKEN`) |
| `not_implemented` | Adapter is configured but the real provider execution code is not built yet |
| `unsupported` | Deployment payload or target is not supported by this adapter |
| `succeeded` | Provider step completed successfully |
| `failed` | Provider step returned an error |
| `skipped` | Skipped due to earlier provider failure |

### Environment Variables (per provider)

| Provider | Required Variables | Status |
|----------|--------------------|--------|
| GitHub | `GITHUB_TOKEN`, `GITHUB_ORG` | Real repo creation/reuse and source push implemented |
| Vercel | `VERCEL_TOKEN`, `VERCEL_TEAM_ID` (optional) | Real project creation/reuse and preview deployment trigger implemented |
| Domain | `DNS_PROVIDER_TOKEN`, `VAEN_BASE_DOMAIN` | Adapter registered, execution pending |

### What is implemented

- `DeploymentProviderAdapter` interface in `@vaen/shared`
- `ProviderStepResult` / `ProviderExecutionResult` structured result model
- Provider registry with execution ordering
- Portal action to queue provider execution from a validated deployment run
- GitHub adapter that creates or reuses a repository and pushes generated `site/` source
- Vercel adapter that creates or reuses a project and triggers a preview deployment from the GitHub repo
- Domain adapter stub (returns `not_configured` or `not_implemented` honestly)
- Worker `deploy_execute` job handler that routes through adapters
- `deploy_execute` job type added to shared pipeline definitions
- Results stored in deployment run metadata for audit

### What requires real provider credentials

- GitHub API calls (repo creation, code push)
- Vercel API calls (project creation, deployment trigger)
- DNS API calls (subdomain creation, custom domain wiring)
- Domain automation is still a separate future PR with real integration tests

## GitHub Provider — STATUS: REAL REPO PUSH IMPLEMENTED

The GitHub provider is the first real provider adapter. It can:

1. derive a repository name from the deployment target slug
2. create the repository in the configured GitHub organization if it does not exist
3. reuse the repository if it already exists
4. push the generated `site/` source into that repository's default branch
5. record the repository URL back into `deployment_runs.provider_reference`

### Required GitHub env

```bash
GITHUB_TOKEN=<token with repo create/push access>
GITHUB_ORG=<organization-name>
```

### Practical setup steps

1. set `GITHUB_TOKEN` and `GITHUB_ORG` on the worker VM
2. ensure the deployment run is already in `validated` state
3. click `Execute Providers` on the project deployment panel
4. inspect the latest deployment run for:
   - provider summary
   - provider reference (repo URL)
   - any failure summary

### Honest limits

- A successful GitHub push does **not** yet mean the site is live on Vercel or DNS.
- If GitHub succeeds but Vercel/domain remain unconfigured, the deployment run stays `validated` and records provider execution honestly.
- Real Vercel and domain automation are still future work.

## Vercel Provider — STATUS: REAL PREVIEW DEPLOYMENT IMPLEMENTED

The Vercel provider is now real enough for hosted testing. It can:

1. derive a Vercel project name from the target slug
2. reuse the project if it already exists
3. create the project if it does not exist yet
4. connect the project to the GitHub repo reference from the GitHub provider step
5. trigger a preview deployment from that repo/ref
6. record the deployment URL back into `deployment_runs.provider_reference`

### Required Vercel env

```bash
VERCEL_TOKEN=<token with project/deployment access>
VERCEL_TEAM_ID=<optional-team-id>
```

`VERCEL_TEAM_ID` is optional for personal-account scope.

### Practical setup steps

1. ensure the GitHub provider step can create or reuse the repo first
2. set `VERCEL_TOKEN` on the worker VM
3. set `VERCEL_TEAM_ID` if the target Vercel project lives under a team
4. execute providers from a validated deployment run
5. inspect the latest deployment run for:
   - provider summary
   - provider reference (preview deployment URL)
   - failure summary if the Vercel API rejects project or deployment creation

### Honest limits

- This triggers a real preview deployment URL for testing, not full production promotion.
- Existing projects linked to a different GitHub repo are treated as `unsupported` rather than being silently relinked.
- Domain automation is still pending, so custom-domain cutover is not included.

## Remaining Work For True VM Deployment

1. Run the worker poller under a persistent supervisor on the VM
2. Provision Playwright/build dependencies on that VM
3. Decide the shared/generated workspace location and retention policy
4. Decide when preview deployments should be promoted or aliased for production use
5. Implement real domain provider (DNS API, TLS verification)
6. Add deployment webhooks or polling for richer Vercel status tracking
