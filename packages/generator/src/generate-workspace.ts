import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BuildManifest } from "@vaen/schemas";

export async function generateWorkspace(
  manifest: BuildManifest,
  outputDir: string
): Promise<void> {
  // Create artifacts directory
  await mkdir(join(outputDir, "artifacts", "screenshots"), { recursive: true });

  // Write workspace package.json that proxies into site/
  const workspacePkg = {
    name: `${manifest.clientSlug}-workspace`,
    version: "0.1.0",
    private: true,
    scripts: {
      install: "cd site && npm install",
      dev: "cd site && npm run dev",
      build: "cd site && npm run build",
      start: "cd site && npm run start",
    },
  };
  await writeFile(
    join(outputDir, "package.json"),
    JSON.stringify(workspacePkg, null, 2) + "\n"
  );

  // Write README
  const readme = generateReadme(manifest, outputDir);
  await writeFile(join(outputDir, "README.md"), readme);
}

function generateReadme(manifest: BuildManifest, _outputDir: string): string {
  const biz = manifest.siteConfig.business;
  const modules = manifest.modules.map((m) => m.id).join(", ") || "(none)";

  return `# ${biz.name}

Generated website workspace for **${biz.name}** (${biz.type}).

- **Template:** ${manifest.template.id} v${manifest.template.version}
- **Modules:** ${modules}
- **Generated:** ${manifest.generatedAt}

## Quick Start

### 1. Install dependencies
\`\`\`bash
cd site
npm install
\`\`\`

### 2. Run locally
\`\`\`bash
cd site
npm run dev
# Open http://localhost:3000
\`\`\`

### 3. Build for production
\`\`\`bash
cd site
npm run build
\`\`\`

## Files

| File | Description |
|------|-------------|
| \`site/\` | Next.js project — the actual website |
| \`build-manifest.json\` | Resolved build plan (template, modules, config) |
| \`claude-brief.md\` | AI review brief — what was generated and why |
| \`deployment-payload.json\` | Deployment config for vaen.space |
| \`artifacts/\` | Screenshots and review outputs |

## Screenshots

To capture review screenshots (from the vaen repo root):
\`\`\`bash
pnpm review -- --target ${manifest.clientSlug}
\`\`\`

Screenshots are saved to \`artifacts/screenshots/\`.
`;
}
