// @vaen/shared — shared types, models, and utilities for the vaen pipeline

// Target resolution
export {
  resolveTarget,
  WORKSPACE_FILES,
} from "./target.js";
export type {
  TargetPaths,
  ResolvedTarget,
  ResolveTargetOptions,
} from "./target.js";

// Job/task model
export {
  JOB_LABELS,
  DEFAULT_PIPELINE,
} from "./jobs.js";
export type {
  JobType,
  JobStatus,
  JobPayload,
  JobPayloadMap,
  JobResult,
  Job,
  Pipeline,
  IntakeParsePayload,
  WorkspaceGeneratePayload,
  SiteBuildPayload,
  ValidateBuildPayload,
  CaptureScreenshotsPayload,
  PrepareDeployPayloadPayload,
  DeployValidatePayload,
} from "./jobs.js";

// Client/target lifecycle
export {
  STATE_LABELS,
  STATE_TRANSITIONS,
  canTransition,
  createTargetStatus,
  advanceState,
} from "./state.js";
export type {
  TargetState,
  TargetStatus,
  StateTransition,
} from "./state.js";

// Artifact lifecycle
export {
  ARTIFACT_LABELS,
  ARTIFACT_DEFINITIONS,
  getArtifactDefinition,
  getArtifactsProducedBy,
  getArtifactsConsumedBy,
} from "./artifacts.js";
export type {
  ArtifactType,
  ArtifactDefinition,
} from "./artifacts.js";
