/**
 * Tests for draft-request merge, validation, and defaults logic.
 *
 * These prove that portal edits cannot destroy required fields,
 * that merging works correctly at any depth, and that corrupted
 * drafts are detected before export.
 */
import { describe, it, expect } from "vitest";
import {
  deepMergeDraft,
  deepSetServer,
  validateDraftRequired,
  ensureDraftDefaults,
  DRAFT_DEFAULTS,
  REQUIRED_DRAFT_KEYS,
} from "./draft-helpers";

// ── Helpers ──────────────────────────────────────────────────────────

/** A realistic complete draft as the generator expects it */
function completeDraft(): Record<string, unknown> {
  return {
    version: "1.0.0",
    business: { name: "Acme Electric", type: "electrician" },
    contact: { email: "test@acme.com", phone: "555-1234" },
    services: [
      { name: "Panel Upgrades" },
      { name: "Wiring" },
    ],
    content: { about: "We do great electrical work." },
    preferences: { template: "service-core", modules: ["maps-embed"] },
  };
}

/** A historically-corrupted draft missing required keys */
function corruptedDraft(): Record<string, unknown> {
  return {
    services: [{ name: "Painting" }],
    content: { about: "Paint things" },
  };
}

// ── deepMergeDraft ───────────────────────────────────────────────────

describe("deepMergeDraft", () => {
  it("source overrides scalar fields in target", () => {
    const target = { version: "0.9.0", business: { name: "Old" } };
    const source = { version: "1.0.0" };
    const result = deepMergeDraft(target, source);
    expect(result.version).toBe("1.0.0");
    // target field not in source is preserved
    expect(result.business).toEqual({ name: "Old" });
  });

  it("recursively merges nested objects", () => {
    const target = { business: { name: "Acme", type: "electric" }, version: "1.0.0" };
    const source = { business: { name: "Acme Electric" } };
    const result = deepMergeDraft(target, source);
    // name updated, type preserved
    expect(result.business).toEqual({ name: "Acme Electric", type: "electric" });
  });

  it("does not mutate either input", () => {
    const target = { business: { name: "Old" }, version: "1.0.0" };
    const source = { business: { name: "New" } };
    const targetCopy = JSON.parse(JSON.stringify(target));
    const sourceCopy = JSON.parse(JSON.stringify(source));
    deepMergeDraft(target, source);
    expect(target).toEqual(targetCopy);
    expect(source).toEqual(sourceCopy);
  });

  it("replaces arrays (does not merge array items)", () => {
    const target = { services: [{ name: "A" }, { name: "B" }] };
    const source = { services: [{ name: "C" }] };
    const result = deepMergeDraft(target, source);
    expect(result.services).toEqual([{ name: "C" }]);
  });

  it("source null overwrites target object", () => {
    const target = { business: { name: "Acme" } };
    const source = { business: null };
    const result = deepMergeDraft(target, source as Record<string, unknown>);
    expect(result.business).toBeNull();
  });

  it("preserves all target keys not present in source", () => {
    const target = completeDraft();
    const source = { business: { name: "Updated Name" } };
    const result = deepMergeDraft(target, source);
    // All original keys still present
    expect(result.version).toBe("1.0.0");
    expect(result.contact).toEqual({ email: "test@acme.com", phone: "555-1234" });
    expect(result.services).toEqual(target.services);
    expect(result.content).toEqual(target.content);
    expect(result.preferences).toEqual(target.preferences);
  });

  it("handles empty source gracefully (returns target copy)", () => {
    const target = completeDraft();
    const result = deepMergeDraft(target, {});
    expect(result).toEqual(target);
    expect(result).not.toBe(target); // new reference
  });

  it("handles empty target (returns source copy)", () => {
    const source = { version: "1.0.0", business: { name: "New" } };
    const result = deepMergeDraft({}, source);
    expect(result).toEqual(source);
  });

  it("deeply merges three levels", () => {
    const target = { preferences: { colors: { primary: "blue", secondary: "red" } } };
    const source = { preferences: { colors: { primary: "green" } } };
    const result = deepMergeDraft(target, source);
    expect(result.preferences).toEqual({
      colors: { primary: "green", secondary: "red" },
    });
  });
});

