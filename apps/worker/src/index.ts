/**
 * @vaen/worker — Background job runner for the vaen pipeline.
 *
 * Processes jobs from a queue, executing each step of the pipeline
 * in isolation. In v1 each job runs in a VM sandbox.
 *
 * v0: Scaffolding with local execution — no queue, no VM.
 * v1: BullMQ job queue + Firecracker/microVM isolation.
 */

import { runPipeline } from "./pipeline.js";
import type { WorkerConfig } from "./config.js";
import { DEFAULT_WORKER_CONFIG } from "./config.js";

export { runPipeline } from "./pipeline.js";
export { createJobHandler } from "./handlers.js";
export type { JobHandler } from "./handlers.js";
export type { WorkerConfig } from "./config.js";

/**
 * Main entry point. In v1 this will connect to a job queue
 * and process jobs as they arrive.
 */
async function main() {
  const config = DEFAULT_WORKER_CONFIG;

  console.log("@vaen/worker — local mode");
  console.log(`  Max concurrent jobs: ${config.maxConcurrency}`);
  console.log(`  Isolation: ${config.isolation}`);
  console.log("");
  console.log("Use the pipeline runner programmatically:");
  console.log("  import { runPipeline } from '@vaen/worker'");
}

main().catch(console.error);
