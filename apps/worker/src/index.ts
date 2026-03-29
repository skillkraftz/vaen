/**
 * @vaen/worker — Background job runner for the vaen pipeline.
 *
 * Architecture:
 *   Portal creates a job record in the DB → poller claims the next pending job →
 *   worker executes it and writes results back to DB.
 *
 * Job types:
 *   - "generate" — runs the generator CLI (pnpm -w generate)
 *   - "review"   — runs build + screenshot capture (pnpm -w review)
 *
 * The portal never blocks on long-running commands.
 * The worker is the only process that executes pipeline commands.
 * The DB is the source of truth for job status and logs.
 *
 * Entrypoints:
 *   node dist/poll.js              — long-running polling daemon
 *   node dist/run-job.js <job-id>  — execute a single job directly
 */

import { runPipeline } from "./pipeline.js";
import type { WorkerConfig } from "./config.js";
import { DEFAULT_WORKER_CONFIG } from "./config.js";

export { runPipeline } from "./pipeline.js";
export { createJobHandler } from "./handlers.js";
export type { JobHandler } from "./handlers.js";
export type { WorkerConfig } from "./config.js";

async function main() {
  const config = DEFAULT_WORKER_CONFIG;

  console.log("@vaen/worker — Supabase-polled worker");
  console.log(`  Max concurrent jobs: ${config.maxConcurrency}`);
  console.log(`  Isolation: ${config.isolation}`);
  console.log("");
  console.log("Long-running:");
  console.log("  node dist/poll.js            Poll, claim, execute, heartbeat");
  console.log("");
  console.log("Direct execution:");
  console.log("  node dist/run-job.js <job-id>   Execute a single job");
  console.log("");
  console.log("Programmatic:");
  console.log("  import { runPipeline } from '@vaen/worker'");
}

main().catch(console.error);
