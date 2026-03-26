/**
 * Worker configuration.
 */

export interface WorkerConfig {
  /** Maximum concurrent jobs (default: 1 in v0) */
  maxConcurrency: number;
  /** Isolation mode: "none" (v0 local), "process" (child_process), "vm" (v1 microVM) */
  isolation: "none" | "process" | "vm";
  /** Job timeout in milliseconds (default: 5 minutes) */
  jobTimeoutMs: number;
  /** Repo root path for local mode */
  repoRoot: string;
}

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  maxConcurrency: 1,
  isolation: "none",
  jobTimeoutMs: 5 * 60 * 1000,
  repoRoot: process.cwd(),
};
