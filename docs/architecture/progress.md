# vaen Progress

## Checklist

### v0 Foundation
- [x] Monorepo foundation (pnpm workspace, tsconfig, .gitignore)
- [x] Directory structure created
- [x] Architecture docs
- [x] packages/schemas — JSON schemas + TS types + validation
  - [x] Subpath exports: client-request, build-manifest, deployment-payload
  - [x] Per-artifact README documentation
- [x] packages/shared — Shared target resolution, job model, state flow, artifact lifecycle
  - [x] Target resolution (`resolveTarget()` with canonical path derivation)
  - [x] Job/task model (7 job types with typed payloads)
  - [x] Client lifecycle state machine (19 states with validated transitions)
  - [x] Artifact lifecycle definitions (7 artifact types with producer/consumer tracking)
  - [x] Subpath exports: target, jobs, state, artifacts
- [x] packages/template-registry — template manifest format + 3 manifests
- [x] packages/module-registry — module manifest format + 4 manifests
- [x] templates/service-core — working Next.js template (top-level app/ layout)
- [x] modules/maps-embed — map embed component
- [x] modules/manual-testimonials — testimonials component
- [x] packages/generator — CLI tool with `--target` flag support
- [x] packages/review-tools — Playwright screenshots + playwright.config.ts
- [x] examples/fake-clients/flower-city-painting
- [x] End-to-end: generate → build → review working
- [x] apps/intake-bot — Scaffolded with intake flow model + finalization
- [x] apps/worker — Scaffolded with pipeline runner + job handlers

### Phase 1 — Portal Intake (vaen.space)
- [x] apps/portal — Next.js 15 App Router application
- [x] Supabase auth integration (email/password)
- [x] Next.js middleware for route protection
- [x] Login page with sign-in / sign-up toggle
- [x] Auth callback handler
- [x] Protected dashboard layout with header and sign-out
- [x] Dashboard — project list with status badges
- [x] New intake form — name, slug (auto-generated), contact info, notes
- [x] File uploads — images, audio, documents to Supabase Storage
- [x] Project detail page — info, uploaded files, activity log
- [x] Discord webhook notification on intake submit
- [x] Database migrations (projects, assets, project_events)
- [x] Storage bucket migration (intake-assets with RLS)
- [x] Row Level Security on all tables
- [x] Database types (`src/lib/types.ts`)
- [x] Environment variable documentation (`.env.example`)
- [x] Root README.md with full setup guide
- [x] Updated architecture docs

### Phase 2 — Intake Processing & Approval
- [x] Fix file upload UX — incremental file selection with deduplication
- [x] Fix Discord portal link — strip trailing slash from NEXT_PUBLIC_PORTAL_URL
- [x] Extended state model — 6 new intake processing states in @vaen/shared
- [x] Database migration — client_summary, draft_request, missing_info, recommendations columns
- [x] Intake processor — generates client summary, draft client-request.json, missing-info analysis
- [x] Template/module recommendation engine — rule-based selection from intake data
- [x] Processing action — triggers intake processing from project detail page
- [x] Approval workflow — approve, request revision, mark custom quote actions
- [x] Export to generator — writes approved client-request.json to target path
- [x] Evolved project detail page — shows summary, draft, missing info, recommendations, actions
- [x] Updated dashboard badges for new states

### Phase 2b — Review/Edit Loop Completion
- [x] Fix review script — removed hardcoded flower-city-painting references
- [x] Fix template config warning — added stub config.json to service-core template
- [x] Inline editing of all project fields (business type, contact, notes)
- [x] Services editor — add/remove services directly in the portal, saved to draft_request
- [x] Draft request JSON editor — raw JSON editing for power users
- [x] File viewing — signed URLs open files in browser (images, PDFs, etc.)
- [x] File removal — delete files from storage and DB
- [x] Improved intake processor — better service extraction from prose, business-type inference
- [x] Approval validation — blocks when services empty, business type missing, or no contact
- [x] Export validation — blocks when services are empty
- [x] Updated docs and README

