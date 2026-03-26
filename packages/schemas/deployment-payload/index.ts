/**
 * @vaen/schemas/deployment-payload
 *
 * Subpath entry point for the deployment-payload schema.
 * Re-exports the DeploymentPayload type, JSON Schema, and validator from the main package.
 *
 * Usage:
 *   import { DeploymentPayload, deploymentPayloadSchema, validateDeploymentPayload } from "@vaen/schemas/deployment-payload";
 */
export { DeploymentPayload, deploymentPayloadSchema } from "../src/deployment-payload.js";
export { validateDeploymentPayload } from "../src/validate.js";
