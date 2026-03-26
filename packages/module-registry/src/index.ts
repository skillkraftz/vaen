export type { ModuleManifest } from "./types.js";

export { mapsEmbedManifest } from "./manifests/maps-embed.js";
export { manualTestimonialsManifest } from "./manifests/manual-testimonials.js";
export { googleReviewsLiveManifest } from "./manifests/google-reviews-live.js";
export { bookingLiteManifest } from "./manifests/booking-lite.js";

import { mapsEmbedManifest } from "./manifests/maps-embed.js";
import { manualTestimonialsManifest } from "./manifests/manual-testimonials.js";
import { googleReviewsLiveManifest } from "./manifests/google-reviews-live.js";
import { bookingLiteManifest } from "./manifests/booking-lite.js";
import type { ModuleManifest } from "./types.js";

const modules: Record<string, ModuleManifest> = {
  "maps-embed": mapsEmbedManifest,
  "manual-testimonials": manualTestimonialsManifest,
  "google-reviews-live": googleReviewsLiveManifest,
  "booking-lite": bookingLiteManifest,
};

export function getModule(id: string): ModuleManifest | undefined {
  return modules[id];
}

export function listModules(): ModuleManifest[] {
  return Object.values(modules);
}

export function listActiveModules(): ModuleManifest[] {
  return Object.values(modules).filter((m) => m.status === "active");
}

export function getModulesForTemplate(templateId: string): ModuleManifest[] {
  return Object.values(modules).filter(
    (m) =>
      m.compatibleTemplates === "*" ||
      m.compatibleTemplates.includes(templateId)
  );
}
