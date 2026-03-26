# vaen

Website factory that takes client intake and turns it into deployed local business websites through a deterministic build pipeline.

## Architecture

```
apps/
  portal/          vaen.space — authenticated intake portal (Next.js + Supabase)
  intake-bot/      Discord bot for conversational intake (scaffolded)
  worker/          Background job runner for pipeline execution (scaffolded)

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
| **Phase 2 Processing** | **Intake processing, approval workflow, generator export, missing-info detection, recommendations** | **Complete** |
| Phase 3 | Intake bot, worker automation, deployment pipeline | Planned |

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
   ```

3. Configure environment variables in `apps/portal/.env.local`:
   ```bash
   cp apps/portal/.env.example apps/portal/.env.local
   # Edit with your Supabase project URL and anon key
   ```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous/public key |
| `DISCORD_WEBHOOK_URL` | No | Discord webhook for intake notifications |
| `NEXT_PUBLIC_PORTAL_URL` | No | Portal URL for notification links (default: http://localhost:3100) |

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

The portal uses three main tables plus a storage bucket:

| Table | Purpose |
|-------|---------|
| `projects` | Client website projects with name, slug, status, contact info, notes |
| `assets` | File references linking uploaded files to projects |
| `project_events` | Audit trail for state transitions and actions |

Storage bucket `intake-assets` holds uploaded files organized as `{user_id}/{project_id}/{filename}`.

All tables have Row Level Security (RLS) policies ensuring users can only access their own data.

See `supabase/migrations/` for complete schema definitions.

## Intake Processing Flow

Once an intake is submitted via the portal:

1. **Process** — Click "Process Intake" on the project detail page. Generates:
   - Client summary (markdown overview of the project)
   - Draft `client-request.json` (mapped to the schema)
   - Missing info report (required/recommended/optional fields)
   - Template + module recommendations (rule-based)
2. **Review** — Review the draft, missing info, and recommendations
3. **Approve / Revise / Custom Quote** — Move the intake forward or send it back
4. **Export** — Click "Export to Generator" to write `client-request.json` to the target path
5. **Generate** — Run `pnpm -w generate -- --target <slug>` to create the workspace

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

## What's Next (Phase 3)

- Discord intake bot with OpenClaw AI conversational flow
- Worker VM for isolated build execution
- Portal ops features: screenshot viewer, deployment triggers
- vaen.space deployment pipeline
- Additional templates and modules
