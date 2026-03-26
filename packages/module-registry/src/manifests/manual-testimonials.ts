import type { ModuleManifest } from "../types.js";

export const manualTestimonialsManifest: ModuleManifest = {
  id: "manual-testimonials",
  name: "Manual Testimonials",
  version: "0.1.0",
  description:
    "Static testimonials section populated from client intake data",
  status: "active",
  type: "component",
  path: "modules/manual-testimonials",
  compatibleTemplates: "*",
  configSchema: {
    required: ["testimonials"],
    optional: ["layout", "maxDisplay"],
  },
  provides: {
    components: ["TestimonialsSection"],
  },
};
