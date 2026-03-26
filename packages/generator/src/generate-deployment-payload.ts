import type { BuildManifest, DeploymentPayload } from "@vaen/schemas";

export function generateDeploymentPayload(
  manifest: BuildManifest
): DeploymentPayload {
  return {
    version: "1.0.0",
    clientSlug: manifest.clientSlug,
    sitePath: "./site",
    buildCommand: "pnpm build",
    outputDir: ".next",
    framework: "nextjs",
    nodeVersion: "18",
    envVars: {},
    domain: {
      subdomain: manifest.clientSlug,
      customDomain: undefined,
    },
    metadata: {
      generatedAt: manifest.generatedAt,
      templateId: manifest.template.id,
      templateVersion: manifest.template.version,
      moduleIds: manifest.modules.map((m) => m.id),
      businessName: manifest.siteConfig.business.name,
      businessType: manifest.siteConfig.business.type,
    },
  };
}
