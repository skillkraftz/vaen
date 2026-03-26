import type { ModuleManifest } from "../types.js";

export const bookingLiteManifest: ModuleManifest = {
  id: "booking-lite",
  name: "Booking Lite",
  version: "0.1.0",
  description:
    "Lightweight booking/scheduling embed supporting Calendly, Cal.com, or custom iframe",
  status: "draft",
  type: "integration",
  path: "modules/booking-lite",
  compatibleTemplates: "*",
  configSchema: {
    required: ["provider", "embedUrl"],
    optional: ["height", "buttonText"],
  },
  provides: {
    components: ["BookingEmbed"],
  },
};
