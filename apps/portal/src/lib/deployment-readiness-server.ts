import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDeploymentReadiness, type DeploymentReadiness } from "./deployment-readiness";

function getRepoRoot() {
  return join(process.cwd(), "../..");
}

export function hasDeploymentPayloadSupport(repoRoot = getRepoRoot()) {
  return (
    existsSync(join(repoRoot, "packages/generator/src/generate-deployment-payload.ts")) &&
    existsSync(join(repoRoot, "packages/schemas/src/deployment-payload.ts")) &&
    existsSync(join(repoRoot, "docs/architecture/deployment.md"))
  );
}

export function getServerDeploymentReadiness(
  env: NodeJS.ProcessEnv = process.env,
): DeploymentReadiness {
  return getDeploymentReadiness(env, {
    deploymentPayloadSupport: hasDeploymentPayloadSupport(),
  });
}
