export interface DeploymentPayload {
  version: "1.0.0";
  clientSlug: string;
  sitePath: string;
  buildCommand: string;
  outputDir: string;
  framework: "nextjs";
  nodeVersion: string;
  envVars: Record<string, string>;
  domain: {
    subdomain: string;
    customDomain?: string;
  };
  metadata: {
    generatedAt: string;
    templateId: string;
    templateVersion: string;
    moduleIds: string[];
    businessName: string;
    businessType: string;
  };
}

export const deploymentPayloadSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "version",
    "clientSlug",
    "sitePath",
    "buildCommand",
    "outputDir",
    "framework",
    "nodeVersion",
    "envVars",
    "domain",
    "metadata",
  ],
  properties: {
    version: { type: "string", const: "1.0.0" },
    clientSlug: { type: "string" },
    sitePath: { type: "string" },
    buildCommand: { type: "string" },
    outputDir: { type: "string" },
    framework: { type: "string", const: "nextjs" },
    nodeVersion: { type: "string" },
    envVars: { type: "object", additionalProperties: { type: "string" } },
    domain: {
      type: "object",
      required: ["subdomain"],
      properties: {
        subdomain: { type: "string" },
        customDomain: { type: "string" },
      },
    },
    metadata: {
      type: "object",
      required: [
        "generatedAt",
        "templateId",
        "templateVersion",
        "moduleIds",
        "businessName",
        "businessType",
      ],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        templateId: { type: "string" },
        templateVersion: { type: "string" },
        moduleIds: { type: "array", items: { type: "string" } },
        businessName: { type: "string" },
        businessType: { type: "string" },
      },
    },
  },
} as const;