### Phase 3a — Portal Automation Start
- [x] Workflow panel — dedicated status-aware action surface on project detail page
- [x] Phase indicator — visual intake/build/deploy/done progress
- [x] Textarea-based build-prep editing — notes, services, about, branding, target customer, goals, service area, AI notes
- [x] Portal-triggered generation — `generateSiteAction` runs generator CLI via `execSync`
- [x] Portal-triggered review — `runReviewAction` runs build + screenshot capture via `execSync`
- [x] Artifact status visibility — `getArtifactStatusAction` checks disk for client-request.json, workspace, build, screenshots
- [x] Status-aware action availability — buttons enable/disable based on current project status
- [x] Editable client summary — textarea editing of generated summary
- [x] Architecture direction: portal as primary operating surface, Discord as assistive channel
- [x] Updated docs and README

### Phase 3b — Worker-Oriented Architecture
- [x] Database migration — `jobs` table with status, payload, result, stdout, stderr
- [x] Worker job runner — `apps/worker/src/run-job.ts`, executes a claimed job by ID
- [x] Worker Supabase integration — service role key for DB access (bypasses RLS)
- [x] Portal job dispatch — `generateSiteAction` and `runReviewAction` create job records
- [x] Non-blocking automation — portal returns immediately after dispatching, polls for status
- [x] Job status API — `getProjectJobsAction`, `getJobStatusAction` for UI polling
- [x] Job status panel — expandable job list with status badges, timing, result messages
- [x] Job log viewer — stdout/stderr display with toggle, dark-themed log pane
- [x] Inline screenshot viewer — load-on-click PNGs via base64 data URLs from `getScreenshotAction`
- [x] Intake field enrichment — `resolve-config.ts` reads `_intake.*` fields (about, branding, goals, targetCustomer, serviceArea) and `preferences.notes`
- [x] Discord multi-event notifications — portal: processed, approved, revision, exported; worker: generated, reviewed, failed
- [x] Worker environment config — `.env.example` with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- [x] Updated docs and README

### Phase 3c — Supabase-Polled Worker Backbone
- [x] Atomic job claiming via `claim_next_job()` and `FOR UPDATE SKIP LOCKED`
- [x] Long-running worker poller — `apps/worker/src/poll.ts`
- [x] Worker heartbeat table — `worker_heartbeats`
- [x] Heartbeat freshness helpers in portal
- [x] Portal normal path decoupled from direct local child-process spawn
- [x] Local direct spawn retained only as an opt-in dev fallback (`VAEN_ENABLE_LOCAL_WORKER_SPAWN`)

### Phase 3b Fix — Target Path Resolution
- [x] Canonical path fix — `resolveTarget()` defaults to `generated/<slug>/client-request.json` (was `examples/fake-clients/`)
- [x] Portal export writes to `generated/<slug>/client-request.json`
- [x] Portal generate/artifact actions check `generated/<slug>/`
- [x] Generator CLI fallback — tries `examples/fake-clients/<slug>/` if canonical missing (backward compat for hand-crafted examples)
- [x] Worker `resolveRepoRoot()` fix — 3 levels up from `dist/` (was 4, off-by-one)
- [x] Worker passes `--input <canonical-path>` explicitly to generator CLI
- [x] Worker `.env` auto-loading via dotenv (script-relative path)
- [x] Jobs INSERT RLS policy (migration 7) — users can create jobs for own projects
- [x] Target model documentation (`docs/architecture/target-model.md`)

### Phase 4 — Sales Ops, Governance, and Campaign Automation
- [x] Clients as first-class records with project linkage and snapshot-based intake creation
- [x] Project archive / restore / guarded purge
- [x] Project duplication / variants with lineage and reset downstream artifacts
- [x] Authoritative project-level selected modules with revision/staleness integration
- [x] Pricing model, quote creation, quote lifecycle, and contract creation
- [x] Audited in-app pricing settings
- [x] Prospects, website analysis, conversion into clients/projects, and automation levels
- [x] Outreach package generation and explicit Resend-backed outreach execution
- [x] Outreach readiness/config hardening and green full portal Vitest signal
- [x] Campaigns, bulk prospect import, bulk analyze, bulk convert, and controlled batch outreach
- [x] Role foundation (`viewer < sales < operator < admin`)
- [x] High-risk role gating (pricing writes, purge, batch outreach)
- [x] Approval workflow for large discounts, batch outreach, and project purge
- [x] Campaign sequence builder (S1)
- [x] Campaign sequence execution with explicit “advance due follow-ups” (S2)
- [x] Analytics dashboard at `/dashboard/analytics`
- [x] Team settings scaffold at `/dashboard/settings/team`
- [x] Campaign-detail analytics card row
- [x] Manual reply workflow foundation with reply history and sequence-safe pause behavior
- [x] AI prospect enrichment foundation with persisted business summary, package recommendation, opportunity analysis, and reusable offer positioning

