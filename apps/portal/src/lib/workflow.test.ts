/**
 * Workflow integration tests for the portal's project lifecycle.
 *
 * These test the full sequences that the portal performs, using the
 * real pure-logic functions but simulating the DB layer. They prove:
 *
 * - The happy path (intake → edit → export → generate → review) works
 * - Corrupted historical projects can be recovered
 * - Status transitions are correct
 * - Build/review can be retried without recreating the project
 * - Export validation catches corrupted drafts
 *
 * These are NOT shallow unit tests — each test walks through a multi-step
 * workflow sequence and verifies the state at each transition point.
 */
import { describe, it, expect } from "vitest";
import { processIntake, detectMissingInfo } from "./intake-processor";
import {
  deepMergeDraft,
  deepSetServer,
  validateDraftRequired,
  ensureDraftDefaults,
  REQUIRED_DRAFT_KEYS,
} from "./draft-helpers";
import type { Project, Asset, MissingInfoItem, IntakeRecommendations } from "./types";

// ── In-memory project store ──────────────────────────────────────────
// Simulates the Supabase project row to test multi-step workflows

interface ProjectState {
  project: Project;
  assets: Asset[];
  events: Array<{ event_type: string; from_status: string; to_status: string }>;
}

function createProjectState(overrides: Partial<Project> = {}): ProjectState {
  return {
    project: {
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
    },
    assets: [],
    events: [],
  };
}

// Simulate portal server actions using real logic
// Each function mirrors what the server action does, minus the DB calls

function simulateProcessIntake(state: ProjectState): { error?: string } {
  const { project, assets } = state;
  if (project.status !== "intake_received" && project.status !== "intake_needs_revision") {
    return { error: `Cannot process intake in status "${project.status}"` };
  }

  const result = processIntake(project, assets);

  state.events.push({
    event_type: "intake_processed",
    from_status: project.status,
    to_status: "intake_draft_ready",
  });

  state.project = {
    ...project,
    status: "intake_draft_ready",
    client_summary: result.clientSummary,
    draft_request: result.draftRequest,
    missing_info: result.missingInfo,
    recommendations: result.recommendations,
  };

  return {};
}

function simulateApproveIntake(state: ProjectState): { error?: string } {
  const { project } = state;
  if (project.status !== "intake_draft_ready") {
    return { error: `Cannot approve intake in status "${project.status}"` };
  }

  const draft = project.draft_request as Record<string, unknown> | null;
  if (!draft) return { error: "No draft request found" };

  const services = Array.isArray(draft.services) ? draft.services : [];
  if (services.length === 0) return { error: "Cannot approve: services list is empty" };
  if (!project.business_type) return { error: "Cannot approve: business type is missing" };
  if (!project.contact_email && !project.contact_phone) return { error: "Cannot approve: no contact method" };

  state.events.push({
    event_type: "intake_approved",
    from_status: project.status,
    to_status: "intake_approved",
  });

  state.project = { ...project, status: "intake_approved" };
  return {};
}

function simulateExport(state: ProjectState): { error?: string } {
  const { project } = state;
  if (project.status !== "intake_approved") {
    return { error: `Can only export approved intakes. Current status: "${project.status}"` };
  }

  if (!project.draft_request) {
    return { error: "No draft client-request.json found" };
  }

  const draft = project.draft_request as Record<string, unknown>;

  const missingFields = REQUIRED_DRAFT_KEYS.filter((key) => !(key in draft));
  if (missingFields.length > 0) {
    return { error: `Cannot export: draft is missing required fields: ${missingFields.join(", ")}` };
  }

  const services = Array.isArray(draft.services) ? draft.services : [];
  if (services.length === 0) {
    return { error: "Cannot export: services list is empty" };
  }

  state.events.push({
    event_type: "exported_to_generator",
    from_status: project.status,
    to_status: "intake_parsed",
  });

  state.project = { ...project, status: "intake_parsed" };
  return {};
}

