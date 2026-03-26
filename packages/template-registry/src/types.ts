export interface TemplateManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  status: "active" | "draft" | "deprecated";
  framework: "nextjs";
  path: string;
  supportedModules: string[];
  pages: string[];
  configSchema: {
    required: string[];
    optional: string[];
  };
  defaults: {
    branding: {
      primaryColor: string;
      secondaryColor: string;
      accentColor: string;
      fontFamily: string;
    };
  };
}
