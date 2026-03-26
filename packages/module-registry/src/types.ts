export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  status: "active" | "draft" | "deprecated";
  type: "component" | "integration" | "data";
  path: string;
  compatibleTemplates: string[] | "*";
  configSchema: {
    required: string[];
    optional: string[];
  };
  provides: {
    components?: string[];
    dataFiles?: string[];
  };
  dependencies?: string[];
}
