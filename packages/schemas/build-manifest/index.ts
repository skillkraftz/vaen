/**
 * @vaen/schemas/build-manifest
 *
 * Subpath entry point for the build-manifest schema.
 * Re-exports the BuildManifest type, JSON Schema, and validator from the main package.
 *
 * Usage:
 *   import { BuildManifest, buildManifestSchema, validateBuildManifest } from "@vaen/schemas/build-manifest";
 */
export { BuildManifest, buildManifestSchema } from "../src/build-manifest.js";
export { validateBuildManifest } from "../src/validate.js";