function simulatePatchDraftField(
  state: ProjectState,
  path: string[],
  value: unknown,
): { error?: string; merged?: Record<string, unknown> } {
  const existing = ensureDraftDefaults(
    state.project.draft_request as Record<string, unknown> | null,
  );
  const merged = deepSetServer(existing, path, value);
  const validationError = validateDraftRequired(merged);
  if (validationError) return { error: validationError };
  state.project = { ...state.project, draft_request: merged };
  return { merged };
}

function simulateUpdateDraftRequest(
  state: ProjectState,
  incoming: Record<string, unknown>,
): { error?: string } {
  const existing = ensureDraftDefaults(
    state.project.draft_request as Record<string, unknown> | null,
  );
  const merged = deepMergeDraft(existing, incoming);
  const validationError = validateDraftRequired(merged);
  if (validationError) return { error: validationError };
  state.project = { ...state.project, draft_request: merged };
  return {};
}

function simulateGenerateSite(state: ProjectState): { error?: string } {
  const allowedStatuses = [
    "intake_parsed", "awaiting_review", "template_selected",
    "workspace_generated", "build_failed", "review_ready",
  ];
  if (!allowedStatuses.includes(state.project.status)) {
    return { error: `Cannot generate in status "${state.project.status}"` };
  }

  // Simulate successful generation
  state.events.push({
    event_type: "site_generated",
    from_status: state.project.status,
    to_status: "workspace_generated",
  });

  state.project = { ...state.project, status: "workspace_generated" };
  return {};
}

function simulateReview(state: ProjectState): { error?: string } {
  const allowedStatuses = ["workspace_generated", "build_failed", "review_ready"];
  if (!allowedStatuses.includes(state.project.status)) {
    return { error: `Cannot run review in status "${state.project.status}"` };
  }

  state.events.push({
    event_type: "review_completed",
    from_status: state.project.status,
    to_status: "review_ready",
  });

  state.project = { ...state.project, status: "review_ready" };
  return {};
}

function simulateReprocessIntake(state: ProjectState): { error?: string } {
  const { project, assets } = state;
  // Works from ANY status
  const result = processIntake(project, assets);

  const existingDraft = (project.draft_request as Record<string, unknown>) ?? {};
  const merged = deepMergeDraft(result.draftRequest, existingDraft);
  const finalDraft = ensureDraftDefaults(merged);

  state.events.push({
    event_type: "intake_reprocessed",
    from_status: project.status,
    to_status: project.status, // does NOT change status
  });

  state.project = {
    ...project,
    client_summary: result.clientSummary,
    draft_request: finalDraft,
    missing_info: result.missingInfo,
    recommendations: result.recommendations,
    // Invalidate downstream — new revision hasn't been exported/generated/reviewed
    last_exported_revision_id: null,
    last_generated_revision_id: null,
    last_reviewed_revision_id: null,
  };

  return {};
}

