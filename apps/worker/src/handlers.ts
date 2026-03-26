/**
 * Job handlers — one handler per job type.
 *
 * Each handler receives a typed payload and returns a JobResult.
 * In v0 these execute locally. In v1 they run inside VM sandboxes.
 */

import type {
  JobType,
  JobPayloadMap,
  JobResult,
} from "@vaen/shared";

/**
 * A handler function for a specific job type.
 */
export type JobHandler<T extends JobType = JobType> = (
  payload: JobPayloadMap[T],
) => Promise<JobResult>;

/**
 * Registry of job handlers. Register handlers for each job type
 * the worker should be able to execute.
 */
const handlers = new Map<JobType, JobHandler>();

/**
 * Register a handler for a job type.
 */
export function registerHandler<T extends JobType>(
  type: T,
  handler: JobHandler<T>,
): void {
  handlers.set(type, handler as JobHandler);
}

/**
 * Get the registered handler for a job type.
 */
export function getHandler(type: JobType): JobHandler | undefined {
  return handlers.get(type);
}

/**
 * Create a job handler with typed payload. Convenience wrapper
 * for defining handlers with proper type inference.
 */
export function createJobHandler<T extends JobType>(
  _type: T,
  handler: (payload: JobPayloadMap[T]) => Promise<JobResult>,
): JobHandler<T> {
  return handler;
}

// ── Built-in handlers (v0 local execution) ───────────────────────────

/**
 * Intake parse handler — validates client-request.json.
 */
registerHandler("intake_parse", async (payload) => {
  const { clientRequestPath } = payload;
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(clientRequestPath, "utf-8"));
    const { validateClientRequest } = await import("@vaen/schemas");
    const result = validateClientRequest(raw);
    if (!result.valid) {
      return {
        success: false,
        message: "Client request validation failed",
        error: result.errors?.join(", "),
      };
    }
    return {
      success: true,
      message: "Client request validated",
      artifacts: [clientRequestPath],
    };
  } catch (err) {
    return {
      success: false,
      message: "Failed to parse client request",
      error: String(err),
    };
  }
});

/**
 * Validate build handler — checks that build output exists.
 */
registerHandler("validate_build", async (payload) => {
  const { existsSync } = await import("node:fs");
  const missing = payload.expectedOutputs.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    return {
      success: false,
      message: `Missing build outputs: ${missing.join(", ")}`,
    };
  }
  return {
    success: true,
    message: "Build output validated",
    artifacts: payload.expectedOutputs,
  };
});
