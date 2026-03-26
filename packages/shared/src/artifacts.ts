/**
 * Artifact lifecycle definitions.
 *
 * An Artifact is a named, typed output of a pipeline job. This module
 * formalizes what artifacts exist, which job produces each one, and
 * which downstream jobs consume it.
 */

import type { JobType } from "./jobs.js";
import type { TargetState } from "./state.js";

// ── Artifact types ───────────────────────────────────────────────────

export type ArtifactType =
  | "client_request"
  | "build_manifest"
  | "claude_brief"
  | "deployment_payload"
  | "site_source"
  | "site_build_output"
  | "screenshots";

/** Human-readable labels. */
export const ARTIFACT_LABELS: Record<ArtifactType, string> = {
  client_request: "Client request",
  build_manifest: "Build manifest",
  claude_brief: "Claude brief",
  deployment_payload: "Deployment payload",
  site_source: "Site source code",
  site_build_output: "Site build output",
  screenshots: "Review screenshots",
};

// ── Artifact definition ──────────────────────────────────────────────

export interface ArtifactDefinition {
  /** Artifact type identifier */
  type: ArtifactType;
  /** Human label */
  label: string;
  /** Relative path within the workspace (file or directory) */
  relativePath: string;
  /** Whether this is a directory (true) or file (false) */
  isDirectory: boolean;
  /** The job that produces this artifact */
  producedBy: JobType | "external";
  /** Jobs that consume this artifact as input */
  consumedBy: JobType[];
  /** The target state at which this artifact should exist */
  availableAt: TargetState;
  /** File format */
  format: "json" | "markdown" | "directory" | "png";
}

/**
 * Canonical artifact definitions for the vaen pipeline.
 */
export const ARTIFACT_DEFINITIONS: ArtifactDefinition[] = [
  {
    type: "client_request",
    label: "Client request",
    relativePath: "../examples/fake-clients/<slug>/client-request.json",
    isDirectory: false,
    producedBy: "external",
    consumedBy: ["intake_parse", "workspace_generate"],
    availableAt: "intake_received",
    format: "json",
  },
  {
    type: "build_manifest",
    label: "Build manifest",
    relativePath: "build-manifest.json",
    isDirectory: false,
    producedBy: "workspace_generate",
    consumedBy: ["site_build", "prepare_deploy_payload"],
    availableAt: "workspace_generated",
    format: "json",
  },
  {
    type: "claude_brief",
    label: "Claude brief",
    relativePath: "claude-brief.md",
    isDirectory: false,
    producedBy: "workspace_generate",
    consumedBy: [],
    availableAt: "workspace_generated",
    format: "markdown",
  },
  {
    type: "site_source",
    label: "Site source code",
    relativePath: "site/",
    isDirectory: true,
    producedBy: "workspace_generate",
    consumedBy: ["site_build"],
    availableAt: "workspace_generated",
    format: "directory",
  },
  {
    type: "site_build_output",
    label: "Site build output",
    relativePath: "site/.next/",
    isDirectory: true,
    producedBy: "site_build",
    consumedBy: ["validate_build", "capture_screenshots"],
    availableAt: "build_in_progress",
    format: "directory",
  },
  {
    type: "screenshots",
    label: "Review screenshots",
    relativePath: "artifacts/screenshots/",
    isDirectory: true,
    producedBy: "capture_screenshots",
    consumedBy: [],
    availableAt: "review_ready",
    format: "png",
  },
  {
    type: "deployment_payload",
    label: "Deployment payload",
    relativePath: "deployment-payload.json",
    isDirectory: false,
    producedBy: "prepare_deploy_payload",
    consumedBy: ["deploy_validate"],
    availableAt: "deploy_ready",
    format: "json",
  },
];

/**
 * Look up an artifact definition by type.
 */
export function getArtifactDefinition(type: ArtifactType): ArtifactDefinition | undefined {
  return ARTIFACT_DEFINITIONS.find((a) => a.type === type);
}

/**
 * Get all artifacts produced by a given job type.
 */
export function getArtifactsProducedBy(jobType: JobType): ArtifactDefinition[] {
  return ARTIFACT_DEFINITIONS.filter((a) => a.producedBy === jobType);
}

/**
 * Get all artifacts consumed by a given job type.
 */
export function getArtifactsConsumedBy(jobType: JobType): ArtifactDefinition[] {
  return ARTIFACT_DEFINITIONS.filter((a) => a.consumedBy.includes(jobType));
}
