/**
 * Tests for intake processing: missing-info derivation, service extraction,
 * template/module recommendations, and client summary generation.
 *
 * These prove that the portal's missing-info panel and recommendations
 * are derived from canonical current data — not stale cached flags.
 */
import { describe, it, expect } from "vitest";
import {
  processIntake,
  detectMissingInfo,
  type IntakeProcessingResult,
} from "./intake-processor";
import type { Project, Asset, MissingInfoItem } from "./types";

// ── Fixtures ─────────────────────────────────────────────────────────

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-001",
    user_id: "user-001",
    name: "Test Business",
    slug: "test-business",
    status: "intake_received",
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    business_type: null,
    notes: null,
    metadata: {},
    client_summary: null,
    draft_request: null,
    final_request: null,
    missing_info: null,
    recommendations: null,
    current_revision_id: null,
    last_exported_revision_id: null,
    last_generated_revision_id: null,
    last_reviewed_revision_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function completeProject(): Project {
  return baseProject({
    name: "BrightSpark Electric",
    slug: "brightspark-electric",
    contact_name: "John Spark",
    contact_email: "john@brightspark.com",
    contact_phone: "555-0100",
    business_type: "Electrician",
    notes: "We offer panel upgrades, wiring, and lighting installation. We've been serving the Portland area for 15 years.",
    draft_request: {
      version: "1.0.0",
      business: { name: "BrightSpark Electric", type: "electrician" },
      contact: { email: "john@brightspark.com" },
      services: [{ name: "Panel Upgrades" }, { name: "Wiring" }],
    },
  });
}

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-001",
    project_id: "proj-001",
    file_name: "logo.png",
    file_type: "image/png",
    file_size: 50000,
    storage_path: "proj-001/logo.png",
    category: "image",
    asset_type: null,
    source_job_id: null,
    request_revision_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function findMissing(items: MissingInfoItem[], field: string): MissingInfoItem | undefined {
  return items.find((m) => m.field === field);
}

// ── detectMissingInfo ────────────────────────────────────────────────