// ── deepSetServer ────────────────────────────────────────────────────

describe("deepSetServer", () => {
  it("sets a top-level key", () => {
    const obj = { version: "1.0.0", business: {} };
    const result = deepSetServer(obj, ["version"], "2.0.0");
    expect(result.version).toBe("2.0.0");
    expect(result.business).toEqual({});
  });

  it("sets a nested key without destroying siblings", () => {
    const obj = {
      business: { name: "Acme", type: "electric" },
      version: "1.0.0",
      contact: { email: "a@b.com" },
    };
    const result = deepSetServer(obj, ["business", "name"], "New Name");
    expect(result.business).toEqual({ name: "New Name", type: "electric" });
    // Siblings untouched
    expect(result.version).toBe("1.0.0");
    expect(result.contact).toEqual({ email: "a@b.com" });
  });

  it("creates intermediate objects when path does not exist", () => {
    const obj = { version: "1.0.0" };
    const result = deepSetServer(obj, ["business", "name"], "Acme");
    expect(result.business).toEqual({ name: "Acme" });
  });

  it("does not mutate original object", () => {
    const obj = { business: { name: "Old" } };
    const copy = JSON.parse(JSON.stringify(obj));
    deepSetServer(obj, ["business", "name"], "New");
    expect(obj).toEqual(copy);
  });

  it("replaces arrays at the target path", () => {
    const obj = { services: [{ name: "A" }] };
    const result = deepSetServer(obj, ["services"], [{ name: "B" }, { name: "C" }]);
    expect(result.services).toEqual([{ name: "B" }, { name: "C" }]);
  });
});

// ── validateDraftRequired ────────────────────────────────────────────

describe("validateDraftRequired", () => {
  it("returns null for a complete draft", () => {
    const draft = completeDraft();
    expect(validateDraftRequired(draft)).toBeNull();
  });

  it("reports missing version", () => {
    const draft = { business: {}, contact: {} };
    const err = validateDraftRequired(draft);
    expect(err).toContain("version");
  });

  it("reports missing business", () => {
    const draft = { version: "1.0.0", contact: {} };
    const err = validateDraftRequired(draft);
    expect(err).toContain("business");
  });

  it("reports missing contact", () => {
    const draft = { version: "1.0.0", business: {} };
    const err = validateDraftRequired(draft);
    expect(err).toContain("contact");
  });

  it("reports all missing fields at once", () => {
    const draft = { services: [] };
    const err = validateDraftRequired(draft);
    expect(err).toContain("version");
    expect(err).toContain("business");
    expect(err).toContain("contact");
  });

  it("passes even if values are empty objects (key exists)", () => {
    const draft = { version: "1.0.0", business: {}, contact: {} };
    expect(validateDraftRequired(draft)).toBeNull();
  });

  it("detects the historically-corrupted draft", () => {
    const draft = corruptedDraft();
    const err = validateDraftRequired(draft);
    expect(err).not.toBeNull();
    expect(err).toContain("version");
    expect(err).toContain("business");
    expect(err).toContain("contact");
  });
});

// ── ensureDraftDefaults ──────────────────────────────────────────────

