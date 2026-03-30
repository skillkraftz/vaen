# Hosted Testing Pack

This is the operator pack for tomorrow's hosted test.

Use it when:
- the portal is deployed to Vercel
- a remote worker VM is available
- GitHub/Vercel/domain provider execution is being tested from real portal deployment runs

This pack is intentionally practical. It does not pretend registrar automation, production promotion, or provider webhooks are finished.

## Tomorrow Setup Order

1. Deploy `apps/portal` to Vercel at `https://vaen.space`.
2. Set the portal env vars on Vercel.
3. Configure the Supabase auth callback to `https://vaen.space/auth/callback`.
4. Configure the Resend webhook target to `https://vaen.space/api/webhooks/resend` if outreach webhook testing is in scope.
5. Prepare the worker VM checkout and set worker env vars.
6. Add provider credentials on the worker VM:
   - GitHub
   - Vercel
   - managed-domain env only if subdomain testing is in scope
7. Start the worker poller under `systemd` or `pm2`.
8. Open `/dashboard/settings/deployment` and confirm the worker heartbeat is healthy.
9. Pick a project whose active revision is already exported and generated.
10. Create a deployment run from the project page.
11. Execute providers.
12. Verify GitHub repo URL, Vercel preview URL, and managed subdomain URL if domain testing is configured.

## Env Checklist

### Portal on Vercel

Required:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
NEXT_PUBLIC_PORTAL_URL=https://vaen.space
```

Only if outreach/webhook testing is part of tomorrow:

```bash
RESEND_API_KEY=<resend-api-key>
RESEND_FROM_EMAIL=support@skillkraftz.com
RESEND_FROM_NAME=Skillkraftz Support
RESEND_REPLY_TO=<optional-reply-to>
RESEND_WEBHOOK_SECRET=<webhook-secret>
```

### Worker VM core

Required:

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
WORKER_ID=worker-prod-1
NEXT_PUBLIC_PORTAL_URL=https://vaen.space
```

Only if generator-backed jobs are needed:

```bash
OPENAI_API_KEY=<openai-api-key>
```

### GitHub provider

```bash
GITHUB_TOKEN=<github-token>
GITHUB_ORG=<github-org>
```

### Vercel provider

```bash
VERCEL_TOKEN=<vercel-token>
VERCEL_TEAM_ID=<optional-vercel-team-id>
```

### Managed-domain testing

```bash
DNS_PROVIDER_TOKEN=<vercel-domain-management-token>
VAEN_BASE_DOMAIN=vaen.space
VERCEL_TEAM_ID=<optional-vercel-team-id>
```

Important:
- `DNS_PROVIDER_TOKEN` is currently used against Vercel project-domain and alias APIs.
- It is not a generic registrar-token abstraction.
- Managed-domain testing assumes `VAEN_BASE_DOMAIN` is already added to the Vercel account or team.

## Preflight Commands

Run these before the first hosted test.

### Repo and build preflight

From the repo root:

```bash
pnpm install
pnpm -r build
pnpm --filter @vaen/portal exec vitest run
pnpm --filter @vaen/portal build
```

Expected signals:
- all builds pass
- portal build completes successfully
- no failing portal tests

### Worker VM preflight

On the worker VM:

```bash
cd /opt/vaen
pnpm install
pnpm -r build
pnpm --filter @vaen/review-tools exec playwright install --with-deps chromium
pnpm --filter @vaen/worker poll
```

Expected signals:
- worker process starts without immediate exit
- `worker_heartbeats` receives a fresh row
- `/dashboard/settings/deployment` shows `healthy`

### Portal hosted smoke preflight

From your local machine:

```bash
PORTAL_URL=https://vaen.space \
PORTAL_EMAIL=<operator-email> \
PORTAL_PASSWORD=<operator-password> \
PORTAL_SMOKE_PROJECT_ID=<ready-project-id> \
pnpm --filter @vaen/portal smoke:hosted
```

Optional:

```bash
PORTAL_SMOKE_WAIT_FOR_PROVIDER_REFERENCE=1
PORTAL_SMOKE_PROVIDER_REFERENCE_TIMEOUT_MS=90000
```

Expected signals:
- login succeeds
- deployment settings page loads
- worker heartbeat card is visible
- deployment run can be queued
- provider execution can be queued
- provider reference can be awaited when enabled

## Portal Verification Signals

On `/dashboard/settings/deployment`:
- readiness badge is not blocked by missing portal envs
- auth callback URL shows `https://vaen.space/auth/callback`
- Resend webhook URL shows `https://vaen.space/api/webhooks/resend`
- worker heartbeat is `healthy`

On the project deployment panel:
- `Prepare Deployment` succeeds
- latest run shows `validated` after `deploy_prepare`
- `Execute Providers` queues successfully
- provider summary becomes visible
- provider reference shows:
  - GitHub repo URL
  - Vercel preview deployment URL
  - managed subdomain URL when configured

## Failure Matrix

| Symptom | Likely Cause | What To Check | Next Step |
|--------|--------------|---------------|-----------|
| Worker heartbeat is missing | Worker not running, bad VM env, or bad Supabase connection | `pnpm --filter @vaen/worker poll`, worker logs, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Fix worker env/process first; do not trust pending jobs until `/dashboard/settings/deployment` shows `healthy` |
| Portal login works but redirect/callback fails | Supabase auth callback mismatch | Supabase auth settings, `NEXT_PUBLIC_PORTAL_URL`, deployed host | Set callback to `https://vaen.space/auth/callback` and redeploy if needed |
| Deployment run cannot be created | Active revision/export/build state is stale or missing | Project page: Request Data, export status, generated site status | Re-export/rebuild from the authoritative revision first |
| GitHub succeeds but Vercel fails | Missing `VERCEL_TOKEN`, wrong `VERCEL_TEAM_ID`, or Vercel API rejection | Worker env, provider summary on deployment run | Fix Vercel env or project linkage issue, then queue provider execution again |
| Vercel project already linked to the wrong repo | Existing project ownership/link mismatch | Deployment run error summary, Vercel project settings | Either use the correct repo/project pairing or create a clean Vercel project name/path |
| Domain step is `unsupported` | `payload.domain.customDomain` is outside the managed base domain, or prior Vercel context is missing | Provider summary, deployment payload domain block | Restrict testing to managed subdomains under `VAEN_BASE_DOMAIN` |
| Domain alias API succeeds but URL still does not resolve correctly | Base domain not fully configured in Vercel, propagation delay, or alias mismatch | Vercel domains UI, provider metadata, returned managed URL | Verify `VAEN_BASE_DOMAIN` is already added in Vercel and allow DNS/TLS propagation time |
| Hosted smoke audit fails before project steps | Missing `PORTAL_EMAIL`, `PORTAL_PASSWORD`, or `PORTAL_SMOKE_PROJECT_ID` | Shell env before running `smoke:hosted` | Export the missing variables and rerun |
| Provider execution is queued but no references appear | Worker heartbeat stale, worker crashed, or provider APIs unconfigured | Worker heartbeat card, worker logs, deployment run provider summary | Restore worker, then inspect `not_configured` / `failed` provider messages |
| Resend webhook verification fails in hosted testing | Wrong `RESEND_WEBHOOK_SECRET` or wrong webhook target | `/dashboard/settings/deployment`, Resend webhook config | Set `RESEND_WEBHOOK_SECRET` on Vercel and point Resend to `https://vaen.space/api/webhooks/resend` |

## Manual Boundaries

Still manual tomorrow:
- deploying the portal to Vercel
- setting Vercel env vars
- setting worker VM env vars
- ensuring the worker runs under `systemd` or `pm2`
- ensuring `VAEN_BASE_DOMAIN` is already present in the Vercel scope
- choosing the project used for deployment testing

Still not automated:
- customer custom-domain onboarding
- registrar/DNS-host automation outside Vercel's domain APIs
- production promotion/alias strategy beyond preview + managed subdomain testing
- provider webhooks or long-running deployment-status polling
