# vaen v0 Roadmap

## Vision

vaen is a website factory that takes messy client intake and turns it into deployed local business websites through a deterministic build pipeline.

## Architecture Layers

### 1. Shared Layer (`packages/shared`)
Core abstractions used by every layer of the pipeline:
- **Target resolution** — Canonical path derivation from a target slug (`resolveTarget()`)
- **Job/task model** — Typed job definitions for each pipeline step (`JobType`, `Job`, `Pipeline`)
- **Client lifecycle** — State machine for target progression (`TargetState`, `advanceState()`)
- **Artifact lifecycle** — Formal definitions of what each pipeline step produces and consumes

Exposed via `@vaen/shared` with subpath exports: `@vaen/shared/target`, `@vaen/shared/jobs`, `@vaen/shared/state`, `@vaen/shared/artifacts`.

### 2. Artifact Layer (`packages/schemas`)
Defines the canonical data shapes that flow through the pipeline:
- **client-request.json** — Raw intake data from a client (business info, preferences, content)
- **build-manifest.json** — Resolved build plan: which template, which modules, what config
- **deployment-payload.json** — Everything needed to deploy: built assets, DNS config, metadata
- **claude-brief.md** — Human-readable summary for AI-assisted review/refinement

Schemas are defined in `packages/schemas/src/` and exposed via both the main export (`@vaen/schemas`) and per-artifact subpath exports:
- `@vaen/schemas/client-request`
- `@vaen/schemas/build-manifest`
- `@vaen/schemas/deployment-payload`

### 3. Template Layer (`templates/`, `packages/template-registry`)
Templates are full Next.js site scaffolds that are config-driven:
- **service-core** — General local business (painter, plumber, landscaper)
- **service-area** — Multi-location variant (manifest only)
- **authority** — Professional services / thought leadership (manifest only)

The `service-core` template uses Next.js App Router with a top-level `app/` directory layout:
```
templates/service-core/
  app/              ← Next.js App Router pages
    layout.tsx
    page.tsx
    globals.css
    contact/
      page.tsx
  lib/              ← Shared utilities (site-config loader)
    site-config.ts
  config.json       ← Injected by generator at build time
  package.json
  tsconfig.json
  next.config.ts
```

### 4. Module Layer (`modules/`, `packages/module-registry`)
Modules are drop-in features that templates can consume:
- **maps-embed** — Google Maps iframe (implemented)
- **manual-testimonials** — Static testimonials from intake (implemented)
- **google-reviews-live** — Live Google Reviews via API (manifest only)
- **booking-lite** — Calendar/scheduling embed (manifest only)

### 5. Generator Layer (`packages/generator`)
CLI tool that assembles everything:
1. Reads client-request.json (via target resolution or explicit paths)
2. Validates against schema
3. Resolves template + modules via registries
4. Copies template scaffold to output workspace
5. Injects client config as config.json
6. Outputs build-manifest.json, claude-brief.md, deployment-payload.json
7. Generates workspace scaffolding (README, wrapper package.json, artifacts dir)

Invoked via:
- `pnpm -w generate -- --target <slug>` (recommended — uses shared target resolution)
- `pnpm -w generate -- --template <id> --input <path> --output <path>` (explicit mode)

### 6. Review Layer (`packages/review-tools` + `scripts/review.sh`)
Automated QA via Playwright screenshots for visual review.

Configuration lives in `packages/review-tools/playwright.config.ts` and defines:
- Desktop viewport (1440x900)
- Mobile viewport (375x812)
- Pages captured: homepage (`/`) and contact (`/contact`)

Invoked via: `pnpm -w review -- --target <slug>`

### 7. Portal Layer (`apps/portal` — vaen.space)
The authenticated intake front door. Built with Next.js + Supabase:
- **Auth** — Email/password via Supabase Auth, middleware-protected routes
- **Dashboard** — Project list with status badges, new intake button
- **Intake form** — Project creation with file uploads to Supabase Storage
- **Project detail** — Info, uploaded files, activity log
- **Discord notifications** — Webhook on intake submit
- **Database** — PostgreSQL via Supabase (projects, assets, project_events tables with RLS)
- **Storage** — Supabase Storage bucket `intake-assets` with user-scoped paths

### 8. Worker Layer (`apps/worker`)
Background job runner. Portal creates a job record in the DB, and a long-running worker
poller claims pending jobs from Supabase. The worker executes them (generate or review
via child_process.spawn), captures stdout/stderr, writes results back to the DB, and
updates worker heartbeats for health visibility.

Entrypoints:
- `poll.ts` — Long-running Supabase poller + heartbeat writer
- `run-job.ts` — Execute a single job by ID (used by the poller and local fallback)
- `db.ts` — Supabase client using service role key (bypasses RLS)
- `handlers.ts` — Job handler registry (v0 built-in handlers)
- `pipeline.ts` — Sequential pipeline runner with lifecycle callbacks

Architecture boundary: portal = requests work, worker = executes work, DB = truth.

### 9. App Layer (scaffolded)
- **intake-bot** (`apps/intake-bot`) — Conversational intake flow with step-by-step state machine. Validates and writes client-request.json. v1: Discord bot with OpenClaw AI.

## Pipeline Flow

```
client-request.json
  ↓ intake_parse
  ↓ workspace_generate → site/ + build-manifest.json + claude-brief.md
  ↓ site_build → site/.next/
  ↓ validate_build
  ↓ capture_screenshots → artifacts/screenshots/
  ↓ prepare_deploy_payload → deployment-payload.json
  ↓ deploy_validate
```