describe("detectMissingInfo", () => {
  describe("required fields", () => {
    it("flags missing business_type as required", () => {
      const p = baseProject({ contact_email: "a@b.com" });
      const items = detectMissingInfo(p, []);
      const bt = findMissing(items, "business_type");
      expect(bt).toBeDefined();
      expect(bt!.severity).toBe("required");
    });

    it("flags missing contact info as required", () => {
      const p = baseProject({ business_type: "Plumber" });
      const items = detectMissingInfo(p, []);
      const contact = findMissing(items, "contact");
      expect(contact).toBeDefined();
      expect(contact!.severity).toBe("required");
    });

    it("does not flag contact when email is present", () => {
      const p = baseProject({ contact_email: "a@b.com", business_type: "Plumber" });
      const items = detectMissingInfo(p, []);
      expect(findMissing(items, "contact")).toBeUndefined();
    });

    it("does not flag contact when phone is present", () => {
      const p = baseProject({ contact_phone: "555-1234", business_type: "Plumber" });
      const items = detectMissingInfo(p, []);
      expect(findMissing(items, "contact")).toBeUndefined();
    });
  });

  describe("services detection", () => {
    it("flags missing services when nothing can be inferred", () => {
      const p = baseProject({
        business_type: "Custom Type XYZ",
        contact_email: "a@b.com",
      });
      const items = detectMissingInfo(p, []);
      const svc = findMissing(items, "services");
      expect(svc).toBeDefined();
      expect(svc!.severity).toBe("required");
    });

    it("shows recommended (not required) when services can be inferred from business type", () => {
      const p = baseProject({
        business_type: "Electrician",
        contact_email: "a@b.com",
      });
      const items = detectMissingInfo(p, []);
      const svc = findMissing(items, "services");
      expect(svc).toBeDefined();
      expect(svc!.severity).toBe("recommended");
    });

    it("services warning disappears when notes contain extractable services", () => {
      const p = baseProject({
        business_type: "Custom Type XYZ",
        contact_email: "a@b.com",
        notes: "We offer custom woodworking, furniture repair, and cabinet installation.",
      });
      const items = detectMissingInfo(p, []);
      expect(findMissing(items, "services")).toBeUndefined();
    });

    it("services warning disappears when draft_request has services", () => {
      const p = baseProject({
        business_type: "Custom Type XYZ",
        contact_email: "a@b.com",
        draft_request: {
          services: [{ name: "Custom Service" }],
        },
      });
      const items = detectMissingInfo(p, []);
      expect(findMissing(items, "services")).toBeUndefined();
    });

    it("services warning disappears when business type yields inferred services", () => {
      const p = baseProject({
        business_type: "Plumber",
        contact_email: "a@b.com",
      });
      const items = detectMissingInfo(p, []);
      const svc = findMissing(items, "services");
      // Should be recommended (inferred available), NOT required
      expect(svc?.severity).not.toBe("required");
    });
  });

  describe("recommended fields", () => {
    it("flags missing contact_name as recommended", () => {
      const p = completeProject();
      const pNoName = { ...p, contact_name: null };
      const items = detectMissingInfo(pNoName, []);
      const cn = findMissing(items, "contact_name");
      expect(cn).toBeDefined();
      expect(cn!.severity).toBe("recommended");
    });

    it("flags short/missing notes as recommended", () => {
      const p = baseProject({
        business_type: "Plumber",
        contact_email: "a@b.com",
        notes: "Short",
      });
      const items = detectMissingInfo(p, []);
      const notes = findMissing(items, "notes");
      expect(notes).toBeDefined();
      expect(notes!.severity).toBe("recommended");
    });

    it("flags missing images as recommended", () => {
      const p = completeProject();
      const items = detectMissingInfo(p, []);
      const img = findMissing(items, "images");
      expect(img).toBeDefined();
      expect(img!.severity).toBe("recommended");
    });

    it("does not flag images when image assets exist", () => {
      const p = completeProject();
      const items = detectMissingInfo(p, [makeAsset({ category: "image" })]);
      expect(findMissing(items, "images")).toBeUndefined();
    });
  });

  describe("optional fields", () => {
    it("flags missing email as optional", () => {
      const p = baseProject({ contact_phone: "555-1234", business_type: "Plumber" });
      const items = detectMissingInfo(p, []);
      const email = findMissing(items, "contact_email");
      expect(email).toBeDefined();
      expect(email!.severity).toBe("optional");
    });

    it("flags missing phone as optional", () => {
      const p = baseProject({ contact_email: "a@b.com", business_type: "Plumber" });
      const items = detectMissingInfo(p, []);
      const phone = findMissing(items, "contact_phone");
      expect(phone).toBeDefined();
      expect(phone!.severity).toBe("optional");
    });

    it("flags missing audio as optional", () => {
      const p = completeProject();
      const items = detectMissingInfo(p, [makeAsset({ category: "image" })]);
      const audio = findMissing(items, "audio");
      expect(audio).toBeDefined();
      expect(audio!.severity).toBe("optional");
    });
  });

  describe("complete project has minimal missing info", () => {
    it("complete project with images has no required missing fields", () => {
      const p = completeProject();
      const assets = [makeAsset({ category: "image" })];
      const items = detectMissingInfo(p, assets);
      const required = items.filter((m) => m.severity === "required");
      expect(required).toHaveLength(0);
    });
  });
});

// ── processIntake ────────────────────────────────────────────────────

