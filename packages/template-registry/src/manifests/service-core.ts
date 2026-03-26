import type { TemplateManifest } from "../types.js";

export const serviceCoreManifest: TemplateManifest = {
  id: "service-core",
  name: "Service Core",
  version: "0.1.0",
  description:
    "General-purpose template for local service businesses (painters, plumbers, landscapers, etc.)",
  status: "active",
  framework: "nextjs",
  path: "templates/service-core",
  supportedModules: [
    "maps-embed",
    "manual-testimonials",
    "google-reviews-live",
    "booking-lite",
  ],
  pages: ["/", "/contact"],
  configSchema: {
    required: [
      "business.name",
      "business.type",
      "contact",
      "services",
    ],
    optional: [
      "branding",
      "content.about",
      "content.heroHeadline",
      "content.heroSubheadline",
      "content.testimonials",
      "content.galleryImages",
    ],
  },
  defaults: {
    branding: {
      primaryColor: "#2563eb",
      secondaryColor: "#1e40af",
      accentColor: "#f59e0b",
      fontFamily: "Inter, system-ui, sans-serif",
    },
  },
};
