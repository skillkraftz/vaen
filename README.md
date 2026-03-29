# vaen

Website factory that takes client intake and turns it into deployed local business websites through a deterministic build pipeline.

## Architecture

```
apps/
  portal/          vaen.space — authenticated intake portal (Next.js + Supabase)
  intake-bot/      Discord bot for conversational intake (scaffolded)
  worker/          Background job runner — executes generate/review via child_process

packages/
  shared/          Target resolution, job model, state machine, artifact lifecycle
  schemas/         JSON schemas + TypeScript types + validation (ClientRequest, BuildManifest, DeploymentPayload)
  generator/       CLI tool: client-request.json → generated workspace
  review-tools/    Playwright screenshot capture
  template-registry/   Template manifests (service-core, service-area, authority)
  module-registry/     Module manifests (maps-embed, manual-testimonials, google-reviews-live, booking-lite)

templates/
  service-core/    Next.js App Router template for local service businesses

modules/
  maps-embed/            Google Maps iframe component
  manual-testimonials/   Static testimonials component

supabase/
  migrations/      Database migrations for the portal

scripts/
  review.sh        Automated screenshot capture workflow
```

## Current Status

| Phase | Description | Status |
|-------|-------------|--------|
| v0 Foundation | Schemas, registries, generator, template, modules, review tools | Complete |
| v0 Architecture | Shared target/job/state/artifact model, app scaffolding | Complete |
| Phase 1 Portal | vaen.space intake front door: auth, dashboard, intake form, file uploads, Discord notifications | Complete |
| Phase 2 Processing | Intake processing, approval workflow, generator export, missing-info detection, recommendations | Complete |
| Phase 3 Automation | Worker-oriented job execution, job status/logs, screenshot viewer, review/audit hardening | Complete |
| **Phase 4 Sales Ops** | **Clients, lifecycle controls, variants, modules, pricing, quotes, contracts, prospects, campaigns, roles, approvals, sequencing, analytics dashboard** | **In Progress** |

## Setup

### Prerequisites

