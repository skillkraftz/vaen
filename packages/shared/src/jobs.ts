/**
 * Job/task model — defines the units of work in the vaen pipeline.
 *
 * A Job represents one discrete step in transforming a client request into
 * a deployed website. Jobs are designed to be:
 *   - Independently retriable
 *   - Serially composable into pipelines
 *   - Trackable with status + timing metadata
 *
 * In v0 these are executed locally and synchronously by the CLI.
 * In v1 they'll be dispatched to the worker VM via a job queue.
 */

// ── Job types ────────────────────────────────────────────────────────

/**
 * Every discrete operation in the vaen pipeline.
 *
 * Order reflects the typical pipeline sequence, but jobs can be
 * re-run independently (e.g. re-capture screenshots without regenerating).
 */
export type JobType =
  | "intake_parse"
  | "workspace_generate"
  | "site_build"
  | "validate_build"
  | "capture_screenshots"
  | "prepare_deploy_payload"
  | "deploy_validate"
  | "deploy_execute";

/** Human-readable labels for each job type. */
export const JOB_LABELS: Record<JobType, string> = {
  intake_parse: "Parse client intake",
  workspace_generate: "Generate workspace",
  site_build: "Build site",
  validate_build: "Validate build output",
  capture_screenshots: "Capture review screenshots",
  prepare_deploy_payload: "Prepare deployment payload",
  deploy_validate: "Validate deployment",
  deploy_execute: "Execute provider deployment",
};

/**
 * The default pipeline sequence. Not every run uses every step —
 * e.g. a re-review skips intake_parse and workspace_generate.
 */
export const DEFAULT_PIPELINE: JobType[] = [
  "intake_parse",
  "workspace_generate",
  "site_build",
  "validate_build",
  "capture_screenshots",
  "prepare_deploy_payload",
  "deploy_validate",
];

// ── Job status ───────────────────────────────────────────────────────

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

// ── Job payloads (per-type input) ────────────────────────────────────

export interface IntakeParsePayload {
  clientRequestPath: string;
}

export interface WorkspaceGeneratePayload {
  clientRequestPath: string;
  templateId: string;
  moduleIds: string[];
  outputDir: string;
  repoRoot: string;
}

export interface SiteBuildPayload {
  siteDir: string;
}

export interface ValidateBuildPayload {
  siteDir: string;
  /** Paths that must exist after build (e.g. .next/) */
  expectedOutputs: string[];
}

export interface CaptureScreenshotsPayload {
  siteDir: string;
  screenshotsDir: string;
  port: number;
}

export interface PrepareDeployPayloadPayload {
  workspaceDir: string;
}

export interface DeployValidatePayload {
  deploymentPayloadPath: string;
}

export interface DeployExecutePayload {
  deploymentRunId: string;
  deploymentPayloadPath: string;
}

export type JobPayload =
  | IntakeParsePayload
  | WorkspaceGeneratePayload
  | SiteBuildPayload
  | ValidateBuildPayload
  | CaptureScreenshotsPayload
  | PrepareDeployPayloadPayload
  | DeployValidatePayload
  | DeployExecutePayload;

/** Maps job type to its specific payload shape. */
export interface JobPayloadMap {
  intake_parse: IntakeParsePayload;
  workspace_generate: WorkspaceGeneratePayload;
  site_build: SiteBuildPayload;
  validate_build: ValidateBuildPayload;
  capture_screenshots: CaptureScreenshotsPayload;
  prepare_deploy_payload: PrepareDeployPayloadPayload;
  deploy_validate: DeployValidatePayload;
  deploy_execute: DeployExecutePayload;
}

// ── Job result ───────────────────────────────────────────────────────

export interface JobResult {
  /** Whether the job succeeded */
  success: boolean;
  /** Human-readable summary */
  message: string;
  /** Paths to artifacts produced by this job */
  artifacts?: string[];
  /** Error details if failed */
  error?: string;
}

// ── Job record ───────────────────────────────────────────────────────

export interface Job<T extends JobType = JobType> {
  /** Unique job ID (uuid in production, sequential in CLI) */
  id: string;
  /** The job type */
  type: T;
  /** Target slug this job belongs to */
  targetSlug: string;
  /** Job-specific input data */
  payload: JobPayloadMap[T];
  /** Current status */
  status: JobStatus;
  /** Result (populated after completion or failure) */
  result?: JobResult;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when execution started */
  startedAt?: string;
  /** ISO timestamp when execution finished */
  completedAt?: string;
}

// ── Pipeline record ──────────────────────────────────────────────────

export interface Pipeline {
  /** Unique pipeline ID */
  id: string;
  /** Target slug */
  targetSlug: string;
  /** Ordered list of job IDs in this pipeline */
  jobIds: string[];
  /** Overall pipeline status */
  status: "pending" | "running" | "completed" | "failed";
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when completed */
  completedAt?: string;
}
