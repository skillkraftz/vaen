# Worker VM Runbook

This runbook describes the current, real way to run the vaen worker on a separate VM while the portal is hosted independently on `https://vaen.space`.

It is intentionally narrow:
- the portal creates jobs in Supabase
- the worker polls Supabase and claims jobs
- provider deployment adapters are still stubs unless you implement the real GitHub/Vercel/domain integrations later

## Production assumptions

- Portal URL: `https://vaen.space`
- Portal auth callback: `https://vaen.space/auth/callback`
- Resend webhook target: `https://vaen.space/api/webhooks/resend`
- Portal runtime and worker runtime are separate processes
- Supabase is the shared source of truth for jobs, heartbeats, revisions, deployment runs, and screenshots metadata
- The active revision request payload remains authoritative for export, generation, review, and deployment preparation

## VM requirements

### Runtime versions

- Node.js `>=18`
- pnpm `>=9`

These match the repo engines in the root `package.json`.

### System packages

The worker builds generated Next.js sites and captures screenshots with Playwright Chromium. The VM therefore needs:

- Git
- Node.js and pnpm
- build toolchain needed by generated Next.js sites
- Playwright browser dependencies

Practical install path:

```bash
pnpm install
pnpm -r build
pnpm --filter @vaen/review-tools exec playwright install --with-deps chromium
```

If your distro does not support `--with-deps`, install Chromium/Playwright system dependencies manually first, then rerun the command without `--with-deps`.

## Required environment variables

Create `apps/worker/.env` on the VM.

### Core worker env

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
WORKER_ID=worker-prod-1
NEXT_PUBLIC_PORTAL_URL=https://vaen.space
OPENAI_API_KEY=<required for generator-backed jobs>
```

### Optional notification env

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Optional provider adapter env

These only matter when you start testing `deploy_execute` jobs.

```bash
GITHUB_TOKEN=<github-token>
GITHUB_ORG=<github-org>

VERCEL_TOKEN=<vercel-token>
VERCEL_TEAM_ID=<optional-vercel-team-id>

DNS_PROVIDER_TOKEN=<dns-api-token>
VAEN_BASE_DOMAIN=vaen.space
```

If these are not set, provider execution will truthfully report `not_configured`.

## Workspace expectations

The worker uses the checked-out repo as its working directory.

- generated sites live under `generated/<slug>/`
- screenshots live under `generated/<slug>/artifacts/screenshots/`
- deployment payloads live under `generated/<slug>/deployment-payload.json`
- `scripts/review.sh` expects to build and run the generated site locally on the VM

Use a writable checkout path such as:

```bash
/opt/vaen
```

Do not run the worker from a read-only checkout.

## One-time setup

```bash
git clone <repo-url> /opt/vaen
cd /opt/vaen
pnpm install
pnpm -r build
pnpm --filter @vaen/review-tools exec playwright install --with-deps chromium
cp apps/worker/.env.example apps/worker/.env 2>/dev/null || true
```

Then create or edit `apps/worker/.env` with the variables above.

## Manual smoke test

From the repo root on the VM:

```bash
cd /opt/vaen
pnpm --filter @vaen/worker poll
```

Expected behavior:

- the worker writes a heartbeat into `worker_heartbeats`
- `/dashboard/settings/deployment` shows the worker as healthy
- project job surfaces stop looking mysteriously idle when a worker is actually running

For a fuller hosted smoke pass from your local machine against the live portal:

```bash
PORTAL_URL=https://vaen.space \
PORTAL_EMAIL=<operator-email> \
PORTAL_PASSWORD=<operator-password> \
PORTAL_SMOKE_PROJECT_ID=<ready-project-id> \
pnpm --filter @vaen/portal smoke:hosted
```

## Run continuously with systemd

Example unit file:

```ini
[Unit]
Description=vaen worker poller
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/vaen
Environment=NODE_ENV=production
ExecStart=/usr/bin/env bash -lc 'pnpm --filter @vaen/worker poll'
Restart=always
RestartSec=5
User=vaen
Group=vaen
StandardOutput=append:/var/log/vaen-worker.log
StandardError=append:/var/log/vaen-worker.log

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable vaen-worker
sudo systemctl start vaen-worker
sudo systemctl status vaen-worker
```

## Run continuously with pm2

If you prefer pm2:

```bash
cd /opt/vaen
pm2 start "pnpm --filter @vaen/worker poll" --name vaen-worker
pm2 save
pm2 status
```

## Logs and troubleshooting

Suggested log locations:

- systemd example: `/var/log/vaen-worker.log`
- pm2: `pm2 logs vaen-worker`

Useful checks:

```bash
cd /opt/vaen
pnpm --filter @vaen/worker build
pnpm --filter @vaen/worker poll
```

If jobs are stuck in `pending`:

1. confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
2. confirm the worker process is still running
3. confirm Playwright Chromium is installed
4. confirm the repo checkout is writable
5. check `/dashboard/settings/deployment` for heartbeat freshness

If review jobs fail during screenshot capture:

1. rerun `pnpm --filter @vaen/review-tools exec playwright install --with-deps chromium`
2. inspect the worker logs for `scripts/review.sh` build or server startup errors
3. verify the generated site under `generated/<slug>/site` can build locally on the VM

If deployment prepare fails:

1. verify the active revision exported successfully
2. verify `generated/<slug>/deployment-payload.json` exists
3. use the project deployment history in the portal to inspect the latest run summary

## Portal verification steps

After the poller is running:

1. open `/dashboard/settings/deployment`
2. verify the Worker heartbeat card shows `healthy`
3. verify worker id, hostname, and last seen time look current
4. open a project with pending or running jobs and confirm the Jobs & Artifacts area shows worker health

## What is real vs not yet automated

Real now:

- portal inserts jobs into Supabase
- worker claims jobs and updates `worker_heartbeats`
- portal shows worker heartbeat state
- deployment runs and `deploy_prepare` are tracked
- provider execution jobs can be queued and recorded

Not finished yet:

- real GitHub deployment automation
- real Vercel deployment automation
- real DNS/domain automation
- VM provisioning automation
- heartbeat alerting/notifications
- multi-worker operational dashboard
