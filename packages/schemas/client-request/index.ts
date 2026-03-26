/**
 * @vaen/schemas/client-request
 *
 * Subpath entry point for the client-request schema.
 * Re-exports the ClientRequest type, JSON Schema, and validator from the main package.
 *
 * Usage:
 *   import { ClientRequest, clientRequestSchema, validateClientRequest } from "@vaen/schemas/client-request";
 */
export { ClientRequest, clientRequestSchema } from "../src/client-request.js";
export { validateClientRequest } from "../src/validate.js";
