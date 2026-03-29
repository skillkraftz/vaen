import type { DeploymentReadiness } from "./deployment-readiness";
import type { Project } from "./types";

export interface DeploymentEligibility {
  allowed: boolean;
  reason: string | null;
}

export function getDeploymentEligibility(
  project: Pick<
    Project,
    "current_revision_id" | "last_exported_revision_id" | "last_generated_revision_id"
  >,
  readiness: Pick<DeploymentReadiness, "blockers" | "checks">,
): DeploymentEligibility {
  if (readiness.blockers.length > 0) {
    return {
      allowed: false,
      reason: readiness.blockers[0] ?? "Deployment readiness is blocked.",
    };
  }

  if (!readiness.checks.deploymentPayloadSupport.ok) {
    return {
      allowed: false,
      reason: "Deployment payload support is missing from the repo.",
    };
  }

  if (!project.current_revision_id) {
    return {
      allowed: false,
      reason: "No active version found. Process the intake first.",
    };
  }

  if (project.last_exported_revision_id !== project.current_revision_id) {
    return {
      allowed: false,
      reason: "Export the current revision before creating a deployment run.",
    };
  }

  if (project.last_generated_revision_id !== project.current_revision_id) {
    return {
      allowed: false,
      reason: "Generate the current revision before creating a deployment run.",
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

export function summarizeDeploymentPayloadMetadata(
  payloadMetadata: Record<string, unknown> | null | undefined,
): string {
  const summary = (payloadMetadata?.summary as Record<string, unknown> | undefined) ?? {};
  const framework = typeof summary.framework === "string" ? summary.framework : null;
  const subdomain = typeof summary.subdomain === "string" ? summary.subdomain : null;
  const templateId = typeof summary.templateId === "string" ? summary.templateId : null;
  const moduleCount = typeof summary.moduleCount === "number" ? summary.moduleCount : null;

  return [framework, subdomain, templateId, moduleCount != null ? `${moduleCount} modules` : null]
    .filter(Boolean)
    .join(" · ");
}
