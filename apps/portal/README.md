# @vaen/portal — vaen.space

Authenticated operations portal for the vaen website factory. Serves as the intake front door where projects are created, files uploaded, and intakes tracked.

**Status:** Phase 2 complete — auth, dashboard, intake form, file uploads, Discord notifications, intake processing, approval workflow, generator export.

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
| `OUTREACH_FROM_EMAIL` | No | Preferred From address for outreach sends |
| `RESEND_FROM_EMAIL` | No | Fallback From address if `OUTREACH_FROM_EMAIL` is unset |

Outbound outreach readiness is visible in the portal at `/dashboard/settings/outreach`. Missing config blocks send attempts before they reach Resend.

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

New database columns: `client_summary`, `draft_request`, `missing_info`, `recommendations`.

New states: `intake_processing`, `intake_draft_ready`, `intake_needs_revision`, `intake_approved`, `custom_quote_required`.

## Next Phase

- Screenshot viewer integration
- Deployment trigger from portal
- Search and filtering on dashboard
- Worker automation (Phase 3)