- Node.js >= 18
- pnpm >= 9
- A [Supabase](https://supabase.com) project (local or hosted)
- Playwright Chromium for screenshot capture: `npx playwright install chromium`

### Install

```bash
git clone <repo-url> vaen
cd vaen
pnpm install
pnpm build
```

### Supabase Setup

1. Create a Supabase project (or run `supabase start` for local development)

2. Apply database migrations:
   ```bash
   # With Supabase CLI (local)
   supabase db push

   # Or manually run each file in order:
   #   supabase/migrations/20260326000001_create_projects.sql
   #   supabase/migrations/20260326000002_create_assets.sql
   #   supabase/migrations/20260326000003_create_project_events.sql
   #   supabase/migrations/20260326000004_create_storage.sql
   #   supabase/migrations/20260326000005_add_intake_processing.sql
   #   supabase/migrations/20260326000006_create_jobs.sql
   #   supabase/migrations/20260326000007_jobs_insert_policy.sql
   ```

3. Configure environment variables in `apps/portal/.env.local`:
   ```bash
   cp apps/portal/.env.example apps/portal/.env.local
   # Edit with your Supabase project URL and anon key
   ```

### Environment Variables

**Portal** (`apps/portal/.env.local`):

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (passed to spawned worker) |
| `DISCORD_WEBHOOK_URL` | No | Discord webhook for lifecycle notifications |
| `NEXT_PUBLIC_PORTAL_URL` | No | Portal URL for notification links (default: http://localhost:3100) |
| `RESEND_API_KEY` | No | Required for outbound prospect outreach via Resend |
| `RESEND_FROM_EMAIL` | No | Preferred From address for outreach emails (for production: `support@skillkraftz.com`) |
| `RESEND_FROM_NAME` | No | Display name for outbound outreach emails (defaults to `Skillkraftz Support`) |
| `RESEND_REPLY_TO` | No | Optional reply-to address for outreach emails |
| `RESEND_WEBHOOK_SECRET` | No | Required only when receiving Resend webhook events at `/api/webhooks/resend` |
| `OUTREACH_FROM_EMAIL` | No | Legacy fallback From address if `RESEND_FROM_EMAIL` is unset |

**Worker** (`apps/worker/.env`) — loaded automatically by `run-job.ts` via dotenv:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL (note: no `NEXT_PUBLIC_` prefix) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (bypasses RLS) |
| `DISCORD_WEBHOOK_URL` | No | Discord webhook for build/review notifications |
| `NEXT_PUBLIC_PORTAL_URL` | No | Portal URL for notification links |

When launched from the portal, the worker inherits env vars from the portal process. When run manually (`node apps/worker/dist/run-job.js <id>`), it loads `apps/worker/.env`.

### Outreach Readiness

Outbound outreach stays operator-controlled, but it now validates configuration before any send attempt reaches Resend.

Required portal env vars for outreach:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` or `OUTREACH_FROM_EMAIL`
- `RESEND_FROM_NAME` is optional and defaults to `Skillkraftz Support`
- `RESEND_REPLY_TO` is optional
- `RESEND_WEBHOOK_SECRET` is required for signed webhook ingestion once deployed
- `NEXT_PUBLIC_PORTAL_URL`

Operators can review current readiness in the portal at `/dashboard/settings/outreach`.

### Deployment Readiness

The portal is not fully deployment-automated yet, but the repo now includes a deployment readiness surface at `/dashboard/settings/deployment`.

Production assumptions for the portal:

- public base URL: `https://vaen.space`
- auth callback URL: `https://vaen.space/auth/callback`
- Resend webhook URL: `https://vaen.space/api/webhooks/resend`

Required envs for a real hosted portal:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_PORTAL_URL=https://vaen.space`

Recommended for live outreach/webhook behavior:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL=support@skillkraftz.com`
- `RESEND_FROM_NAME=Skillkraftz Support`
- `RESEND_REPLY_TO`
- `RESEND_WEBHOOK_SECRET`

Important operational note:

- downstream generation/export/deployment rely on the active revision request payload and exported `client-request.json`, not just visible project form state
- verify Business Details and Request Data (JSON) are in sync on project detail before trusting deploy/generate artifacts

### Discord Notifications (Optional)

1. Create a webhook in your Discord server (Server Settings > Integrations > Webhooks)
2. Copy the webhook URL to `DISCORD_WEBHOOK_URL` in `.env.local`

When a new intake is submitted, a notification with project details is sent to the configured channel.

## Commands

### Portal (vaen.space)

```bash
# Development server on port 3100
pnpm --filter @vaen/portal dev

# Production build
pnpm --filter @vaen/portal build
pnpm --filter @vaen/portal start
```

### Generator + Review

```bash
# Build all packages
pnpm build

# Generate a site from a target slug
pnpm -w generate -- --target flower-city-painting --modules maps-embed,manual-testimonials

# Generate with explicit paths
pnpm -w generate -- --template service-core --input <path-to-client-request.json> --output <output-dir>

# Capture review screenshots
pnpm -w review -- --target flower-city-painting

# Run a generated site locally
cd generated/flower-city-painting/site && npm install && npm run dev
```

### Full End-to-End Flow

```bash
pnpm install && pnpm build
pnpm -w generate -- --target flower-city-painting --modules maps-embed,manual-testimonials
pnpm -w review -- --target flower-city-painting
ls generated/flower-city-painting/artifacts/screenshots/
```

## Database Schema

The portal uses four main tables plus a storage bucket:

| Table | Purpose |
|-------|---------|
| `projects` | Client website projects with name, slug, status, contact info, notes |
| `assets` | File references linking uploaded files to projects |
| `project_events` | Audit trail for state transitions and actions |
| `jobs` | Worker-executed pipeline jobs with status, payload, result, stdout/stderr |

Storage bucket `intake-assets` holds uploaded files organized as `{user_id}/{project_id}/{filename}`.

All tables have Row Level Security (RLS) policies ensuring users can only access their own data.

See `supabase/migrations/` for complete schema definitions.

## Intake Processing Flow

The portal is the primary workflow hub. Each project has a **Workflow Panel** showing the current status, available actions, and artifact state.

**Intake phase:**
1. **Process** — Generates client summary, draft `client-request.json`, missing info, and template/module recommendations
2. **Edit** — Textarea-based build-prep editing: notes/transcript, services (one per line), about, branding, target customer, goals, service area, AI notes
3. **Review files** — View uploaded files via signed URLs, or remove them
4. **Approve** — Validates: services non-empty, business type set, at least one contact method
5. **Export** — Writes the `draft_request` as `client-request.json` to `generated/<slug>/`

**Build phase (Phase 3):**
6. **Generate Site** — Portal dispatches a `generate` job to the worker, which runs the generator CLI asynchronously
7. **Build & Review** — Portal dispatches a `review` job to the worker, which builds the site and captures Playwright screenshots

The Workflow Panel shows:
- **Job status** — Active/recent jobs with status badges, timing, expandable logs (stdout/stderr)
- **Artifact status** — client-request.json, workspace, build, screenshots on disk
- **Screenshot viewer** — Inline display of captured PNGs (load-on-click)

Jobs are non-blocking: portal creates a DB record, spawns the worker as a detached process, and polls for completion.

## Portal Auth Flow

1. User visits vaen.space → redirected to `/login` if not authenticated
2. Sign in with email/password (or create account)
3. Middleware protects all `/dashboard/*` routes
4. Session managed via Supabase Auth cookies (auto-refresh via middleware)
5. Sign out clears session and redirects to login

## Architecture Docs

- [Roadmap](docs/architecture/roadmap.md) — Vision, phases, and status
- [Progress](docs/architecture/progress.md) — Detailed checklist and structural notes
- [Target Model](docs/architecture/target-model.md) — Slug-based path resolution and lifecycle
- [Job Model](docs/architecture/job-model.md) — Pipeline job types and execution
- [Artifact Flow](docs/architecture/artifact-flow.md) — What each pipeline step produces/consumes
- [Local Testing](docs/architecture/local-testing.md) — End-to-end dev workflow
- [Integrations](docs/architecture/integrations.md) — External service connections

## What's Next

- Deployment pipeline (portal-triggered deploy)
- Worker polling daemon (replace per-job spawn with long-running process)
- Worker VM for isolated builds (BullMQ + Firecracker)
- Additional templates and modules