describe("processIntake", () => {
  it("generates all four outputs", () => {
    const p = completeProject();
    const result = processIntake(p, []);
    expect(result.clientSummary).toBeTruthy();
    expect(result.draftRequest).toBeTruthy();
    expect(result.missingInfo).toBeDefined();
    expect(result.recommendations).toBeDefined();
  });

  describe("draft request generation", () => {
    it("includes version, business, contact, services", () => {
      const p = completeProject();
      const result = processIntake(p, []);
      expect(result.draftRequest.version).toBe("1.0.0");
      expect(result.draftRequest.business).toBeDefined();
      expect(result.draftRequest.contact).toBeDefined();
      expect(result.draftRequest.services).toBeDefined();
    });

    it("extracts services from notes", () => {
      const p = baseProject({
        business_type: "Handyman",
        contact_email: "a@b.com",
        notes: "We offer plumbing, electrical work, and painting.",
      });
      const result = processIntake(p, []);
      const services = result.draftRequest.services as Array<{ name: string }>;
      expect(services.length).toBeGreaterThanOrEqual(2);
    });

    it("infers services from business type when notes have no services", () => {
      const p = baseProject({
        business_type: "Electrician",
        contact_email: "a@b.com",
        notes: "Been in business 10 years.",
      });
      const result = processIntake(p, []);
      const services = result.draftRequest.services as Array<{ name: string }>;
      expect(services.length).toBeGreaterThan(0);
      expect(services.some((s) => s.name.toLowerCase().includes("electrical") || s.name.toLowerCase().includes("wiring") || s.name.toLowerCase().includes("panel"))).toBe(true);
    });

    it("preserves existing draft services (user edits) over inferred", () => {
      const p = baseProject({
        business_type: "Electrician",
        contact_email: "a@b.com",
        draft_request: {
          services: [{ name: "My Custom Service" }],
        },
      });
      const result = processIntake(p, []);
      const services = result.draftRequest.services as Array<{ name: string }>;
      expect(services).toEqual([{ name: "My Custom Service" }]);
    });

    it("preserves prospect intake metadata when rebuilding the draft", () => {
      const p = baseProject({
        name: "Audit Run Co",
        business_type: "Painting contractor",
        contact_name: "Alex",
        contact_email: "alex@example.com",
        contact_phone: "(555) 111-2222",
        notes: "High-touch residential repaint projects",
        draft_request: {
          version: "1.0.0",
          business: { name: "Audit Run Co", type: "Painting contractor" },
          contact: { name: "Alex", email: "alex@example.com", phone: "(555) 111-2222" },
          services: [{ name: "Interior Painting" }],
          content: {
            about: "High-touch residential repaint projects",
          },
          preferences: {},
          _intake: {
            websiteUrl: "https://audit-run.example",
            source: "csv_import",
            campaign: "Spring Push",
            outreachSummary: "Outdated site and weak call to action",
            sourceProspectId: "prospect-123",
          },
        },
      });

      const result = processIntake(p, []);
      expect(result.draftRequest.contact).toEqual(
        expect.objectContaining({
          name: "Alex",
          email: "alex@example.com",
          phone: "(555) 111-2222",
        }),
      );
      expect(result.draftRequest.content).toEqual(
        expect.objectContaining({
          about: "High-touch residential repaint projects",
        }),
      );
      expect(result.draftRequest._intake).toEqual(
        expect.objectContaining({
          businessName: "Audit Run Co",
          businessType: "Painting contractor",
          contactName: "Alex",
          contactEmail: "alex@example.com",
          contactPhone: "(555) 111-2222",
          notes: "High-touch residential repaint projects",
          websiteUrl: "https://audit-run.example",
          source: "csv_import",
          campaign: "Spring Push",
          outreachSummary: "Outdated site and weak call to action",
          sourceProspectId: "prospect-123",
        }),
      );
    });

    it("preserves existing about content when notes are absent", () => {
      const p = baseProject({
        business_type: "Electrician",
        contact_email: "a@b.com",
        draft_request: {
          version: "1.0.0",
          business: { name: "Test Business", type: "Electrician" },
          contact: { email: "a@b.com" },
          services: [{ name: "Panel Upgrades" }],
          content: {
            about: "Imported website summary",
          },
        },
      });

      const result = processIntake(p, []);
      expect(result.draftRequest.content).toEqual(
        expect.objectContaining({
          about: "Imported website summary",
        }),
      );
    });
  });

  describe("recommendations", () => {
    it("recommends service-core template for standard local businesses", () => {
      const p = completeProject();
      const result = processIntake(p, []);
      expect(result.recommendations.template.id).toBe("service-core");
    });

    it("recommends authority template for professional services", () => {
      const p = baseProject({
        business_type: "Attorney",
        contact_email: "a@b.com",
        notes: "Legal services for small businesses.",
      });
      const result = processIntake(p, []);
      expect(result.recommendations.template.id).toBe("authority");
    });

    it("recommends service-area template for multi-location businesses", () => {
      const p = baseProject({
        business_type: "Plumber",
        contact_email: "a@b.com",
        notes: "We cover multiple locations across the metro area.",
      });
      const result = processIntake(p, []);
      expect(result.recommendations.template.id).toBe("service-area");
    });

    it("always includes maps-embed module", () => {
      const p = completeProject();
      const result = processIntake(p, []);
      expect(result.recommendations.modules.some((m) => m.id === "maps-embed")).toBe(true);
    });

    it("recommends booking-lite when notes mention scheduling", () => {
      const p = baseProject({
        business_type: "Plumber",
        contact_email: "a@b.com",
        notes: "Customers should be able to book an appointment online.",
      });
      const result = processIntake(p, []);
      expect(result.recommendations.modules.some((m) => m.id === "booking-lite")).toBe(true);
    });

    it("recommends manual-testimonials when notes mention reviews", () => {
      const p = baseProject({
        business_type: "Plumber",
        contact_email: "a@b.com",
        notes: "We have great testimonials from customers.",
      });
      const result = processIntake(p, []);
      expect(result.recommendations.modules.some((m) => m.id === "manual-testimonials")).toBe(true);
    });
  });

  describe("client summary", () => {
    it("includes project name", () => {
      const p = completeProject();
      const result = processIntake(p, []);
      expect(result.clientSummary).toContain("BrightSpark Electric");
    });

    it("includes missing info section when there are missing fields", () => {
      const p = baseProject({ business_type: "Plumber", contact_email: "a@b.com" });
      const result = processIntake(p, []);
      // Should mention recommended missing info
      expect(result.clientSummary).toContain("Missing Information");
    });

    it("includes uploaded assets section when assets exist", () => {
      const p = completeProject();
      const assets = [makeAsset({ file_name: "storefront.jpg", category: "image" })];
      const result = processIntake(p, assets);
      expect(result.clientSummary).toContain("Uploaded Assets");
      expect(result.clientSummary).toContain("storefront.jpg");
    });
  });
});