function simulateResetToDraft(state: ProjectState): { error?: string } {
  state.events.push({
    event_type: "status_reset",
    from_status: state.project.status,
    to_status: "intake_draft_ready",
  });
  state.project = { ...state.project, status: "intake_draft_ready" };
  return {};
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Happy path: intake → edit → export → generate → review", () => {
  it("walks through the complete workflow without errors", () => {
    // 1. Create project
    const state = createProjectState({
      name: "BrightSpark Electric",
      slug: "brightspark-electric",
      business_type: "Electrician",
      contact_email: "john@brightspark.com",
      contact_phone: "555-0100",
      notes: "We offer panel upgrades, wiring, and lighting installation.",
    });

    // 2. Process intake
    expect(simulateProcessIntake(state)).toEqual({});
    expect(state.project.status).toBe("intake_draft_ready");
    expect(state.project.client_summary).toBeTruthy();
    expect(state.project.draft_request).toBeTruthy();

    const draft = state.project.draft_request as Record<string, unknown>;
    expect(draft.version).toBe("1.0.0");
    expect(draft.business).toBeDefined();
    expect(draft.contact).toBeDefined();
    expect((draft.services as unknown[]).length).toBeGreaterThan(0);

    // 3. Edit draft (patch a field)
    const patchResult = simulatePatchDraftField(state, ["business", "name"], "BrightSpark Electric LLC");
    expect(patchResult.error).toBeUndefined();
    const updatedDraft = state.project.draft_request as Record<string, unknown>;
    expect((updatedDraft.business as Record<string, unknown>).name).toBe("BrightSpark Electric LLC");
    // Other fields preserved
    expect(updatedDraft.version).toBe("1.0.0");
    expect(updatedDraft.contact).toBeDefined();

    // 4. Approve
    expect(simulateApproveIntake(state)).toEqual({});
    expect(state.project.status).toBe("intake_approved");

    // 5. Export
    expect(simulateExport(state)).toEqual({});
    expect(state.project.status).toBe("intake_parsed");

    // 6. Generate
    expect(simulateGenerateSite(state)).toEqual({});
    expect(state.project.status).toBe("workspace_generated");

    // 7. Review
    expect(simulateReview(state)).toEqual({});
    expect(state.project.status).toBe("review_ready");

    // Verify event trail
    const eventTypes = state.events.map((e) => e.event_type);
    expect(eventTypes).toEqual([
      "intake_processed",
      "intake_approved",
      "exported_to_generator",
      "site_generated",
      "review_completed",
    ]);
  });
});

describe("Build/review retry from portal without recreating project", () => {
  function stateAtWorkspaceGenerated(): ProjectState {
    const state = createProjectState({
      name: "Test Co",
      slug: "test-co",
      business_type: "Plumber",
      contact_email: "a@b.com",
      notes: "We offer drain cleaning and pipe repair.",
    });
    simulateProcessIntake(state);
    simulateApproveIntake(state);
    simulateExport(state);
    simulateGenerateSite(state);
    return state;
  }

  it("can regenerate from workspace_generated", () => {
    const state = stateAtWorkspaceGenerated();
    expect(state.project.status).toBe("workspace_generated");
    expect(simulateGenerateSite(state)).toEqual({});
    expect(state.project.status).toBe("workspace_generated");
  });

  it("can review from workspace_generated", () => {
    const state = stateAtWorkspaceGenerated();
    expect(simulateReview(state)).toEqual({});
    expect(state.project.status).toBe("review_ready");
  });

  it("can regenerate from review_ready", () => {
    const state = stateAtWorkspaceGenerated();
    simulateReview(state);
    expect(state.project.status).toBe("review_ready");
    expect(simulateGenerateSite(state)).toEqual({});
    expect(state.project.status).toBe("workspace_generated");
  });

  it("can re-review from review_ready", () => {
    const state = stateAtWorkspaceGenerated();
    simulateReview(state);
    expect(state.project.status).toBe("review_ready");
    expect(simulateReview(state)).toEqual({});
  });

  it("can regenerate from build_failed", () => {
    const state = stateAtWorkspaceGenerated();
    // Simulate build failure
    state.project = { ...state.project, status: "build_failed" };
    expect(simulateGenerateSite(state)).toEqual({});
    expect(state.project.status).toBe("workspace_generated");
  });

  it("can re-review from build_failed", () => {
    const state = stateAtWorkspaceGenerated();
    state.project = { ...state.project, status: "build_failed" };
    expect(simulateReview(state)).toEqual({});
    expect(state.project.status).toBe("review_ready");
  });
});

