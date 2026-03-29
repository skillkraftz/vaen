import { describe, expect, it } from "vitest";
import {
  getAuthoritativeSelectedModules,
  seedSelectedModulesFromRecommendations,
  selectedModulesEqual,
  syncDraftWithSelectedModules,
  validateSelectedModules,
} from "./module-selection";

describe("module selection helpers", () => {
  it("seeds selected modules from recommendations", () => {
    const selected = seedSelectedModulesFromRecommendations({
      template: { id: "service-core", reason: "best fit" },
      modules: [
        { id: "maps-embed", reason: "local" },
        { id: "manual-testimonials", reason: "reviews" },
      ],
    });

    expect(selected).toEqual([
      { id: "maps-embed" },
      { id: "manual-testimonials" },
    ]);
  });

  it("prefers authoritative selected_modules over recommendations", () => {
    const selected = getAuthoritativeSelectedModules({
      selected_modules: [{ id: "manual-testimonials" }],
      recommendations: {
        template: { id: "service-core", reason: "best fit" },
        modules: [{ id: "maps-embed", reason: "local" }],
      },
    });

    expect(selected).toEqual([{ id: "manual-testimonials" }]);
  });

  it("falls back to recommendations when selected_modules are empty", () => {
    const selected = getAuthoritativeSelectedModules({
      selected_modules: [],
      recommendations: {
        template: { id: "service-core", reason: "best fit" },
        modules: [{ id: "maps-embed", reason: "local" }],
      },
    });

    expect(selected).toEqual([{ id: "maps-embed" }]);
  });

  it("syncs request preferences.modules and moduleConfig", () => {
    const synced = syncDraftWithSelectedModules(
      {
        version: "1.0.0",
        business: {},
        contact: {},
        preferences: { template: "service-core" },
      },
      [
        { id: "maps-embed" },
        { id: "booking-lite", config: { provider: "calendly", embedUrl: "https://calendly.com/acme" } },
      ],
    );

    expect(synced.preferences).toEqual({
      template: "service-core",
      modules: ["maps-embed", "booking-lite"],
      moduleConfig: {
        "booking-lite": {
          provider: "calendly",
          embedUrl: "https://calendly.com/acme",
        },
      },
    });
  });

  it("validates config-heavy modules unless full config is provided", () => {
    expect(validateSelectedModules("service-core", [{ id: "booking-lite" }]))
      .toContain("not ready for operator selection");

    expect(validateSelectedModules("service-core", [
      { id: "booking-lite", config: { provider: "calendly", embedUrl: "https://calendly.com/acme" } },
    ])).toBeNull();
  });

  it("compares selected modules using normalized order and ids", () => {
    expect(selectedModulesEqual(
      [{ id: "maps-embed" }, { id: "manual-testimonials" }],
      [{ id: "maps-embed" }, { id: "manual-testimonials" }],
    )).toBe(true);
  });
});
