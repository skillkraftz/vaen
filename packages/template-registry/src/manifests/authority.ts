import type { TemplateManifest } from "../types.js";

export const authorityManifest: TemplateManifest = {
  id: "authority",
  name: "Authority",
  version: "0.1.0",
  description:
    "Professional services template emphasizing expertise, credentials, and thought leadership",
  status: "draft",
  framework: "nextjs",
  path: "templates/authority",
  supportedModules: [
    "manual-testimonials",
    "google-reviews-live",
    "booking-lite",
  ],
  pages: ["/", "/about", "/services", "/contact"],
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
      "content.credentials",
      "content.testimonials",
    ],
  },
  defaults: {
    branding: {
      primaryColor: "#1e293b",
      secondaryColor: "#334155",
      accentColor: "#c084fc",
      fontFamily: "'Playfair Display', Georgia, serif",
    },
  },
};
