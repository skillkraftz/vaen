import type { ModuleManifest } from "../types.js";

export const googleReviewsLiveManifest: ModuleManifest = {
  id: "google-reviews-live",
  name: "Google Reviews Live",
  version: "0.1.0",
  description:
    "Live Google Reviews integration via Google Places API with caching",
  status: "draft",
  type: "integration",
  path: "modules/google-reviews-live",
  compatibleTemplates: "*",
  configSchema: {
    required: ["googlePlaceId"],
    optional: ["maxReviews", "cacheMinutes", "minRating"],
  },
  provides: {
    components: ["GoogleReviews"],
  },
};
