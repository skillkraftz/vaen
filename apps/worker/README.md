# @vaen/worker

Background job runner for the vaen pipeline — processes generation, build, review, and deployment jobs.

**Status:** Scaffolded — pipeline runner, job handler registry, and built-in handlers implemented. No queue or VM isolation yet.

## Architecture

The worker executes a pipeline of jobs for a given target:

```
intake_parse → workspace_generate → site_build → validate_build → capture_screenshots → prepare_deploy_payload → deploy_validate
```

Each job type has a registered handler. Jobs run sequentially within a pipeline. Failures stop the pipeline.

## Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point |
| `src/config.ts` | Worker configuration (concurrency, isolation, timeout) |
| `src/handlers.ts` | Job handler registry + built-in handlers |
| `src/pipeline.ts` | Pipeline runner with lifecycle callbacks |

## Usage (programmatic)

```typescript
import { runPipeline } from "@vaen/worker";

const pipeline = await runPipeline(
  { targetSlug: "flower-city-painting" },
  payloads,
);
```

## v1 Targets
- BullMQ job queue for distributed processing
- Firecracker/microVM isolation per job
- Webhook callbacks on job completion
- Retry logic with exponential backoff