## Target Lifecycle

```
intake_received → intake_processing → intake_draft_ready
  → intake_approved → intake_parsed → awaiting_review → template_selected
  → workspace_generated → build_in_progress → review_ready
  → deploy_ready → deploying → deployed → managed
```

Branch states:
- `intake_draft_ready` → `intake_needs_revision` → `intake_processing` (revision loop)
- `intake_draft_ready` → `custom_quote_required` → `intake_approved` or `intake_needs_revision`
- `build_failed` → `build_in_progress` (retry)
- `deploy_failed` → `deploying` (retry)

## Scope and Status

### v0 Foundation (complete)

| Component | Status |
|-----------|--------|
| packages/shared | Complete |
| packages/schemas | Complete |
| packages/template-registry | Complete |
| packages/module-registry | Complete |
| packages/generator | Complete |
| packages/review-tools | Complete |
| templates/service-core | Complete |
| modules/maps-embed | Complete |
| modules/manual-testimonials | Complete |
| examples/fake-clients | Complete |

### Phase 1 — Portal Intake (complete)

| Component | Status |
|-----------|--------|
| apps/portal (Next.js + Supabase) | Complete |
| Supabase auth (email/password) | Complete |
| Protected dashboard | Complete |
| New intake form + file uploads | Complete |
| Database schema + migrations | Complete |
| Storage bucket + policies | Complete |
| Discord webhook notifications | Complete |
| apps/intake-bot | Scaffolded |
| apps/worker | Scaffolded |

### Phase 2 — Intake Processing & Approval (complete)

| Component | Status |
|-----------|--------|
| File upload UX fix (append, not replace) | Complete |
| Discord link fix (trailing slash) | Complete |
| Extended state model (6 new states) | Complete |
| Intake processing migration | Complete |
| Intake processor (summary, draft, missing info, recommendations) | Complete |
| Approval workflow (approve, revise, custom quote) | Complete |
| Export to generator handoff | Complete |
| Evolved project detail page | Complete |
| Inline editing of all project fields | Complete |
| Services editor (add/remove, saved to draft_request) | Complete |
| Draft request JSON editor | Complete |
| File viewing (signed URLs) | Complete |
| File removal (storage + DB) | Complete |
| Approval validation (services, business type, contact) | Complete |
| Improved service extraction (prose, business-type inference) | Complete |
| Template config.json warning fix | Complete |
| Review script hardcoded references fix | Complete |

### Phase 3 — Portal Automation (in progress)

**Architecture direction:** The portal is the primary workflow hub. Discord/OpenClaw is an assistive channel (alerts, quick commands, status links) — not the main process driver. The worker is the only process that executes pipeline commands; the portal dispatches jobs and reads results.

| Component | Status |
|-----------|--------|
| Workflow panel (status-aware action surface) | Complete |
| Textarea-based build-prep editing | Complete |
| Portal-triggered site generation (generateSiteAction) | Complete |
| Portal-triggered build & review (runReviewAction) | Complete |
| Artifact status visibility (getArtifactStatusAction) | Complete |
| Phase indicator (intake / build / deploy / done) | Complete |
| Worker job runner (run-job.ts) | Complete |
| Jobs DB table (status, payload, result, stdout, stderr) | Complete |
| Supabase-polled worker dispatch (portal inserts jobs, worker claims) | Complete |
| Worker heartbeat table + poll loop | Complete |
| Job status panel with log viewer | Complete |
| Screenshot viewer in portal (inline base64 PNGs) | Complete |
| Intake field enrichment in generator (_intake.* → siteConfig) | Complete |
| Discord multi-event notifications (5 portal + 4 worker events) | Complete |
| Deployment pipeline (portal-triggered) | Planned |
| Worker VM for isolated builds | Planned |
| Additional templates and modules | Planned |

### Phase 4 — Sales Ops & Governance (mostly complete)

| Component | Status |
|-----------|--------|
| Client-backed project creation | Complete |
| Archive / restore / guarded purge | Complete |
| Project variants / duplication lineage | Complete |
| Authoritative module management | Complete |
| Pricing, quotes, contracts | Complete |
| Audited pricing settings | Complete |
| Prospects and website analysis | Complete |
| Outreach package generation + Resend execution | Complete |
| Outreach readiness/config hardening | Complete |
| Campaigns + bulk import + batch outreach | Complete |
| Role foundation + gated high-risk actions | Complete |
| Approval workflow | Complete |
| Campaign sequence builder | Complete |
| Campaign sequence execution | Complete |
| Analytics dashboard (`/dashboard/analytics`) | Complete |
| Team settings scaffold (`/dashboard/settings/team`) | Complete |
| Campaign-detail analytics row | Complete |
| Manual reply workflow foundation | Complete |
| AI prospect enrichment foundation | Complete |

## Assumptions
- Templates use Next.js (App Router) with top-level `app/` directory for SSG/SSR flexibility
- Portal uses Supabase for auth, database, and storage
- Portal is the primary operating surface for the entire pipeline
- Portal dispatches jobs into Supabase; the worker poller claims and executes them
- Worker uses Supabase service role key for DB access (bypasses RLS)
- Playwright screenshots run against local build server
- Target resolution is the single source of truth for workspace paths
- Job model: DB-backed records, worker claims atomically from Supabase; no external queue yet