describe("ensureDraftDefaults", () => {
  it("fills in all missing keys from DRAFT_DEFAULTS", () => {
    const result = ensureDraftDefaults({});
    for (const key of Object.keys(DRAFT_DEFAULTS)) {
      expect(result).toHaveProperty(key);
    }
    expect(result.version).toBe("1.0.0");
    expect(result.services).toEqual([]);
  });

  it("returns defaults for null input", () => {
    const result = ensureDraftDefaults(null);
    expect(result).toEqual(DRAFT_DEFAULTS);
  });

  it("preserves existing values over defaults", () => {
    const existing = { version: "2.0.0", business: { name: "Acme" } };
    const result = ensureDraftDefaults(existing);
    expect(result.version).toBe("2.0.0");
    expect(result.business).toEqual({ name: "Acme" });
    // Defaults fill in missing keys
    expect(result.contact).toEqual({});
    expect(result.services).toEqual([]);
  });

  it("does not mutate input", () => {
    const input = { version: "2.0.0" };
    const copy = { ...input };
    ensureDraftDefaults(input);
    expect(input).toEqual(copy);
  });
});

// ── Integration: patchDraftFieldAction simulation ────────────────────
// These test the exact sequence that patchDraftFieldAction performs:
// load existing → deepSetServer(path, value) → validateDraftRequired → save

describe("patchDraftField simulation (preserves required keys)", () => {
  it("editing business.name preserves version, contact, services", () => {
    const existing = completeDraft();
    const patched = deepSetServer(existing, ["business", "name"], "New Business Name");
    expect(validateDraftRequired(patched)).toBeNull();
    expect(patched.version).toBe("1.0.0");
    expect(patched.contact).toEqual({ email: "test@acme.com", phone: "555-1234" });
    expect(patched.services).toEqual(existing.services);
    expect((patched.business as Record<string, unknown>).name).toBe("New Business Name");
    expect((patched.business as Record<string, unknown>).type).toBe("electrician");
  });

  it("editing contact.email preserves everything else", () => {
    const existing = completeDraft();
    const patched = deepSetServer(existing, ["contact", "email"], "new@email.com");
    expect(validateDraftRequired(patched)).toBeNull();
    expect((patched.contact as Record<string, unknown>).email).toBe("new@email.com");
    expect((patched.contact as Record<string, unknown>).phone).toBe("555-1234");
  });

  it("replacing services array preserves all other keys", () => {
    const existing = completeDraft();
    const newServices = [{ name: "New Service" }];
    const patched = deepSetServer(existing, ["services"], newServices);
    expect(validateDraftRequired(patched)).toBeNull();
    expect(patched.services).toEqual(newServices);
    expect(patched.business).toEqual(existing.business);
    expect(patched.contact).toEqual(existing.contact);
  });

  it("setting a deep nested value on a sparse draft still validates", () => {
    const sparse = ensureDraftDefaults({ version: "1.0.0" });
    const patched = deepSetServer(sparse, ["business", "name"], "Acme");
    expect(validateDraftRequired(patched)).toBeNull();
  });
});

// ── Integration: updateDraftRequestAction simulation ─────────────────
// These test the exact sequence: load existing → deepMergeDraft(existing, incoming) → validate

describe("updateDraftRequest simulation (deep-merge instead of replace)", () => {
  it("incoming partial business does not destroy existing contact", () => {
    const existing = completeDraft();
    const incoming = { business: { name: "Updated" } };
    const merged = deepMergeDraft(existing, incoming);
    expect(merged.contact).toEqual(existing.contact);
    expect(merged.version).toBe("1.0.0");
    expect(merged.services).toEqual(existing.services);
    expect(validateDraftRequired(merged)).toBeNull();
  });

  it("incoming replaces services array entirely", () => {
    const existing = completeDraft();
    const incoming = { services: [{ name: "Only This" }] };
    const merged = deepMergeDraft(existing, incoming);
    expect(merged.services).toEqual([{ name: "Only This" }]);
    // Other keys preserved
    expect(merged.business).toEqual(existing.business);
  });

  it("incoming empty object does not destroy anything", () => {
    const existing = completeDraft();
    const merged = deepMergeDraft(existing, {});
    expect(merged).toEqual(existing);
    expect(validateDraftRequired(merged)).toBeNull();
  });

  it("incoming with only content does not wipe required fields", () => {
    const existing = completeDraft();
    const incoming = { content: { about: "New about text" } };
    const merged = deepMergeDraft(existing, incoming);
    expect(validateDraftRequired(merged)).toBeNull();
    expect((merged.content as Record<string, unknown>).about).toBe("New about text");
  });
});

