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
- [x] Updated docs and README

## Developer Commands

| Task | Command |
|------|---------|
| Build all packages | `pnpm build` |
| Run portal dev server | `pnpm --filter @vaen/portal dev` |
| Generate a site | `pnpm -w generate -- --target <slug>` |
| Capture screenshots | `pnpm -w review -- --target <slug>` |
| Run generated site | `cd generated/<slug>/site && npm install && npm run dev` |

## Structural Notes

### Portal (apps/portal)
Next.js 15 App Router with `src/` directory:
- `src/app/` — Pages and layouts
- `src/app/dashboard/projects/[id]/actions.ts` — Intake processing, approval, export server actions
- `src/app/dashboard/projects/[id]/intake-actions.tsx` — Client components for action buttons
- `src/lib/supabase/` — Client (browser) and server Supabase utilities
- `src/lib/discord.ts` — Webhook notification
- `src/lib/intake-processor.ts` — Intake processing: summary, draft request, missing info, recommendations
- `src/lib/types.ts` — Database row types (Project, Asset, ProjectEvent, MissingInfoItem, IntakeRecommendations)
- `src/middleware.ts` — Auth route protection

Database migrations in `supabase/migrations/`:
1. `20260326000001_create_projects.sql` — Projects table with RLS
2. `20260326000002_create_assets.sql` — Assets table with RLS
3. `20260326000003_create_project_events.sql` — Events table with RLS
4. `20260326000004_create_storage.sql` — Storage bucket and policies
5. `20260326000005_add_intake_processing.sql` — Intake processing columns

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
