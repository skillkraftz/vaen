import { cp, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import type { BuildManifest } from "@vaen/schemas";

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
      files.push(...(await listFilesRecursive(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

export async function generateSite(
  manifest: BuildManifest,
  outputDir: string,
  repoRoot: string
): Promise<string[]> {
  const siteDir = join(outputDir, "site");
  const templateSource = resolve(
    repoRoot,
    "templates",
    manifest.template.id
  );

  // Copy template to output
  await mkdir(siteDir, { recursive: true });
  await cp(templateSource, siteDir, {
    recursive: true,
    filter: (src) => {
      const name = src.split("/").pop() ?? "";
      return name !== "node_modules" && name !== ".next" && name !== "dist";
    },
  });

  // Build the full config including modules
  const mapsModule = manifest.modules.find((m) => m.id === "maps-embed");
  const testimonialsModule = manifest.modules.find(
    (m) => m.id === "manual-testimonials"
  );

  const fullConfig = {
    ...manifest.siteConfig,
    modules: {
      mapsEmbed: {
        enabled: !!mapsModule?.config.enabled,
        address: (mapsModule?.config.address as string) ?? "",
      },
      testimonials: {
        enabled: !!testimonialsModule?.config.enabled,
      },
    },
  };

  // Write site config — the template's getSiteConfig() reads this via require("../../config.json")
  const configPath = join(siteDir, "config.json");
  await writeFile(configPath, JSON.stringify(fullConfig, null, 2));

  // Update package.json with client-specific name
  const pkgPath = join(siteDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  pkg.name = manifest.clientSlug;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2));

  // List all generated files
  const allFiles = await listFilesRecursive(siteDir);
  return allFiles.map((f) => relative(outputDir, f));
}