describe("Export validation blocks corrupted drafts", () => {
  function stateAtApproved(draftOverride: Record<string, unknown> | null): ProjectState {
    const state = createProjectState({
      name: "Test Co",
      slug: "test-co",
      status: "intake_approved",
      business_type: "Plumber",
      contact_email: "a@b.com",
      draft_request: draftOverride,
    });
    return state;
  }

  it("blocks export when draft is null", () => {
    const state = stateAtApproved(null);
    const result = simulateExport(state);
    expect(result.error).toBeTruthy();
    expect(state.project.status).toBe("intake_approved"); // unchanged
  });

  it("blocks export when draft is missing version", () => {
    const state = stateAtApproved({
      business: { name: "Acme" },
      contact: { email: "a@b.com" },
      services: [{ name: "Drain Cleaning" }],
    });
    const result = simulateExport(state);
    expect(result.error).toContain("version");
    expect(state.project.status).toBe("intake_approved");
  });

  it("blocks export when draft is missing business", () => {
    const state = stateAtApproved({
      version: "1.0.0",
      contact: { email: "a@b.com" },
      services: [{ name: "Drain Cleaning" }],
    });
    const result = simulateExport(state);
    expect(result.error).toContain("business");
  });

  it("blocks export when draft has no services", () => {
    const state = stateAtApproved({
      version: "1.0.0",
      business: { name: "Acme" },
      contact: { email: "a@b.com" },
      services: [],
    });
    const result = simulateExport(state);
    expect(result.error).toContain("services");
  });

  it("allows export for a valid draft", () => {
    const state = stateAtApproved({
      version: "1.0.0",
      business: { name: "Acme" },
      contact: { email: "a@b.com" },
      services: [{ name: "Drain Cleaning" }],
    });
    expect(simulateExport(state)).toEqual({});
    expect(state.project.status).toBe("intake_parsed");
  });
});

