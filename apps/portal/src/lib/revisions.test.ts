/**
 * Tests for the revision model: creation, staleness detection,
 * active request resolution, and revision role identification.
 *
 * These prove that:
 * - Revisions are created with correct source/data
 * - Staleness is detected by comparing pointer IDs
 * - Active request data is resolved from the current revision
 * - Revision roles (current/exported/generated/reviewed) are identified
 * - Source labels are human-readable
 */
import { describe, it, expect } from "vitest";
import {
  createRevisionData,
  isRevisionStale,
  getActiveRequestData,
  revisionSourceLabel,
  revisionRoles,
  type RevisionSource,
} from "./revision-helpers";
import type { Project, RequestRevision } from "./types";

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

function makeRevision(overrides: Partial<RequestRevision> = {}): RequestRevision {
  return {
    id: "rev-001",
    project_id: "proj-001",
    source: "intake_processor",
    request_data: {
      version: "1.0.0",
      business: { name: "Test Business", type: "electrician" },
      contact: { email: "test@test.com" },
      services: [{ name: "Wiring" }],
    },
    parent_revision_id: null,
    summary: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── createRevisionData ───────────────────────────────────────────────

describe("createRevisionData", () => {
  it("creates revision data with required fields", () => {
    const data = { version: "1.0.0", business: { name: "Acme" } };
    const rev = createRevisionData("intake_processor", data);
    expect(rev.source).toBe("intake_processor");
    expect(rev.request_data).toEqual(data);
    expect(rev.parent_revision_id).toBeNull();
    expect(rev.summary).toBeNull();
  });

  it("includes parent revision ID when provided", () => {
    const data = { version: "1.0.0" };
    const rev = createRevisionData("user_edit", data, "rev-parent");
    expect(rev.parent_revision_id).toBe("rev-parent");
  });

  it("includes summary when provided", () => {
    const data = { version: "1.0.0" };
    const rev = createRevisionData("ai_import", data, null, "Imported from Codex");
    expect(rev.summary).toBe("Imported from Codex");
  });

  it("handles all source types", () => {
    const sources: RevisionSource[] = ["intake_processor", "user_edit", "ai_import", "manual"];
    for (const source of sources) {
      const rev = createRevisionData(source, { version: "1.0.0" });
      expect(rev.source).toBe(source);
    }
  });
});

// ── isRevisionStale ──────────────────────────────────────────────────

describe("isRevisionStale", () => {
  it("returns all false when no current revision is set", () => {
    const p = baseProject();
    const result = isRevisionStale(p);
    expect(result.exportStale).toBe(false);
    expect(result.generateStale).toBe(false);
    expect(result.reviewStale).toBe(false);
  });

  it("returns all stale when current is set but no pointers exist", () => {
    const p = baseProject({ current_revision_id: "rev-001" });
    const result = isRevisionStale(p);
    expect(result.exportStale).toBe(true);
    expect(result.generateStale).toBe(true);
    expect(result.reviewStale).toBe(true);
  });

  it("returns all false when all pointers match current", () => {
    const p = baseProject({
      current_revision_id: "rev-001",
      last_exported_revision_id: "rev-001",
      last_generated_revision_id: "rev-001",
      last_reviewed_revision_id: "rev-001",
    });
    const result = isRevisionStale(p);
    expect(result.exportStale).toBe(false);
    expect(result.generateStale).toBe(false);
    expect(result.reviewStale).toBe(false);
  });

  it("detects export stale when exported differs from current", () => {
    const p = baseProject({
      current_revision_id: "rev-002",
      last_exported_revision_id: "rev-001",
      last_generated_revision_id: "rev-002",
      last_reviewed_revision_id: "rev-002",
    });
    const result = isRevisionStale(p);
    expect(result.exportStale).toBe(true);
    expect(result.generateStale).toBe(false);
    expect(result.reviewStale).toBe(false);
  });

  it("detects generate stale when generated differs from current", () => {
    const p = baseProject({
      current_revision_id: "rev-003",
      last_exported_revision_id: "rev-003",
      last_generated_revision_id: "rev-001",
      last_reviewed_revision_id: "rev-003",
    });
    const result = isRevisionStale(p);
    expect(result.exportStale).toBe(false);
    expect(result.generateStale).toBe(true);
    expect(result.reviewStale).toBe(false);
  });

  it("detects review stale when reviewed differs from current", () => {
    const p = baseProject({
      current_revision_id: "rev-002",
      last_exported_revision_id: "rev-002",
      last_generated_revision_id: "rev-002",
      last_reviewed_revision_id: "rev-001",
    });
    const result = isRevisionStale(p);
    expect(result.exportStale).toBe(false);
    expect(result.generateStale).toBe(false);
    expect(result.reviewStale).toBe(true);
  });

  it("detects all stale after editing to a new revision", () => {
    // Simulates: user was at rev-001 fully deployed, then edited to rev-002
    const p = baseProject({
      current_revision_id: "rev-002",
      last_exported_revision_id: "rev-001",
      last_generated_revision_id: "rev-001",
      last_reviewed_revision_id: "rev-001",
    });
    const result = isRevisionStale(p);
    expect(result.exportStale).toBe(true);
    expect(result.generateStale).toBe(true);
    expect(result.reviewStale).toBe(true);
  });
});

// ── getActiveRequestData ─────────────────────────────────────────────

describe("getActiveRequestData", () => {
  it("returns null when no current revision is set", () => {
    const p = baseProject();
    const result = getActiveRequestData(p, [makeRevision()]);
    expect(result).toBeNull();
  });

  it("returns null when current revision is not in the list", () => {
    const p = baseProject({ current_revision_id: "rev-999" });
    const result = getActiveRequestData(p, [makeRevision({ id: "rev-001" })]);
    expect(result).toBeNull();
  });

  it("returns request_data from the current revision", () => {
    const rev = makeRevision({
      id: "rev-001",
      request_data: { version: "1.0.0", business: { name: "Acme" } },
    });
    const p = baseProject({ current_revision_id: "rev-001" });
    const result = getActiveRequestData(p, [rev]);
    expect(result).toEqual({ version: "1.0.0", business: { name: "Acme" } });
  });

  it("selects the correct revision from multiple", () => {
    const rev1 = makeRevision({ id: "rev-001", request_data: { version: "1.0.0" } });
    const rev2 = makeRevision({ id: "rev-002", request_data: { version: "2.0.0" } });
    const rev3 = makeRevision({ id: "rev-003", request_data: { version: "3.0.0" } });

    const p = baseProject({ current_revision_id: "rev-002" });
    const result = getActiveRequestData(p, [rev1, rev2, rev3]);
    expect(result).toEqual({ version: "2.0.0" });
  });
});

// ── revisionSourceLabel ──────────────────────────────────────────────

describe("revisionSourceLabel", () => {
  it("returns human-readable label for intake_processor", () => {
    expect(revisionSourceLabel("intake_processor")).toBe("Auto-processed from intake");
  });

  it("returns human-readable label for user_edit", () => {
    expect(revisionSourceLabel("user_edit")).toBe("Manual edit");
  });

  it("returns human-readable label for ai_import", () => {
    expect(revisionSourceLabel("ai_import")).toBe("AI-improved import");
  });

  it("returns human-readable label for manual", () => {
    expect(revisionSourceLabel("manual")).toBe("Manual entry");
  });
});

// ── revisionRoles ────────────────────────────────────────────────────

describe("revisionRoles", () => {
  it("returns empty array when revision matches no pointers", () => {
    const p = baseProject({
      current_revision_id: "rev-001",
      last_exported_revision_id: "rev-001",
    });
    expect(revisionRoles(p, "rev-999")).toEqual([]);
  });

  it("returns 'current' when revision is the active one", () => {
    const p = baseProject({ current_revision_id: "rev-001" });
    expect(revisionRoles(p, "rev-001")).toContain("current");
  });

  it("returns 'exported' when revision was last exported", () => {
    const p = baseProject({ last_exported_revision_id: "rev-001" });
    expect(revisionRoles(p, "rev-001")).toContain("exported");
  });

  it("returns 'generated' when revision was last generated", () => {
    const p = baseProject({ last_generated_revision_id: "rev-001" });
    expect(revisionRoles(p, "rev-001")).toContain("generated");
  });

  it("returns 'reviewed' when revision was last reviewed", () => {
    const p = baseProject({ last_reviewed_revision_id: "rev-001" });
    expect(revisionRoles(p, "rev-001")).toContain("reviewed");
  });

  it("returns multiple roles when revision serves multiple purposes", () => {
    const p = baseProject({
      current_revision_id: "rev-001",
      last_exported_revision_id: "rev-001",
      last_generated_revision_id: "rev-001",
      last_reviewed_revision_id: "rev-001",
    });
    const roles = revisionRoles(p, "rev-001");
    expect(roles).toEqual(["current", "exported", "generated", "reviewed"]);
  });

  it("distinguishes roles across different revisions", () => {
    const p = baseProject({
      current_revision_id: "rev-003",
      last_exported_revision_id: "rev-002",
      last_generated_revision_id: "rev-001",
      last_reviewed_revision_id: "rev-001",
    });
    expect(revisionRoles(p, "rev-003")).toEqual(["current"]);
    expect(revisionRoles(p, "rev-002")).toEqual(["exported"]);
    expect(revisionRoles(p, "rev-001")).toEqual(["generated", "reviewed"]);
  });
});

// ── Data migration simulation ────────────────────────────────────────
// Simulates migrating draft_request/final_request into revisions

describe("data migration: draft_request/final_request -> revisions", () => {
  it("project with only draft_request gets one revision", () => {
    const p = baseProject({
      draft_request: {
        version: "1.0.0",
        business: { name: "Acme" },
        contact: { email: "a@b.com" },
      },
    });

    // Simulate migration: create revision from draft_request
    const revisions: RequestRevision[] = [];
    if (p.draft_request) {
      revisions.push(makeRevision({
        id: "rev-migrated-draft",
        source: "intake_processor",
        request_data: p.draft_request,
        summary: "Migrated from draft_request column",
      }));
    }

    expect(revisions).toHaveLength(1);
    expect(revisions[0].source).toBe("intake_processor");
    expect(revisions[0].request_data).toEqual(p.draft_request);
  });

  it("project with both draft and final gets two revisions", () => {
    const p = baseProject({
      draft_request: {
        version: "1.0.0",
        business: { name: "Acme" },
      },
      final_request: {
        version: "1.0.0",
        business: { name: "Acme Electric LLC" },
      },
    });

    const revisions: RequestRevision[] = [];
    if (p.draft_request) {
      revisions.push(makeRevision({
        id: "rev-migrated-draft",
        source: "intake_processor",
        request_data: p.draft_request,
      }));
    }
    if (p.final_request) {
      revisions.push(makeRevision({
        id: "rev-migrated-final",
        source: "ai_import",
        request_data: p.final_request,
        parent_revision_id: "rev-migrated-draft",
      }));
    }

    expect(revisions).toHaveLength(2);
    expect(revisions[0].source).toBe("intake_processor");
    expect(revisions[1].source).toBe("ai_import");
    expect(revisions[1].parent_revision_id).toBe("rev-migrated-draft");
  });

  it("migrated project has current_revision_id pointing to most recent", () => {
    const revisions = [
      makeRevision({ id: "rev-1", created_at: "2026-01-01T00:00:00Z" }),
      makeRevision({ id: "rev-2", created_at: "2026-01-02T00:00:00Z" }),
    ];

    // Migration sets current_revision_id to most recent
    const mostRecent = revisions.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];

    const p = baseProject({ current_revision_id: mostRecent.id });
    expect(p.current_revision_id).toBe("rev-2");
  });

  it("project with no draft_request gets no revisions", () => {
    const p = baseProject();
    const revisions: RequestRevision[] = [];
    if (p.draft_request) {
      revisions.push(makeRevision({ source: "intake_processor", request_data: p.draft_request }));
    }
    expect(revisions).toHaveLength(0);
  });
});

// ── Full revision lifecycle simulation ───────────────────────────────

describe("revision lifecycle: intake -> edit -> export -> generate -> review", () => {
  it("full happy path creates correct revisions and staleness", () => {
    // Step 1: Intake processing creates first revision
    const rev1 = makeRevision({
      id: "rev-001",
      source: "intake_processor",
      request_data: {
        version: "1.0.0",
        business: { name: "Acme", type: "electrician" },
        contact: { email: "a@b.com" },
        services: [{ name: "Wiring" }],
      },
      summary: "Initial intake processing",
    });

    let p = baseProject({
      current_revision_id: "rev-001",
      status: "intake_draft_ready",
    });

    // All downstream is stale (nothing exported/generated/reviewed yet)
    let stale = isRevisionStale(p);
    expect(stale.exportStale).toBe(true);
    expect(stale.generateStale).toBe(true);
    expect(stale.reviewStale).toBe(true);

    // Step 2: User edits create second revision
    const rev2 = makeRevision({
      id: "rev-002",
      source: "user_edit",
      request_data: {
        ...rev1.request_data,
        business: { name: "Acme Electric LLC", type: "electrician" },
      },
      parent_revision_id: "rev-001",
      summary: "Updated business name",
    });

    p = { ...p, current_revision_id: "rev-002" };

    // Step 3: Export marks exported pointer
    p = { ...p, last_exported_revision_id: "rev-002", status: "intake_approved" };
    stale = isRevisionStale(p);
    expect(stale.exportStale).toBe(false);
    expect(stale.generateStale).toBe(true); // still not generated

    // Step 4: AI import creates third revision
    const rev3 = makeRevision({
      id: "rev-003",
      source: "ai_import",
      request_data: {
        ...rev2.request_data,
        content: { hero: "Expert electrical services" },
      },
      parent_revision_id: "rev-002",
      summary: "AI-improved from Codex",
    });

    p = { ...p, current_revision_id: "rev-003" };

    // Export is now stale again (current changed but exported didn't)
    stale = isRevisionStale(p);
    expect(stale.exportStale).toBe(true);

    // Step 5: Generate marks generated pointer
    p = { ...p, last_generated_revision_id: "rev-003" };
    stale = isRevisionStale(p);
    expect(stale.generateStale).toBe(false);
    expect(stale.reviewStale).toBe(true);

    // Step 6: Review marks reviewed pointer
    p = { ...p, last_reviewed_revision_id: "rev-003" };
    stale = isRevisionStale(p);
    expect(stale.exportStale).toBe(true); // still stale from step 4
    expect(stale.generateStale).toBe(false);
    expect(stale.reviewStale).toBe(false);

    // Verify active request data resolves correctly
    const allRevs = [rev1, rev2, rev3];
    const activeData = getActiveRequestData(p, allRevs);
    expect(activeData).toEqual(rev3.request_data);
    expect((activeData!.business as Record<string, unknown>).name).toBe("Acme Electric LLC");
    expect((activeData!.content as Record<string, unknown>).hero).toBe("Expert electrical services");
  });
});
