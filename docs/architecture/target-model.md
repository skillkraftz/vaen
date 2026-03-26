# Target Model

## Overview

A **target** is the unit of work in vaen — one client website from intake to deployment. Every target is identified by a **slug** (e.g. `flower-city-painting`) which determines all file paths.

## Target Resolution

`resolveTarget()` from `@vaen/shared/target` is the single source of truth for path derivation:

```typescript
import { resolveTarget } from "@vaen/shared";

const target = resolveTarget({
  slug: "flower-city-painting",
  repoRoot: "/path/to/vaen",
});

// target.clientRequestPath → examples/fake-clients/flower-city-painting/client-request.json
// target.paths.workspace   → generated/flower-city-painting/
// target.paths.site        → generated/flower-city-painting/site/
// target.paths.screenshots → generated/flower-city-painting/artifacts/screenshots/
// target.paths.buildManifest     → generated/flower-city-painting/build-manifest.json
// target.paths.claudeBrief       → generated/flower-city-painting/claude-brief.md
// target.paths.deploymentPayload → generated/flower-city-painting/deployment-payload.json
// target.paths.siteConfig        → generated/flower-city-painting/site/config.json
```

### Override Paths

Both `inputPath` and `outputDir` can be overridden:

```typescript
const target = resolveTarget({
  slug: "custom-client",
  repoRoot: "/path/to/vaen",
  inputPath: "/data/intake/custom.json",   // override input
  outputDir: "/builds/custom-client",       // override output
});
```

## Consumers

Every tool in the pipeline uses target resolution:

| Tool | How it uses target resolution |
|------|------|
| Generator CLI | `--target <slug>` resolves input + output paths |
| Review script | `--target <slug>` resolves site + screenshots paths |
| Intake bot | Writes `client-request.json` to resolved path |
| Worker | Resolves all paths for job payloads |
| Portal | Scans `generated/` and resolves each target |

## Target Lifecycle

A target progresses through these states (defined in `@vaen/shared/state`):

```
intake_received → intake_parsed → awaiting_review → template_selected
  → workspace_generated → build_in_progress → review_ready
  → deploy_ready → deploying → deployed → managed
```

### State Transitions

| From | To | Trigger |
|------|----|---------|
| `intake_received` | `intake_parsed` | Intake validation passes |
| `intake_parsed` | `awaiting_review` | Client data ready for human review |
| `awaiting_review` | `template_selected` | Operator selects template + modules |
| `template_selected` | `workspace_generated` | Generator completes |
| `workspace_generated` | `build_in_progress` | Site build starts |
| `build_in_progress` | `review_ready` | Build + screenshots complete |
| `build_in_progress` | `build_failed` | Build fails |
| `build_failed` | `build_in_progress` | Retry build |
| `review_ready` | `deploy_ready` | Client/operator approves |
| `review_ready` | `workspace_generated` | Rejected — regenerate |
| `deploy_ready` | `deploying` | Deployment triggered |
| `deploying` | `deployed` | Deployment succeeds |
| `deploying` | `deploy_failed` | Deployment fails |
| `deploy_failed` | `deploying` | Retry deployment |
| `deployed` | `managed` | Ongoing management begins |

### State Functions

```typescript
import { createTargetStatus, advanceState, canTransition } from "@vaen/shared";

const status = createTargetStatus("flower-city-painting");
// → { slug, state: "intake_received", history: [] }

const next = advanceState(status, "intake_parsed", "Validation passed");
// → { slug, state: "intake_parsed", history: [{ from, to, at, reason }] }

canTransition("review_ready", "deploy_ready"); // true
canTransition("review_ready", "deployed");      // false
```