describe("Corrupted historical project recovery", () => {
  it("recovers a project with missing draft fields via re-process", () => {
    // Historical project: status advanced but draft is corrupted (missing version, business, contact)
    const state = createProjectState({
      name: "Old Project",
      slug: "old-project",
      status: "intake_draft_ready",
      business_type: "Electrician",
      contact_email: "old@test.com",
      notes: "We offer wiring and panel upgrades.",
      draft_request: {
        // Corrupted: missing version, business, contact
        services: [{ name: "Custom Wiring" }],
        content: { about: "Old about text" },
      },
    });

    // Export would fail on this corrupted draft
    const exportDraft = state.project.draft_request as Record<string, unknown>;
    expect(validateDraftRequired(exportDraft)).not.toBeNull();

    // Re-process repairs the draft
    expect(simulateReprocessIntake(state)).toEqual({});

    // Status unchanged (re-process does NOT change status)
    expect(state.project.status).toBe("intake_draft_ready");

    // Draft is now valid
    const repairedDraft = state.project.draft_request as Record<string, unknown>;
    expect(validateDraftRequired(repairedDraft)).toBeNull();

    // User's custom services survived the re-process
    expect(repairedDraft.services).toEqual([{ name: "Custom Wiring" }]);

    // Fresh intake filled in missing required fields
    expect(repairedDraft.version).toBe("1.0.0");
    expect(repairedDraft.business).toBeDefined();
    expect(repairedDraft.contact).toBeDefined();

    // User's content survived
    expect((repairedDraft.content as Record<string, unknown>).about).toBe("Old about text");
  });

  it("recovers a project stuck at build_failed via reset + re-process", () => {
    const state = createProjectState({
      name: "Stuck Project",
      slug: "stuck-project",
      status: "build_failed",
      business_type: "Plumber",
      contact_email: "stuck@test.com",
      notes: "We offer drain cleaning and pipe repair.",
      draft_request: {
        version: "1.0.0",
        business: { name: "Stuck Project" },
        contact: { email: "stuck@test.com" },
        services: [{ name: "Drain Cleaning" }],
      },
    });

    // Re-process (does NOT change status)
    expect(simulateReprocessIntake(state)).toEqual({});
    expect(state.project.status).toBe("build_failed");

    // Reset to draft
    expect(simulateResetToDraft(state)).toEqual({});
    expect(state.project.status).toBe("intake_draft_ready");

    // Now the normal flow works again
    expect(simulateApproveIntake(state)).toEqual({});
    expect(simulateExport(state)).toEqual({});
    expect(simulateGenerateSite(state)).toEqual({});
    expect(simulateReview(state)).toEqual({});
    expect(state.project.status).toBe("review_ready");
  });

  it("recovers a project with null draft_request via re-process", () => {
    const state = createProjectState({
      name: "Null Draft Project",
      slug: "null-draft",
      status: "intake_draft_ready",
      business_type: "Painter",
      contact_email: "null@test.com",
      notes: "We specialize in interior painting and exterior painting.",
      draft_request: null,
    });

    // Re-process creates a fresh draft
    expect(simulateReprocessIntake(state)).toEqual({});
    const draft = state.project.draft_request as Record<string, unknown>;
    expect(validateDraftRequired(draft)).toBeNull();
    expect(draft.version).toBe("1.0.0");
    expect(draft.business).toBeDefined();
    expect(draft.services).toBeDefined();
    expect((draft.services as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("Missing info derives from canonical current data", () => {
  it("live missing-info ignores stale cached missing_info field", () => {
    // Project has stale cached missing_info claiming services are missing,
    // but the user has since added services to the draft
    const project: Project = {
      id: "proj-stale",
      user_id: "user-001",
      name: "Updated Project",
      slug: "updated-project",
      status: "intake_draft_ready",
      contact_name: "Jane",
      contact_email: "jane@test.com",
      contact_phone: null,
      business_type: "Electrician",
      notes: "We offer wiring and panel upgrades.",
      metadata: {},
      client_summary: "...",
      draft_request: {
        version: "1.0.0",
        business: { name: "Updated" },
        contact: { email: "jane@test.com" },
        services: [{ name: "Wiring" }, { name: "Panel Upgrades" }],
      },
      final_request: null,
      missing_info: [
        // This is stale — should be ignored
        { field: "services", label: "Services List", severity: "required" as const, hint: "Stale" },
      ],
      recommendations: null,
      current_revision_id: null,
      last_exported_revision_id: null,
      last_generated_revision_id: null,
      last_reviewed_revision_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    // Live detection — uses current project state, ignores p.missing_info
    const live = detectMissingInfo(project, []);

    // Services are present in notes AND draft → no services warning
    expect(live.find((m) => m.field === "services")).toBeUndefined();

    // The stale cached field said services were required — live disagrees
    const stale = project.missing_info!;
    expect(stale.find((m) => m.field === "services")).toBeDefined();
  });

  it("live missing-info catches new problems not in stale cache", () => {
    // Project was processed when it had an email, but email was later removed
    const project: Project = {
      id: "proj-removed",
      user_id: "user-001",
      name: "Removed Email",
      slug: "removed-email",
      status: "intake_draft_ready",
      contact_name: null,
      contact_email: null, // Was removed after processing
      contact_phone: null,
      business_type: "Plumber",
      notes: "We offer drain cleaning.",
      metadata: {},
      client_summary: "...",
      draft_request: { version: "1.0.0", business: {}, contact: {}, services: [{ name: "X" }] },
      final_request: null,
      // Stale cache says everything is fine (was computed when email existed)
      missing_info: [],
      recommendations: null,
      current_revision_id: null,
      last_exported_revision_id: null,
      last_generated_revision_id: null,
      last_reviewed_revision_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    const live = detectMissingInfo(project, []);

    // Live catches the removed contact info
    const contact = live.find((m) => m.field === "contact");
    expect(contact).toBeDefined();
    expect(contact!.severity).toBe("required");

    // Stale cache did NOT catch it
    expect(project.missing_info!.length).toBe(0);
  });
});

describe("Status transition guards", () => {
  it("cannot process intake from intake_draft_ready", () => {
    const state = createProjectState({ status: "intake_draft_ready" });
    expect(simulateProcessIntake(state).error).toContain("intake_draft_ready");
  });

  it("cannot approve from intake_received", () => {
    const state = createProjectState({ status: "intake_received" });
    expect(simulateApproveIntake(state).error).toBeTruthy();
  });

  it("cannot export from intake_draft_ready", () => {
    const state = createProjectState({ status: "intake_draft_ready" });
    expect(simulateExport(state).error).toBeTruthy();
  });

  it("cannot generate from intake_received", () => {
    const state = createProjectState({ status: "intake_received" });
    expect(simulateGenerateSite(state).error).toBeTruthy();
  });

  it("cannot review from intake_parsed", () => {
    const state = createProjectState({ status: "intake_parsed" });
    expect(simulateReview(state).error).toBeTruthy();
  });

  it("re-process works from ANY status", () => {
    const statuses = [
      "intake_received", "intake_draft_ready", "intake_approved",
      "intake_parsed", "workspace_generated", "build_failed",
      "review_ready", "deploy_ready",
    ];

    for (const status of statuses) {
      const state = createProjectState({
        status,
        business_type: "Plumber",
        contact_email: "a@b.com",
        notes: "We offer drain cleaning.",
      });
      const result = simulateReprocessIntake(state);
      expect(result.error).toBeUndefined();
      // Status should NOT change
      expect(state.project.status).toBe(status);
    }
  });

  it("re-process invalidates downstream revision pointers", () => {
    const state = createProjectState({
      status: "review_ready",
      business_type: "Plumber",
      contact_email: "a@b.com",
      notes: "We offer drain cleaning.",
      current_revision_id: "rev-1",
      last_exported_revision_id: "rev-1",
      last_generated_revision_id: "rev-1",
      last_reviewed_revision_id: "rev-1",
    });

    simulateReprocessIntake(state);

    // Downstream pointers must be cleared — old artifacts are stale
    expect(state.project.last_exported_revision_id).toBeNull();
    expect(state.project.last_generated_revision_id).toBeNull();
    expect(state.project.last_reviewed_revision_id).toBeNull();

    // Status is unchanged
    expect(state.project.status).toBe("review_ready");
  });
});

describe("Draft edit sequences preserve data integrity", () => {
  it("rapid sequential field patches don't destroy each other", () => {
    const state = createProjectState({
      business_type: "Electrician",
      contact_email: "a@b.com",
      notes: "We offer wiring.",
    });
    simulateProcessIntake(state);

    // Simulate rapid edits to different fields
    simulatePatchDraftField(state, ["business", "name"], "New Name");
    simulatePatchDraftField(state, ["contact", "phone"], "555-9999");
    simulatePatchDraftField(state, ["services"], [{ name: "X" }, { name: "Y" }]);
    simulatePatchDraftField(state, ["business", "description"], "A great business");

    const draft = state.project.draft_request as Record<string, unknown>;
    const biz = draft.business as Record<string, unknown>;
    const contact = draft.contact as Record<string, unknown>;

    // All edits survived
    expect(biz.name).toBe("New Name");
    expect(biz.description).toBe("A great business");
    expect(contact.phone).toBe("555-9999");
    expect(draft.services).toEqual([{ name: "X" }, { name: "Y" }]);

    // Required fields still present
    expect(validateDraftRequired(draft)).toBeNull();
  });

  it("full JSON editor replace preserves existing fields not in incoming", () => {
    const state = createProjectState({
      business_type: "Electrician",
      contact_email: "a@b.com",
      notes: "We offer wiring.",
    });
    simulateProcessIntake(state);

    // User opens JSON editor and submits only business changes
    simulateUpdateDraftRequest(state, {
      business: { name: "Completely New Name", type: "super electrician" },
    });

    const draft = state.project.draft_request as Record<string, unknown>;
    // Business was updated
    expect((draft.business as Record<string, unknown>).name).toBe("Completely New Name");
    // Other fields preserved (version, contact, services, etc.)
    expect(draft.version).toBe("1.0.0");
    expect(draft.contact).toBeDefined();
    expect((draft.services as unknown[]).length).toBeGreaterThan(0);
    expect(validateDraftRequired(draft)).toBeNull();
  });
});