## Developer Commands

| Task | Command |
|------|---------|
| Build all packages | `pnpm build` |
| Run portal dev server | `pnpm --filter @vaen/portal dev` |
| Generate a site | `pnpm -w generate -- --target <slug>` |
| Capture screenshots | `pnpm -w review -- --target <slug>` |
| Run worker poller | `pnpm --filter @vaen/worker poll` |
| Run a worker job | `pnpm -w worker:run-job -- <job-id>` |
| Run generated site | `cd generated/<slug>/site && npm install && npm run dev` |

## Structural Notes

### Portal (apps/portal)
Next.js 15 App Router with `src/` directory:
- `src/app/` — Pages and layouts
- `src/app/dashboard/projects/[id]/actions.ts` — Server actions: process, approve, revise, export, edit, file ops, job dispatch (generate/review), job status queries, screenshot serving
- `src/app/dashboard/projects/[id]/intake-actions.tsx` — WorkflowPanel: status-aware actions, job status panel with log viewer, inline screenshot viewer
- `src/app/dashboard/projects/[id]/project-editor.tsx` — BuildInputsEditor (textarea fields), SummaryEditor, FileManager, DraftRequestEditor
- `src/lib/supabase/` — Client (browser) and server Supabase utilities
- `src/lib/discord.ts` — Webhook notifications (intake_received, processed, approved, revision, exported)
- `src/lib/intake-processor.ts` — Intake processing: summary, draft request, missing info, recommendations
- `src/lib/types.ts` — Database row types (Project, Asset, ProjectEvent, JobRecord, MissingInfoItem, IntakeRecommendations)
- `src/middleware.ts` — Auth route protection

Database migrations in `supabase/migrations/`:
1. `20260326000001_create_projects.sql` — Projects table with RLS
2. `20260326000002_create_assets.sql` — Assets table with RLS
3. `20260326000003_create_project_events.sql` — Events table with RLS
4. `20260326000004_create_storage.sql` — Storage bucket and policies
5. `20260326000005_add_intake_processing.sql` — Intake processing columns
6. `20260326000006_create_jobs.sql` — Jobs table for worker-executed pipeline jobs
7. `20260326000007_jobs_insert_policy.sql` — INSERT RLS policy for jobs (project ownership check)

### Shared package layout
`packages/shared/src/` contains four modules:
- `target.ts` — `resolveTarget()` for canonical path derivation
- `jobs.ts` — `JobType`, `Job`, `Pipeline` types and `DEFAULT_PIPELINE`
- `state.ts` — `TargetState` enum, `STATE_TRANSITIONS`, `advanceState()`
- `artifacts.ts` — `ArtifactDefinition`, `ARTIFACT_DEFINITIONS`, producer/consumer queries

### Schema layout
Schemas live in `packages/schemas/src/` and compile to `packages/schemas/dist/src/`.
Each artifact also has a dedicated subpath directory for re-exports + README.

### Template layout
The `service-core` template uses Next.js App Router with a **top-level `app/` directory** (not nested under `src/`). The `lib/` directory is also at the top level. The `@/*` tsconfig path alias maps to the project root (`./`).

### Generated workspace layout
Each generated workspace (`generated/<slug>/`) contains:
- `site/` — the Next.js project
- `build-manifest.json` — resolved build plan
- `claude-brief.md` — AI review brief
- `deployment-payload.json` — deployment config
- `artifacts/screenshots/` — Playwright screenshots
- `README.md` — workspace instructions
- `package.json` — convenience scripts proxying into site/
