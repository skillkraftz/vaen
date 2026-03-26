# Artifact Flow

## Pipeline Overview

```
client-request.json
  ↓ intake_parse         — Validate client intake data
  ↓ workspace_generate   — Generate site/ + build-manifest + claude-brief
  ↓ site_build           — next build → site/.next/
  ↓ validate_build       — Verify build outputs exist
  ↓ capture_screenshots  — Playwright → artifacts/screenshots/
  ↓ prepare_deploy_payload — Generate deployment-payload.json
  ↓ deploy_validate      — Validate deployment readiness
```

## Artifact Definitions

Each artifact is formally defined in `@vaen/shared/artifacts` with:
- **Type** — Unique identifier
- **Produced by** — Which job creates this artifact
- **Consumed by** — Which jobs read this artifact
- **Available at** — Target state when this artifact should exist
- **Format** — json, markdown, directory, or png

### client-request.json
| Field | Value |
|-------|-------|
| Type | `client_request` |
| Path | `examples/fake-clients/<slug>/client-request.json` |
| Produced by | External (intake bot or manual) |
| Consumed by | `intake_parse`, `workspace_generate` |
| Available at | `intake_received` |

Contains raw client info: business details, contact, services, branding, content, features, preferences.

### build-manifest.json
| Field | Value |
|-------|-------|
| Type | `build_manifest` |
| Path | `generated/<slug>/build-manifest.json` |
| Produced by | `workspace_generate` |
| Consumed by | `site_build`, `prepare_deploy_payload` |
| Available at | `workspace_generated` |

The resolved build plan: template + modules + merged config + file listing.

### claude-brief.md
| Field | Value |
|-------|-------|
| Type | `claude_brief` |
| Path | `generated/<slug>/claude-brief.md` |
| Produced by | `workspace_generate` |
| Consumed by | — (human/AI review) |
| Available at | `workspace_generated` |

Markdown brief describing what was generated, key decisions, review items, and suggestions.

### site/
| Field | Value |
|-------|-------|
| Type | `site_source` |
| Path | `generated/<slug>/site/` |
| Produced by | `workspace_generate` |
| Consumed by | `site_build` |
| Available at | `workspace_generated` |

Complete Next.js project with injected `config.json`.

### site/.next/
| Field | Value |
|-------|-------|
| Type | `site_build_output` |
| Path | `generated/<slug>/site/.next/` |
| Produced by | `site_build` |
| Consumed by | `validate_build`, `capture_screenshots` |
| Available at | `build_in_progress` |

Next.js build output (static pages, chunks, etc.).

### artifacts/screenshots/
| Field | Value |
|-------|-------|
| Type | `screenshots` |
| Path | `generated/<slug>/artifacts/screenshots/` |
| Produced by | `capture_screenshots` |
| Consumed by | — (human review via portal) |
| Available at | `review_ready` |

Screenshot PNGs: `{page}-{viewport}.png` (e.g. `homepage-desktop.png`).

### deployment-payload.json
| Field | Value |
|-------|-------|
| Type | `deployment_payload` |
| Path | `generated/<slug>/deployment-payload.json` |
| Produced by | `prepare_deploy_payload` |
| Consumed by | `deploy_validate` |
| Available at | `deploy_ready` |

Everything needed to deploy: site path, build commands, domain config, metadata.

## Workspace Layout

```
generated/<slug>/
├── site/                           ← site_source
│   ├── app/                        ← Next.js pages
│   ├── lib/                        ← Utilities
│   ├── config.json                 ← Injected site config
│   ├── .next/                      ← site_build_output (after build)
│   └── package.json
├── build-manifest.json             ← build_manifest
├── claude-brief.md                 ← claude_brief
├── deployment-payload.json         ← deployment_payload
├── artifacts/
│   └── screenshots/                ← screenshots
│       ├── homepage-desktop.png
│       ├── homepage-mobile.png
│       ├── contact-desktop.png
│       └── contact-mobile.png
├── README.md
└── package.json                    ← wrapper scripts
```
