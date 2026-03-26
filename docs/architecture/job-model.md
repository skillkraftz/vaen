# Job Model

## Overview

A **job** is one discrete step in the vaen pipeline. Jobs are:
- **Typed** — each job type has a specific payload shape
- **Independent** — can be re-run without replaying the full pipeline
- **Composable** — sequenced into pipelines for end-to-end execution
- **Trackable** — carry status, timing, and result metadata

## Job Types

Defined in `@vaen/shared/jobs`:

| Job Type | Label | Produces |
|----------|-------|----------|
| `intake_parse` | Parse client intake | Validated client-request.json |
| `workspace_generate` | Generate workspace | site/, build-manifest.json, claude-brief.md |
| `site_build` | Build site | site/.next/ |
| `validate_build` | Validate build output | (validation only) |
| `capture_screenshots` | Capture review screenshots | artifacts/screenshots/*.png |
| `prepare_deploy_payload` | Prepare deployment payload | deployment-payload.json |
| `deploy_validate` | Validate deployment | (validation only) |

## Default Pipeline

```typescript
import { DEFAULT_PIPELINE } from "@vaen/shared";

// ["intake_parse", "workspace_generate", "site_build",
//  "validate_build", "capture_screenshots",
//  "prepare_deploy_payload", "deploy_validate"]
```

Not every run uses every step. For example, re-running review only needs:
`["site_build", "capture_screenshots"]`

## Job Payloads

Each job type has a typed payload:

```typescript
interface IntakeParsePayload {
  clientRequestPath: string;
}

interface WorkspaceGeneratePayload {
  clientRequestPath: string;
  templateId: string;
  moduleIds: string[];
  outputDir: string;
  repoRoot: string;
}

interface SiteBuildPayload {
  siteDir: string;
}

interface ValidateBuildPayload {
  siteDir: string;
  expectedOutputs: string[];
}

interface CaptureScreenshotsPayload {
  siteDir: string;
  screenshotsDir: string;
  port: number;
}

interface PrepareDeployPayloadPayload {
  workspaceDir: string;
}

interface DeployValidatePayload {
  deploymentPayloadPath: string;
}
```

## Job Status

```
pending → running → completed
                  → failed
                  → skipped
```

## Job Record

```typescript
interface Job<T extends JobType> {
  id: string;
  type: T;
  targetSlug: string;
  payload: JobPayloadMap[T];
  status: JobStatus;
  result?: JobResult;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

## Pipeline Execution

The worker's `runPipeline()` executes jobs sequentially:

```typescript
import { runPipeline } from "@vaen/worker";

const pipeline = await runPipeline(
  {
    targetSlug: "flower-city-painting",
    jobs: ["intake_parse", "workspace_generate", "site_build"],
    onJobStart: (job) => console.log(`Starting: ${job.type}`),
    onJobComplete: (job) => console.log(`Done: ${job.type}`),
    onJobFail: (job) => console.error(`Failed: ${job.type}`, job.result?.error),
  },
  payloads, // Map<JobType, payload>
);
```

Pipeline stops on first failure. Skips jobs with no registered handler.

## v0 vs v1

| Aspect | v0 (current) | v1 (planned) |
|--------|------|------|
| Execution | In-process, synchronous | BullMQ queue, async |
| Isolation | None (local CLI) | Firecracker/microVM per job |
| State | In-memory | Database-backed |
| Retry | Manual re-run | Automatic with backoff |
| Handlers | Built-in only | Plugin-based |
