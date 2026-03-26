import type { TemplateManifest } from "../types.js";

export const serviceAreaManifest: TemplateManifest = {
  id: "service-area",
  name: "Service Area",
  version: "0.1.0",
  description:
    "Multi-location template for businesses serving multiple geographic areas with location-specific pages",
  status: "draft",
  framework: "nextjs",
  path: "templates/service-area",
  supportedModules: [
    "maps-embed",
    "manual-testimonials",
    "google-reviews-live",
    "booking-lite",
  ],
  pages: ["/", "/contact", "/areas/[area]"],
  configSchema: {
    required: [
      "business.name",
      "business.type",
      "contact",
      "services",
      "serviceAreas",
    ],
    optional: [
      "branding",
      "content.about",
      "content.heroHeadline",
      "content.testimonials",
    ],
  },
  defaults: {
    branding: {
      primaryColor: "#059669",
      secondaryColor: "#047857",
      accentColor: "#f59e0b",
      fontFamily: "Inter, system-ui, sans-serif",
    },
  },
};
