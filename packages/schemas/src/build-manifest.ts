export interface BuildManifest {
  version: "1.0.0";
  generatedAt: string;
  clientSlug: string;
  template: {
    id: string;
    version: string;
  };
  modules: Array<{
    id: string;
    version: string;
    config: Record<string, unknown>;
  }>;
  siteConfig: {
    business: {
      name: string;
      type: string;
      tagline: string;
      description: string;
    };
    contact: {
      phone?: string;
      email?: string;
      address?: {
        street?: string;
        city: string;
        state: string;
        zip: string;
        formatted: string;
      };
    };
    seo: {
      title: string;
      description: string;
      ogImage?: string;
    };
    branding: {
      primaryColor: string;
      secondaryColor: string;
      accentColor: string;
      fontFamily: string;
    };
    services: Array<{
      name: string;
      description: string;
      price?: string;
    }>;
    hero: {
      headline: string;
      subheadline: string;
    };
    about: string;
    testimonials: Array<{
      name: string;
      text: string;
      rating?: number;
    }>;
    gallery: Array<{
      url: string;
      alt: string;
    }>;
  };
  pages: string[];
  files: string[];
}

export const buildManifestSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["version", "generatedAt", "clientSlug", "template", "modules", "siteConfig", "pages", "files"],
  properties: {
    version: { type: "string", const: "1.0.0" },
    generatedAt: { type: "string", format: "date-time" },
    clientSlug: { type: "string" },
    template: {
      type: "object",
      required: ["id", "version"],
      properties: {
        id: { type: "string" },
        version: { type: "string" },
      },
    },
    modules: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "version", "config"],
        properties: {
          id: { type: "string" },
          version: { type: "string" },
          config: { type: "object" },
        },
      },
    },
    siteConfig: { type: "object" },
    pages: { type: "array", items: { type: "string" } },
    files: { type: "array", items: { type: "string" } },
  },
} as const;
