/**
 * Finalize intake — validate collected data and write client-request.json.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { validateClientRequest } from "@vaen/schemas";
import type { ClientRequest } from "@vaen/schemas";
import { resolveTarget } from "@vaen/shared";
import type { IntakeContext } from "./intake-flow.js";

export interface FinalizeResult {
  success: boolean;
  clientRequestPath?: string;
  errors?: string[];
}

/**
 * Validate the collected intake data and write client-request.json
 * to the standard location for the target.
 */
export async function finalizeIntake(
  ctx: IntakeContext,
  repoRoot: string,
): Promise<FinalizeResult> {
  const data = ctx.collected as ClientRequest;

  // Validate against schema
  const validation = validateClientRequest(data);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors ?? ["Unknown validation error"],
    };
  }

  // Resolve target paths
  const target = resolveTarget({ slug: ctx.slug, repoRoot });

  // Write client-request.json to the fake-clients location
  // (In v1, intake data will go to a proper data store)
  const outputDir = join(repoRoot, "examples", "fake-clients", ctx.slug);
  const outputPath = join(outputDir, "client-request.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(data, null, 2));

  return {
    success: true,
    clientRequestPath: outputPath,
  };
}