// ── Service extraction edge cases ────────────────────────────────────

describe("service extraction from notes", () => {
  it("extracts bullet-pointed services", () => {
    const p = baseProject({
      business_type: "Handyman",
      contact_email: "a@b.com",
      notes: "Our services:\n- Plumbing\n- Electrical\n- Painting",
    });
    const result = processIntake(p, []);
    const services = result.draftRequest.services as Array<{ name: string }>;
    expect(services.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts numbered services", () => {
    const p = baseProject({
      business_type: "Handyman",
      contact_email: "a@b.com",
      notes: "1. Roof repair\n2. Gutter installation\n3. Siding",
    });
    const result = processIntake(p, []);
    const services = result.draftRequest.services as Array<{ name: string }>;
    expect(services.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts comma-separated services after trigger phrase", () => {
    const p = baseProject({
      business_type: "Handyman",
      contact_email: "a@b.com",
      notes: "We offer deck building, fence installation, and pressure washing.",
    });
    const result = processIntake(p, []);
    const services = result.draftRequest.services as Array<{ name: string }>;
    expect(services.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Full happy path simulation ───────────────────────────────────────
// Simulates: create project → process intake → edit draft → recompute missing info

describe("happy path: intake → edit → recompute", () => {
  it("process intake, edit draft, missing info reflects edits", () => {
    // Step 1: Process intake on a minimal project
    const p = baseProject({
      business_type: "Electrician",
      contact_email: "john@test.com",
    });
    const result = processIntake(p, []);

    // After processing, there should be inferred services
    expect((result.draftRequest.services as unknown[]).length).toBeGreaterThan(0);

    // Step 2: Simulate user editing the project to add more info
    const editedProject = baseProject({
      business_type: "Electrician",
      contact_email: "john@test.com",
      contact_name: "John",
      notes: "We specialize in residential electrical work and smart home installation.",
      draft_request: {
        ...result.draftRequest,
        services: [{ name: "Residential Electrical" }, { name: "Smart Home" }],
      },
    });

    // Step 3: Recompute missing info from canonical current state
    const liveMissing = detectMissingInfo(editedProject, []);

    // contact_name was added → no longer missing
    expect(findMissing(liveMissing, "contact_name")).toBeUndefined();

    // services exist in draft → no services warning
    expect(findMissing(liveMissing, "services")).toBeUndefined();

    // notes are now detailed enough → no notes warning
    expect(findMissing(liveMissing, "notes")).toBeUndefined();

    // Still missing: images, audio, phone (optional/recommended)
    expect(findMissing(liveMissing, "images")?.severity).toBe("recommended");
  });
});
