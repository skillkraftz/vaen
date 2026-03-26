/**
 * Pipeline runner — executes a sequence of jobs for a target.
 */

import type {
  Job,
  JobType,
  JobResult,
  Pipeline,
  JobPayloadMap,
} from "@vaen/shared";
import { DEFAULT_PIPELINE } from "@vaen/shared";
import { getHandler } from "./handlers.js";

export interface PipelineOptions {
  /** Target slug */
  targetSlug: string;
  /** Which jobs to run (defaults to full pipeline) */
  jobs?: JobType[];
  /** Called when a job starts */
  onJobStart?: (job: Job) => void;
  /** Called when a job completes */
  onJobComplete?: (job: Job) => void;
  /** Called when a job fails */
  onJobFail?: (job: Job) => void;
}

/**
 * Run a pipeline of jobs for a target.
 *
 * In v0 this runs synchronously in-process.
 * In v1 jobs will be dispatched to a queue and executed in VMs.
 */
export async function runPipeline(
  options: PipelineOptions,
  payloads: Map<JobType, JobPayloadMap[JobType]>,
): Promise<Pipeline> {
  const jobTypes = options.jobs ?? DEFAULT_PIPELINE;
  const pipelineId = `pipeline-${Date.now()}`;
  const jobs: Job[] = [];

  const pipeline: Pipeline = {
    id: pipelineId,
    targetSlug: options.targetSlug,
    jobIds: [],
    status: "running",
    createdAt: new Date().toISOString(),
  };

  for (const type of jobTypes) {
    const payload = payloads.get(type);
    if (!payload) {
      // Skip jobs with no payload (e.g. not applicable to this run)
      continue;
    }

    const job: Job = {
      id: `${pipelineId}-${type}`,
      type,
      targetSlug: options.targetSlug,
      payload: payload as JobPayloadMap[typeof type],
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    pipeline.jobIds.push(job.id);
    jobs.push(job);

    // Execute the job
    const handler = getHandler(type);
    if (!handler) {
      job.status = "skipped";
      job.result = {
        success: true,
        message: `No handler registered for ${type}, skipping`,
      };
      continue;
    }

    job.status = "running";
    job.startedAt = new Date().toISOString();
    options.onJobStart?.(job);

    try {
      const result: JobResult = await handler(payload);
      job.status = result.success ? "completed" : "failed";
      job.result = result;
      job.completedAt = new Date().toISOString();

      if (result.success) {
        options.onJobComplete?.(job);
      } else {
        options.onJobFail?.(job);
        pipeline.status = "failed";
        break;
      }
    } catch (err) {
      job.status = "failed";
      job.result = {
        success: false,
        message: "Job threw an exception",
        error: String(err),
      };
      job.completedAt = new Date().toISOString();
      options.onJobFail?.(job);
      pipeline.status = "failed";
      break;
    }
  }

  if (pipeline.status === "running") {
    pipeline.status = "completed";
  }
  pipeline.completedAt = new Date().toISOString();

  return pipeline;
}
