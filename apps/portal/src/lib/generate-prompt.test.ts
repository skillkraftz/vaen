/**
 * Phase 3B tests for AI handoff prompt generation, import validation,
 * canonical request selection, and screenshot stabilization.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrompt, type PromptInput } from "./generate-prompt";

// ── Helpers ──────────────────────────────────────────────────────────

function baseInput(overrides?: Partial<PromptInput>): PromptInput {
  return {
    project: {
      name: "BrightSpark Electric",
      slug: "brightspark-electric",
      businessType: "electrician",
      contactName: "Dave Sparks",
      contactEmail: "dave@brightspark.com",
      contactPhone: "555-1234",
      notes: "We do residential and commercial electrical work in Denver metro.",
    },
    draftRequest: {
      version: "1.0.0",
      business: { name: "BrightSpark Electric", type: "electrician" },
      contact: { email: "dave@brightspark.com", phone: "555-1234" },
      services: [
        { name: "Panel Upgrades", description: "Upgrade your electrical panel." },
        { name: "Wiring", description: "New construction and retrofit wiring." },
      ],
      content: { about: "", heroHeadline: "", heroSubheadline: "" },
      preferences: { template: "service-core", modules: ["maps-embed"] },
    },
    recommendations: {
      template: { id: "service-core", name: "Service Core", reasoning: "local service business" },
      modules: [
        { id: "maps-embed", name: "Google Maps", reasoning: "has physical location" },
        { id: "manual-testimonials", name: "Testimonials", reasoning: "client mentioned reviews" },
      ],
    },
    clientSummary: "Local electrician serving Denver metro. Family-owned, 15 years experience.",
    missingInfo: [
      { field: "business.tagline", severity: "required", hint: "Needs a compelling tagline" },
      { field: "content.about", severity: "recommended", hint: "About section is empty" },
    ],
    ...overrides,
  };
}

// ── 1. generatePrompt() includes all required sections ───────────────

describe("generatePrompt includes all required sections", () => {
  it("contains role, output contract, client context, draft JSON, and final reminder", () => {
    const prompt = generatePrompt(baseInput());

    // Role & instruction
    expect(prompt).toContain("AI Copywriter");
    expect(prompt).toContain("expert website copywriter");

    // Output contract
    expect(prompt).toContain("Output contract");
    expect(prompt).toContain("Return ONLY a valid JSON object");
    expect(prompt).toContain("No commentary, no explanation, no markdown fencing");

    // Client context
    expect(prompt).toContain("Client context");
    expect(prompt).toContain("BrightSpark Electric");
    expect(prompt).toContain("dave@brightspark.com");

    // Client notes
    expect(prompt).toContain("Client notes");
    expect(prompt).toContain("residential and commercial electrical work in Denver");

    // Intake summary
    expect(prompt).toContain("Intake summary");
    expect(prompt).toContain("Family-owned, 15 years experience");

    // Current draft JSON
    expect(prompt).toContain("Current draft client-request.json");
    expect(prompt).toContain('"Panel Upgrades"');

    // Final reminder
    expect(prompt).toContain("Return ONLY the improved JSON");

    // JSON structure rules
    expect(prompt).toContain("JSON structure rules");
    expect(prompt).toContain("version");
    expect(prompt).toContain("business.name");

    // Copy improvement goals
    expect(prompt).toContain("Copy improvement goals");
  });

  it("omits intake summary when clientSummary is null", () => {
    const prompt = generatePrompt(baseInput({ clientSummary: null }));
    expect(prompt).not.toContain("Intake summary");
  });

  it("omits client notes when project.notes is null", () => {
    const prompt = generatePrompt(
      baseInput({
        project: {
          name: "Test",
          slug: "test",
          businessType: null,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          notes: null,
        },
      }),
    );
    expect(prompt).not.toContain("Client notes");
  });
});

// ── 2. Template-specific guidance changes with template ──────────────

describe("template-specific guidance", () => {
  it("service-core produces local service business guidance", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("local service business website");
    expect(prompt).toContain("Build immediate trust with homeowners");
    expect(prompt).toContain("Home, Contact");
  });

  it("service-area produces multi-location guidance", () => {
    const prompt = generatePrompt(
      baseInput({
        recommendations: {
          template: { id: "service-area", name: "Service Area", reasoning: "multiple locations" },
          modules: [],
        },
      }),
    );
    expect(prompt).toContain("multi-location service area website");
    expect(prompt).toContain("Establish coverage across multiple geographic areas");
    expect(prompt).toContain("Area pages");
  });

  it("authority produces professional expertise guidance", () => {
    const prompt = generatePrompt(
      baseInput({
        recommendations: {
          template: { id: "authority", name: "Authority", reasoning: "expert professional" },
          modules: [],
        },
      }),
    );
    expect(prompt).toContain("professional authority");
    expect(prompt).toContain("Establish the principal as a credentialed expert");
    expect(prompt).toContain("About, Services");
  });

  it("unknown template falls back to service-core guidance", () => {
    const prompt = generatePrompt(
      baseInput({
        recommendations: {
          template: { id: "unknown-template", name: "Unknown", reasoning: "test" },
          modules: [],
        },
      }),
    );
    expect(prompt).toContain("local service business website");
  });

  it("null recommendations defaults to service-core", () => {
    const prompt = generatePrompt(baseInput({ recommendations: null }));
    expect(prompt).toContain("local service business website");
    expect(prompt).toContain("service-core");
  });
});

// ── 3. Module descriptions appear when modules are selected ──────────

describe("module descriptions in prompt", () => {
  it("includes maps-embed description when selected", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("Active modules");
    expect(prompt).toContain("Google Maps");
    expect(prompt).toContain("maps-embed");
    expect(prompt).toContain("contact.address fields");
  });

  it("includes manual-testimonials description when selected", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("Testimonials");
    expect(prompt).toContain("manual-testimonials");
    expect(prompt).toContain("do not fabricate testimonials");
  });

  it("omits module section when no modules selected", () => {
    const prompt = generatePrompt(
      baseInput({
        recommendations: {
          template: { id: "service-core", name: "Service Core", reasoning: "test" },
          modules: [],
        },
      }),
    );
    expect(prompt).not.toContain("Active modules");
  });

  it("uses module reasoning as fallback for unknown module IDs", () => {
    const prompt = generatePrompt(
      baseInput({
        recommendations: {
          template: { id: "service-core", name: "Service Core", reasoning: "test" },
          modules: [
            { id: "custom-widget", name: "Custom Widget", reasoning: "client needs a custom feature" },
          ],
        },
      }),
    );
    expect(prompt).toContain("Custom Widget");
    expect(prompt).toContain("client needs a custom feature");
  });
});

// ── 4. Missing info gaps appear in prompt ────────────────────────────

describe("missing info gaps in prompt", () => {
  it("includes required and recommended gaps", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("Known gaps");
    expect(prompt).toContain("Required (must fill)");
    expect(prompt).toContain("business.tagline");
    expect(prompt).toContain("Needs a compelling tagline");
    expect(prompt).toContain("Recommended (fill if possible)");
    expect(prompt).toContain("content.about");
    expect(prompt).toContain("About section is empty");
  });

  it("omits gaps section when missingInfo is null", () => {
    const prompt = generatePrompt(baseInput({ missingInfo: null }));
    expect(prompt).not.toContain("Known gaps");
  });

  it("omits gaps section when missingInfo is empty", () => {
    const prompt = generatePrompt(baseInput({ missingInfo: [] }));
    expect(prompt).not.toContain("Known gaps");
  });

  it("shows only required when no recommended items", () => {
    const prompt = generatePrompt(
      baseInput({
        missingInfo: [
          { field: "business.name", severity: "required", hint: "Business name is missing" },
        ],
      }),
    );
    expect(prompt).toContain("Required (must fill)");
    expect(prompt).not.toContain("Recommended (fill if possible)");
  });

  it("shows only recommended when no required items", () => {
    const prompt = generatePrompt(
      baseInput({
        missingInfo: [
          { field: "branding.colors", severity: "recommended", hint: "No brand colors" },
        ],
      }),
    );
    expect(prompt).not.toContain("Required (must fill)");
    expect(prompt).toContain("Recommended (fill if possible)");
  });
});

// ── 5. Import validation rejects invalid JSON ────────────────────────
// We test the validation logic directly since server actions require Supabase.
// The importFinalRequestAction performs these exact checks.

describe("import validation logic", () => {
  function validateImport(
    parsed: Record<string, unknown>,
  ): string[] {
    const errors: string[] = [];
    if (parsed.version !== "1.0.0") {
      errors.push(`version must be "1.0.0", got "${parsed.version ?? "missing"}"`);
    }
    if (!parsed.business || typeof parsed.business !== "object") {
      errors.push("missing required field: business");
    } else {
      const biz = parsed.business as Record<string, unknown>;
      if (!biz.name) errors.push("missing required field: business.name");
      if (!biz.type) errors.push("missing required field: business.type");
    }
    if (!parsed.contact || typeof parsed.contact !== "object") {
      errors.push("missing required field: contact");
    }
    if (!Array.isArray(parsed.services)) {
      errors.push("missing required field: services (must be an array)");
    } else if (parsed.services.length === 0) {
      errors.push("services array must not be empty");
    }
    return errors;
  }

  it("accepts a valid complete request", () => {
    const valid = {
      version: "1.0.0",
      business: { name: "Acme Electric", type: "electrician" },
      contact: { email: "a@b.com" },
      services: [{ name: "Wiring" }],
    };
    expect(validateImport(valid)).toEqual([]);
  });

  it("rejects missing version", () => {
    const invalid = {
      business: { name: "Acme", type: "x" },
      contact: {},
      services: [{ name: "A" }],
    };
    const errors = validateImport(invalid);
    expect(errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects wrong version", () => {
    const invalid = {
      version: "2.0.0",
      business: { name: "Acme", type: "x" },
      contact: {},
      services: [{ name: "A" }],
    };
    const errors = validateImport(invalid);
    expect(errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("rejects missing business", () => {
    const invalid = {
      version: "1.0.0",
      contact: {},
      services: [{ name: "A" }],
    };
    const errors = validateImport(invalid);
    expect(errors.some((e) => e.includes("business"))).toBe(true);
  });

  it("rejects missing business.name", () => {
    const invalid = {
      version: "1.0.0",
      business: { type: "x" },
      contact: {},
      services: [{ name: "A" }],
    };
    const errors = validateImport(invalid);
    expect(errors.some((e) => e.includes("business.name"))).toBe(true);
  });

  it("rejects missing contact", () => {
    const invalid = {
      version: "1.0.0",
      business: { name: "Acme", type: "x" },
      services: [{ name: "A" }],
    };
    const errors = validateImport(invalid);
    expect(errors.some((e) => e.includes("contact"))).toBe(true);
  });

  it("rejects empty services array", () => {
    const invalid = {
      version: "1.0.0",
      business: { name: "Acme", type: "x" },
      contact: {},
      services: [],
    };
    const errors = validateImport(invalid);
    expect(errors.some((e) => e.includes("services"))).toBe(true);
  });

  it("rejects non-array services", () => {
    const invalid = {
      version: "1.0.0",
      business: { name: "Acme", type: "x" },
      contact: {},
      services: "not an array",
    };
    const errors = validateImport(invalid);
    expect(errors.some((e) => e.includes("services"))).toBe(true);
  });

  it("collects all errors at once", () => {
    const invalid = {} as Record<string, unknown>;
    const errors = validateImport(invalid);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ── 6. Canonical request selection (final > draft) ───────────────────
// Tests the selection logic used by exportToGeneratorAction.

describe("canonical request selection (final_request > draft_request)", () => {
  function selectCanonical(
    finalRequest: Record<string, unknown> | null,
    draftRequest: Record<string, unknown> | null,
  ): { source: Record<string, unknown> | null; label: "final" | "draft" | "none" } {
    // Mirrors the logic in exportToGeneratorAction
    const source = finalRequest ?? draftRequest;
    const label = finalRequest ? "final" : draftRequest ? "draft" : "none";
    return { source, label };
  }

  it("prefers final_request when both exist", () => {
    const final = { version: "1.0.0", business: { name: "Improved" } };
    const draft = { version: "1.0.0", business: { name: "Original" } };
    const result = selectCanonical(final, draft);
    expect(result.label).toBe("final");
    expect(result.source).toBe(final);
  });

  it("falls back to draft when final is null", () => {
    const draft = { version: "1.0.0", business: { name: "Original" } };
    const result = selectCanonical(null, draft);
    expect(result.label).toBe("draft");
    expect(result.source).toBe(draft);
  });

  it("returns none when both are null", () => {
    const result = selectCanonical(null, null);
    expect(result.label).toBe("none");
    expect(result.source).toBeNull();
  });
});

// ── Prompt quality: stronger hero guidance ────────────────────────────

describe("prompt quality: hero guidance", () => {
  it("includes banned headline patterns", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("BANNED patterns");
    expect(prompt).toContain("Trusted [profession] in [city]");
    expect(prompt).toContain("Your Local [profession] Experts");
    expect(prompt).toContain("Welcome to [Business Name]");
  });

  it("includes good and bad hero examples", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("Good headline examples");
    expect(prompt).toContain("Bad headline examples");
  });

  it("includes conversion-focused instruction", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("conversion");
    expect(prompt).toContain("reduce hesitation");
  });

  it("requires specificity in hero", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("specific to THIS business");
    expect(prompt).toContain("Why should I choose this business");
  });
});

// ── Prompt quality: anti-generic copy rules ──────────────────────────

describe("prompt quality: anti-generic copy rules", () => {
  it("includes anti-generic test", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("Could I swap in a different business name");
    expect(prompt).toContain("too generic");
  });

  it("bans filler phrases", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("dedicated to excellence");
    expect(prompt).toContain("committed to quality");
    expect(prompt).toContain("state-of-the-art");
  });

  it("requires business-specific details", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("years in business");
    expect(prompt).toContain("specific capabilities");
  });
});

// ── Prompt quality: service completeness ─────────────────────────────

describe("prompt quality: implied services preserved", () => {
  it("explicitly forbids dropping services", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("Do NOT drop services");
    expect(prompt).toContain("Do NOT drop or omit services");
    expect(prompt).toContain("CRITICAL: Do not remove or drop any services");
  });

  it("requires adding services mentioned in notes but not draft", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("mention services not in the draft, ADD them");
  });

  it("includes service quality guidance", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("What does the customer get");
    expect(prompt).toContain("benefit-oriented");
  });

  it("final checklist includes services check", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("All services from the draft are present");
  });
});

// ── Prompt quality: final checklist ──────────────────────────────────

describe("prompt quality: final checklist", () => {
  it("includes pre-return checklist", () => {
    const prompt = generatePrompt(baseInput());
    expect(prompt).toContain("Checklist before returning");
    expect(prompt).toContain("Hero headline is specific");
    expect(prompt).toContain("No banned headline patterns");
    expect(prompt).toContain("valid JSON");
  });
});

// ── 7. Screenshot stabilization delay exists ─────────────────────────

describe("screenshot stabilization delay", () => {
  it("captureScreenshots source contains waitForTimeout stabilization delay", () => {
    // Read the source file to verify the delay is present
    const screenshotPath = join(
      __dirname,
      "../../../../packages/review-tools/src/screenshot.ts",
    );
    const source = readFileSync(screenshotPath, "utf-8");

    // Must have a waitForTimeout call after networkidle
    expect(source).toContain("waitUntil: \"networkidle\"");
    expect(source).toContain("waitForTimeout");

    // The delay should be at least 1000ms
    const match = source.match(/waitForTimeout\((\d+)\)/);
    expect(match).not.toBeNull();
    const delayMs = parseInt(match![1], 10);
    expect(delayMs).toBeGreaterThanOrEqual(1000);
  });
});
