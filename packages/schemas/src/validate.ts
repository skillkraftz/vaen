import Ajv from "ajv";
import addFormats from "ajv-formats";
import { clientRequestSchema } from "./client-request.js";
import { buildManifestSchema } from "./build-manifest.js";
import { deploymentPayloadSchema } from "./deployment-payload.js";
import type { ClientRequest } from "./client-request.js";
import type { BuildManifest } from "./build-manifest.js";
import type { DeploymentPayload } from "./deployment-payload.js";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validateClientRequestFn = ajv.compile(clientRequestSchema);
const validateBuildManifestFn = ajv.compile(buildManifestSchema);
const validateDeploymentPayloadFn = ajv.compile(deploymentPayloadSchema);

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors?: string[];
}

export function validateClientRequest(
  data: unknown
): ValidationResult<ClientRequest> {
  const valid = validateClientRequestFn(data);
  if (valid) {
    return { valid: true, data: data as ClientRequest };
  }
  return {
    valid: false,
    errors: validateClientRequestFn.errors?.map(
      (e) => `${e.instancePath || "/"}: ${e.message}`
    ),
  };
}

export function validateBuildManifest(
  data: unknown
): ValidationResult<BuildManifest> {
  const valid = validateBuildManifestFn(data);
  if (valid) {
    return { valid: true, data: data as BuildManifest };
  }
  return {
    valid: false,
    errors: validateBuildManifestFn.errors?.map(
      (e) => `${e.instancePath || "/"}: ${e.message}`
    ),
  };
}

export function validateDeploymentPayload(
  data: unknown
): ValidationResult<DeploymentPayload> {
  const valid = validateDeploymentPayloadFn(data);
  if (valid) {
    return { valid: true, data: data as DeploymentPayload };
  }
  return {
    valid: false,
    errors: validateDeploymentPayloadFn.errors?.map(
      (e) => `${e.instancePath || "/"}: ${e.message}`
    ),
  };
}
