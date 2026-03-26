#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { validateClientRequest } from "@vaen/schemas";
import { resolveTarget } from "@vaen/shared";
import { resolveConfig } from "./resolve-config.js";
import { generateSite } from "./generate-site.js";
import { generateBrief } from "./generate-brief.js";
import { generateDeploymentPayload } from "./generate-deployment-payload.js";
import { generateWorkspace } from "./generate-workspace.js";

function parseArgs(args: string[]) {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") continue; // skip bare -- separator from pnpm
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      parsed[key] = value;
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
vaen-generate — Generate a customer website workspace

Usage:
  pnpm -w generate -- --target <client-slug>
  pnpm -w generate -- --template <id> --input <path> --output <path>

Options:
  --target     Client slug (resolves input/output paths automatically)
  --template   Template ID (default: service-core)
  --modules    Comma-separated module IDs (e.g., maps-embed,manual-testimonials)
  --input      Path to client-request.json (overrides --target default)
  --output     Output directory (overrides --target default)
  --help       Show this help message

When using --target, paths resolve to:
  Input:  generated/<slug>/client-request.json  (canonical)
          examples/fake-clients/<slug>/client-request.json  (fallback for examples)
  Output: generated/<slug>/
`);
    process.exit(0);
  }

  // Find repo root (walk up from this script's location)
  const repoRoot = resolve(
    new URL(".", import.meta.url).pathname,
    "..",
    "..",
    ".."
  );

  // Resolve target paths
  const targetSlug = args.target;
  const templateId = args.template ?? "service-core";
  const moduleIds = args.modules?.split(",").filter(Boolean) ?? [];

  let resolvedInput: string;
  let resolvedOutput: string;

  if (targetSlug) {
    // --target mode: resolve paths from slug
    const target = resolveTarget({
      slug: targetSlug,
      repoRoot,
      inputPath: args.input ? resolve(args.input) : undefined,
      outputDir: args.output ? resolve(args.output) : undefined,
    });
    resolvedInput = target.clientRequestPath;
    resolvedOutput = target.paths.workspace;

    // Fallback: if canonical path doesn't exist, try examples/fake-clients/
    // This preserves backward compat for hand-crafted example targets.
    if (!args.input && !existsSync(resolvedInput)) {
      const examplePath = join(repoRoot, "examples", "fake-clients", targetSlug, "client-request.json");
      if (existsSync(examplePath)) {
        console.log(`   (using example input: ${examplePath})`);
        resolvedInput = examplePath;
      }
    }
  } else if (args.input && args.output) {
    // Legacy explicit mode
    resolvedInput = resolve(args.input);
    resolvedOutput = resolve(args.output);
  } else {
    console.error("Error: --target or both --input and --output are required.");
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  console.log(`\n🔧 vaen generator v0.1.0`);
  console.log(`   Template:  ${templateId}`);
  console.log(`   Modules:   ${moduleIds.join(", ") || "(none)"}`);
  console.log(`   Input:     ${resolvedInput}`);
  console.log(`   Output:    ${resolvedOutput}\n`);

  // 1. Load and validate client request
  console.log("1. Loading client request...");
  const raw = JSON.parse(await readFile(resolvedInput, "utf-8"));
  const validation = validateClientRequest(raw);
  if (!validation.valid) {
    console.error("   ❌ Invalid client request:");
    validation.errors?.forEach((e) => console.error(`      - ${e}`));
    process.exit(1);
  }
  console.log("   ✓ Client request valid");

  // 2. Resolve config
  console.log("2. Resolving build configuration...");
  const manifest = resolveConfig(validation.data!, templateId, moduleIds);
  console.log(`   ✓ Config resolved for "${manifest.siteConfig.business.name}"`);

  // 3. Generate site
  console.log("3. Generating site...");
  await mkdir(resolvedOutput, { recursive: true });
  const files = await generateSite(manifest, resolvedOutput, repoRoot);
  manifest.files = files;
  console.log(`   ✓ ${files.length} files generated`);

  // 4. Write build manifest
  console.log("4. Writing build-manifest.json...");
  await writeFile(
    join(resolvedOutput, "build-manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  console.log("   ✓ Build manifest written");

  // 5. Generate and write claude brief
  console.log("5. Writing claude-brief.md...");
  const brief = generateBrief(manifest);
  await writeFile(join(resolvedOutput, "claude-brief.md"), brief);
  console.log("   ✓ Claude brief written");

  // 6. Generate and write deployment payload
  console.log("6. Writing deployment-payload.json...");
  const payload = generateDeploymentPayload(manifest);
  await writeFile(
    join(resolvedOutput, "deployment-payload.json"),
    JSON.stringify(payload, null, 2)
  );
  console.log("   ✓ Deployment payload written");

  // 7. Generate workspace scaffolding (README, wrapper package.json, artifacts dir)
  console.log("7. Writing workspace files...");
  await generateWorkspace(manifest, resolvedOutput);
  console.log("   ✓ README.md, package.json, artifacts/ created");

  console.log(`\n✅ Generation complete!`);
  console.log(`   Output: ${resolvedOutput}`);
  console.log(`\n   To run locally:`);
  console.log(`   cd ${resolvedOutput}/site && npm install && npm run dev`);
  console.log(`\n   To capture screenshots (from repo root):`);
  console.log(`   pnpm -w review -- --target ${manifest.clientSlug}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
