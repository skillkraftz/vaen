# Local Testing Guide

## Prerequisites

- Node.js >= 18
- pnpm >= 9
- Playwright Chromium (`npx playwright install chromium`)

## One-Time Setup

```bash
pnpm install
pnpm build
```

## Canonical End-to-End Flow

The complete flow for the fake client `flower-city-painting`:

### Step 1: Generate (target mode)

```bash
pnpm -w generate -- --target flower-city-painting --modules maps-embed,manual-testimonials
```

This uses shared target resolution to automatically derive:
- Input: `examples/fake-clients/flower-city-painting/client-request.json`
- Output: `generated/flower-city-painting/`

The generated workspace contains:
```
generated/flower-city-painting/
  site/                    — Next.js project
  build-manifest.json      — Resolved build plan
  claude-brief.md          — AI review brief
  deployment-payload.json  — Deployment config
  artifacts/screenshots/   — Screenshot output directory
  README.md                — Workspace instructions
  package.json             — Convenience scripts
```

### Step 2: Run locally

```bash
cd generated/flower-city-painting/site
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

### Step 3: Capture screenshots

From the repo root (in a separate terminal, or after stopping the dev server):

```bash
pnpm -w review -- --target flower-city-painting
```

This script will:
1. Install site dependencies (if not already done)
2. Build the site
3. Start it on port 4173
4. Capture 4 screenshots via Playwright
5. Save them to `generated/flower-city-painting/artifacts/screenshots/`
6. Stop the server

Screenshots captured:
- `homepage-desktop.png` (1440x900)
- `homepage-mobile.png` (375x812)
- `contact-desktop.png` (1440x900)
- `contact-mobile.png` (375x812)

### Step 4: Inspect artifacts

```bash
ls generated/flower-city-painting/artifacts/screenshots/
cat generated/flower-city-painting/build-manifest.json
cat generated/flower-city-painting/claude-brief.md
cat generated/flower-city-painting/deployment-payload.json
```

## Quick Reference

| Task | Command |
|------|---------|
| Build all packages | `pnpm build` |
| Generate a site (target) | `pnpm -w generate -- --target <slug>` |
| Generate a site (explicit) | `pnpm -w generate -- --template service-core --input <path> --output <path>` |
| Run generated site | `cd generated/<slug>/site && npm install && npm run dev` |
| Capture screenshots | `pnpm -w review -- --target <slug>` |
| Generator help | `pnpm -w generate -- --help` |
| Review help | `pnpm -w review -- --help` |

## How It Works

### Target Resolution (`@vaen/shared`)

All tools use `resolveTarget()` from `@vaen/shared` to derive canonical paths from a target slug:

```
resolveTarget({ slug: "flower-city-painting", repoRoot })
→ {
    clientRequestPath: "examples/fake-clients/flower-city-painting/client-request.json",
    paths: {
      workspace:       "generated/flower-city-painting/",
      site:            "generated/flower-city-painting/site/",
      screenshots:     "generated/flower-city-painting/artifacts/screenshots/",
      buildManifest:   "generated/flower-city-painting/build-manifest.json",
      claudeBrief:     "generated/flower-city-painting/claude-brief.md",
      deploymentPayload: "generated/flower-city-painting/deployment-payload.json",
    }
  }
```

### Generator (`pnpm generate`)

Runs `packages/generator/dist/cli.js`. The generator:
1. Resolves target paths (via `--target` slug or explicit `--input`/`--output`)
2. Validates the client-request.json against the schema
3. Resolves template + module config via the registries
4. Copies the template scaffold to the output directory
5. Injects a `config.json` with the resolved site config
6. Writes `build-manifest.json`, `claude-brief.md`, `deployment-payload.json`
7. Creates workspace scaffolding (README, wrapper package.json, artifacts dir)

### Review (`pnpm review`)

Runs `scripts/review.sh`. The review script:
1. Installs site dependencies if missing
2. Builds the site with `next build`
3. Starts the site with `next start` on port 4173
4. Runs `packages/review-tools/dist/cli.js` for Playwright screenshots
5. Saves screenshots to `generated/<slug>/artifacts/screenshots/`
6. Stops the server automatically

## Troubleshooting

### `pnpm generate` fails with "cannot find module"
Make sure packages are built first: `pnpm build`

### Generated site shows default content instead of client data
Verify that `config.json` exists at the root of the generated site directory. The `lib/site-config.ts` loader reads `../config.json` relative to `lib/`.

### Screenshots fail with "browser not found"
Install Playwright browsers: `npx playwright install chromium`

### Port already in use during review
Use a different port: `pnpm -w review -- --target flower-city-painting --port 4200`