// ── Integration: export validation simulation ────────────────────────
// Simulates exportToGeneratorAction's validation checks

describe("exportToGeneratorAction simulation (blocks corrupted drafts)", () => {
  it("blocks export when version is missing", () => {
    const draft = { business: { name: "Acme" }, contact: { email: "a@b.com" }, services: [{ name: "X" }] };
    const err = validateDraftRequired(draft);
    expect(err).toContain("version");
  });

  it("blocks export when business is missing", () => {
    const draft = { version: "1.0.0", contact: { email: "a@b.com" }, services: [{ name: "X" }] };
    const err = validateDraftRequired(draft);
    expect(err).toContain("business");
  });

  it("blocks export when contact is missing", () => {
    const draft = { version: "1.0.0", business: { name: "Acme" }, services: [{ name: "X" }] };
    const err = validateDraftRequired(draft);
    expect(err).toContain("contact");
  });

  it("allows export for a valid complete draft", () => {
    expect(validateDraftRequired(completeDraft())).toBeNull();
  });

  it("catches a historically-corrupted draft (only services + content)", () => {
    const draft = corruptedDraft();
    const err = validateDraftRequired(draft);
    expect(err).not.toBeNull();
    // All three required keys are missing
    for (const key of REQUIRED_DRAFT_KEYS) {
      expect(err).toContain(key);
    }
  });
});

// ── Integration: corrupted project recovery simulation ───────────────
// Simulates reprocessIntakeAction:
//   fresh = processIntake result, existing = corrupted DB draft
//   merged = deepMergeDraft(fresh, existing)  ← existing wins
//   final = ensureDraftDefaults(merged)

describe("corrupted project recovery via re-process", () => {
  it("existing user edits survive re-processing", () => {
    // Fresh intake produces these defaults:
    const fresh: Record<string, unknown> = {
      version: "1.0.0",
      business: { name: "Acme Electric", type: "electrician" },
      contact: {},
      services: [{ name: "Wiring" }, { name: "Panel Upgrades" }],
    };
    // User had edited the business name before corruption:
    const existing: Record<string, unknown> = {
      business: { name: "Acme Electric LLC" },
      services: [{ name: "Custom Wiring" }],
    };
    // Re-process merges: fresh as base, existing overrides
    const merged = deepMergeDraft(fresh, existing);
    const final = ensureDraftDefaults(merged);

    // User's edits win:
    expect((final.business as Record<string, unknown>).name).toBe("Acme Electric LLC");
    expect(final.services).toEqual([{ name: "Custom Wiring" }]);
    // Fresh fills in what was missing:
    expect((final.business as Record<string, unknown>).type).toBe("electrician");
    // Defaults fill in missing top-level keys:
    expect(final.version).toBe("1.0.0");
    expect(final.contact).toEqual({});
    // Validates
    expect(validateDraftRequired(final)).toBeNull();
  });

  it("completely empty existing draft gets fully replaced by fresh", () => {
    const fresh = completeDraft();
    const existing: Record<string, unknown> = {};
    const merged = deepMergeDraft(fresh, existing);
    const final = ensureDraftDefaults(merged);
    expect(final).toEqual(completeDraft());
    expect(validateDraftRequired(final)).toBeNull();
  });

  it("null existing draft gets fully replaced by fresh", () => {
    const fresh = completeDraft();
    // In real code: existing = (p.draft_request as Record<string, unknown>) ?? {}
    const existing: Record<string, unknown> = {};
    const merged = deepMergeDraft(fresh, existing);
    expect(merged).toEqual(fresh);
  });
});
