# @vaen/portal — vaen.space

Authenticated operations portal for the vaen website factory. It now covers intake, project automation, pricing and quotes, prospects, campaigns, approvals, sequencing, and analytics.

**Status:** Core portal workflow, sales ops, governance, campaign sequencing, campaign-detail analytics, deployment readiness, and deployment run control-plane foundations are implemented. The main remaining work is deeper automation continuation, broader team-management polish, and real provider deployment orchestration.

## Tech Stack

- **Next.js 15** (App Router) — server components, server actions, middleware
- **Supabase** — auth, PostgreSQL database, file storage
- **Discord** — webhook notifications on intake

## Pages

| Route | Description |
|-------|-------------|
| `/` | Redirect to dashboard or login |
| `/login` | Email/password sign in and sign up |
| `/dashboard` | Project list with status badges |
| `/dashboard/new` | New intake form with file uploads |
| `/dashboard/projects/[id]` | Project detail with processing, approval, and export |
| `/dashboard/prospects` | Prospect list, import, and detail workflow |
| `/dashboard/campaigns` | Campaign list and campaign detail operations |
| `/dashboard/settings/pricing` | Admin pricing settings |
| `/dashboard/settings/outreach` | Outreach readiness and config status |
| `/dashboard/settings/deployment` | Deployment readiness and production URL/callback checks |
| `/dashboard/settings/team` | Admin team role management scaffold |
| `/dashboard/approvals` | Admin approval queue |
| `/dashboard/analytics` | Sales and campaign analytics dashboard |

## Setup

1. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

2. Configure Supabase credentials in `.env.local`

3. Apply database migrations (from repo root):
   ```bash
   supabase db push
   ```

4. Run the portal:
   ```bash
   pnpm dev     # Development on port 3100
   pnpm build   # Production build
   pnpm start   # Production server on port 3100
   ```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `DISCORD_WEBHOOK_URL` | No | Discord webhook for notifications |
| `NEXT_PUBLIC_PORTAL_URL` | No | Portal URL for links in notifications |
| `RESEND_API_KEY` | No | Required for outbound outreach execution via Resend |
| `RESEND_FROM_EMAIL` | No | Preferred From address for outreach sends |
| `RESEND_FROM_NAME` | No | Display name for outreach sends (defaults to `Skillkraftz Support`) |
| `RESEND_REPLY_TO` | No | Optional reply-to address for outreach sends |
| `RESEND_WEBHOOK_SECRET` | No | Required only for signed Resend webhook ingestion at `/api/webhooks/resend` |
| `OUTREACH_FROM_EMAIL` | No | Legacy fallback From address if `RESEND_FROM_EMAIL` is unset |

Outbound outreach readiness is visible in the portal at `/dashboard/settings/outreach`. Missing config blocks send attempts before they reach Resend.

Deployment readiness is visible in the portal at `/dashboard/settings/deployment`. It checks the base URL, auth callback expectation, webhook target expectation, Supabase runtime envs, and repo-level deployment payload support.

That page now also shows worker heartbeat status and a small VM setup checklist. The full operational runbook for a remote worker lives at `docs/architecture/worker-vm-runbook.md`.

Project pages now also support tracked deployment runs from authoritative revision/export/build state. Those runs validate `deployment-payload.json` and record history without pretending provider automation is finished.

## Request Truth Model

Old model:
- project editing and exports historically leaned on `draft_request` / `final_request`

Current model:
- the active revision in `project_request_revisions` is the authoritative request payload
- project business/contact edits must sync into that revision-backed request data
- exports, generation, prompt export, and deployment preparation read from the active revision
- `draft_request` is still kept as a compatibility shadow for legacy paths
- `final_request` is deprecated and no longer treated as a live request source

## Database

Tables (see `supabase/migrations/` for full SQL):

| Table | Purpose |
|-------|---------|
| `projects` | Core entity — name, slug, status, contact info, notes |
| `assets` | File references — file name, type, size, storage path, category |
| `project_events` | Audit trail — event type, status transitions, metadata |

Storage bucket: `intake-assets` (private, user-scoped paths)

## Auth Flow

- Email/password auth via Supabase Auth
- Next.js middleware protects `/dashboard/*` routes
- Cookie-based session with automatic refresh
- Sign up creates account, sign in starts session

## Intake Flow

1. User clicks "New Intake" from dashboard
2. Fills out project name, slug (auto-generated), contact info, notes
3. Attaches files (images, audio, documents)
4. On submit:
   - Project record created in DB
   - Files uploaded to Supabase Storage
   - Asset records created
   - Project event logged
   - Discord notification sent
5. Redirected to project detail page

## File Structure

```
src/
  app/
    layout.tsx              Root layout
    page.tsx                Redirect logic
    globals.css             Portal styles
    login/page.tsx          Auth form
    auth/callback/route.ts  Auth callback handler
    dashboard/
      layout.tsx            Protected layout with header
      page.tsx              Project list
      new/
        page.tsx            Intake form (incremental file selection)
        actions.ts          Server action: create project + upload files
      projects/[id]/
        page.tsx            Project detail with processing + editing UI
        actions.ts          Server actions: process, approve, revise, quote, export, edit, file ops
        intake-actions.tsx  Client components for workflow action buttons
        project-editor.tsx  Client components for inline editing, services, files, JSON editor
  lib/
    supabase/
      client.ts             Browser Supabase client
      server.ts             Server Supabase client
    discord.ts              Webhook notification
    intake-processor.ts     Intake processing: summary, draft, missing info, recommendations
    types.ts                Database row types + processing types
  middleware.ts             Auth route protection
```

## Intake Processing

The project detail page supports the full intake processing and review workflow:

1. **Process Intake** — Generates client summary, draft request, missing info, recommendations
2. **Edit** — All fields editable inline: business type, contact info, notes, services, draft request JSON
3. **File Management** — View files via signed URLs (opens in browser), remove files (deletes from storage + DB)
4. **Approve** — Validates: services non-empty, business type set, at least one contact method
5. **Request Revision / Custom Quote** — Loop back for more info
6. **Export to Generator** — Validates services, writes approved client-request.json to target path

Server actions in `actions.ts`: `processIntakeAction`, `approveIntakeAction`, `requestRevisionAction`, `markCustomQuoteAction`, `exportToGeneratorAction`, `updateProjectAction`, `updateDraftRequestAction`, `getAssetUrlAction`, `deleteAssetAction`.

Legacy compatibility columns still present on `projects`: `draft_request`, `final_request`.
Authoritative request state now lives in `project_request_revisions` plus `current_revision_id`.

New states: `intake_processing`, `intake_draft_ready`, `intake_needs_revision`, `intake_approved`, `custom_quote_required`.

## Next Phase

- Automation continuation after async generate/review boundaries
- Broader team management and role administration UI
- Provider deployment adapters and operational release controls
