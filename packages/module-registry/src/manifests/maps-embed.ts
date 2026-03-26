import type { ModuleManifest } from "../types.js";

export const mapsEmbedManifest: ModuleManifest = {
  id: "maps-embed",
  name: "Maps Embed",
  version: "0.1.0",
  description: "Google Maps iframe embed showing business location",
  status: "active",
  type: "component",
  path: "modules/maps-embed",
  compatibleTemplates: "*",
  configSchema: {
    required: ["address"],
    optional: ["zoom", "height", "width"],
  },
  provides: {
    components: ["MapEmbed"],
  },
};
