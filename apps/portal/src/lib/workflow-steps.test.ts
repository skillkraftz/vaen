/**
 * Tests for the 10-step workflow model.
 *
 * Proves that:
 * - Every internal status maps to exactly one step
 * - Step labels are correct and human-readable
 * - formatStatusLabel produces "Step N: Label" format
 * - All known statuses from the state machine are covered
 */
import { describe, it, expect } from "vitest";
import {
  WORKFLOW_STEPS,
  getWorkflowStep,
  getStepLabel,
  getStepDefinition,
  formatStatusLabel,
  getUnmappedStatuses,
} from "./workflow-steps";

// All internal statuses from packages/shared/src/state.ts
const ALL_STATUSES = [
  "intake_received",
  "intake_processing",
  "intake_draft_ready",
  "intake_needs_revision",
  "intake_approved",
  "custom_quote_required",
  "intake_parsed",
  "awaiting_review",
  "template_selected",
  "workspace_generated",
  "build_in_progress",
  "build_failed",
  "review_ready",
  "deploy_ready",
  "deploying",
  "deploy_failed",
  "deployed",
  "managed",
];

// ── WORKFLOW_STEPS structure ─────────────────────────────────────────

describe("WORKFLOW_STEPS", () => {
  it("has exactly 10 steps", () => {
    expect(WORKFLOW_STEPS).toHaveLength(10);
  });

  it("steps are numbered 1 through 10", () => {
    const steps = WORKFLOW_STEPS.map((s) => s.step);
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("every step has a non-empty label", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
    }
  });

  it("every step has a non-empty description", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(step.description.length).toBeGreaterThan(0);
    }
  });

  it("every step has at least one status", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(step.statuses.length).toBeGreaterThan(0);
    }
  });

  it("no status appears in more than one step", () => {
    const seen = new Map<string, number>();
    for (const step of WORKFLOW_STEPS) {
      for (const status of step.statuses) {
        if (seen.has(status)) {
          throw new Error(
            `Status "${status}" appears in step ${seen.get(status)} and step ${step.step}`,
          );
        }
        seen.set(status, step.step);
      }
    }
  });
});

// ── getWorkflowStep ──────────────────────────────────────────────────

describe("getWorkflowStep", () => {
  it("maps intake_received to step 1", () => {
    expect(getWorkflowStep("intake_received")).toBe(1);
  });

  it("maps intake_processing to step 2", () => {
    expect(getWorkflowStep("intake_processing")).toBe(2);
  });

  it("maps intake_draft_ready to step 3", () => {
    expect(getWorkflowStep("intake_draft_ready")).toBe(3);
  });

  it("maps intake_needs_revision to step 3", () => {
    expect(getWorkflowStep("intake_needs_revision")).toBe(3);
  });

  it("maps custom_quote_required to step 3", () => {
    expect(getWorkflowStep("custom_quote_required")).toBe(3);
  });

  it("maps intake_approved to step 4", () => {
    expect(getWorkflowStep("intake_approved")).toBe(4);
  });

  it("maps intake_parsed to step 5", () => {
    expect(getWorkflowStep("intake_parsed")).toBe(5);
  });

  it("maps awaiting_review to step 6", () => {
    expect(getWorkflowStep("awaiting_review")).toBe(6);
  });

  it("maps template_selected to step 6", () => {
    expect(getWorkflowStep("template_selected")).toBe(6);
  });

  it("maps workspace_generated to step 7", () => {
    expect(getWorkflowStep("workspace_generated")).toBe(7);
  });

  it("maps build_in_progress to step 8", () => {
    expect(getWorkflowStep("build_in_progress")).toBe(8);
  });

  it("maps build_failed to step 8", () => {
    expect(getWorkflowStep("build_failed")).toBe(8);
  });

  it("maps review_ready to step 9", () => {
    expect(getWorkflowStep("review_ready")).toBe(9);
  });

  it("maps deploy_ready to step 10", () => {
    expect(getWorkflowStep("deploy_ready")).toBe(10);
  });

  it("maps deployed to step 10", () => {
    expect(getWorkflowStep("deployed")).toBe(10);
  });

  it("maps managed to step 10", () => {
    expect(getWorkflowStep("managed")).toBe(10);
  });

  it("returns null for unknown status", () => {
    expect(getWorkflowStep("nonexistent_status")).toBeNull();
  });
});

// ── getStepLabel ─────────────────────────────────────────────────────

describe("getStepLabel", () => {
  const expectedLabels: Record<number, string> = {
    1: "Intake",
    2: "Processing",
    3: "Review Draft",
    4: "Export Prompt",
    5: "Import Final",
    6: "Select Active",
    7: "Generate",
    8: "Build",
    9: "Review Screenshots",
    10: "Ready for Deploy",
  };

  for (const [step, label] of Object.entries(expectedLabels)) {
    it(`step ${step} has label "${label}"`, () => {
      expect(getStepLabel(Number(step))).toBe(label);
    });
  }

  it("returns null for step 0", () => {
    expect(getStepLabel(0)).toBeNull();
  });

  it("returns null for step 11", () => {
    expect(getStepLabel(11)).toBeNull();
  });
});

// ── getStepDefinition ────────────────────────────────────────────────

describe("getStepDefinition", () => {
  it("returns full definition for valid step", () => {
    const def = getStepDefinition(3);
    expect(def).not.toBeNull();
    expect(def!.step).toBe(3);
    expect(def!.label).toBe("Review Draft");
    expect(def!.statuses).toContain("intake_draft_ready");
  });

  it("returns null for invalid step", () => {
    expect(getStepDefinition(99)).toBeNull();
  });
});

// ── formatStatusLabel ────────────────────────────────────────────────

describe("formatStatusLabel", () => {
  it("formats known status as 'Step N: Label'", () => {
    expect(formatStatusLabel("intake_received")).toBe("Step 1: Intake");
    expect(formatStatusLabel("review_ready")).toBe("Step 9: Review Screenshots");
    expect(formatStatusLabel("deployed")).toBe("Step 10: Ready for Deploy");
  });

  it("formats unknown status by replacing underscores with spaces", () => {
    expect(formatStatusLabel("some_unknown_status")).toBe("some unknown status");
  });
});

// ── Coverage: all known statuses are mapped ──────────────────────────

describe("status coverage", () => {
  it("every status from the state machine maps to a step", () => {
    const unmapped = getUnmappedStatuses(ALL_STATUSES);
    if (unmapped.length > 0) {
      throw new Error(`Unmapped statuses: ${unmapped.join(", ")}`);
    }
  });

  it("getUnmappedStatuses returns empty array for fully covered set", () => {
    expect(getUnmappedStatuses(ALL_STATUSES)).toEqual([]);
  });

  it("getUnmappedStatuses catches new statuses", () => {
    const withNew = [...ALL_STATUSES, "brand_new_status"];
    expect(getUnmappedStatuses(withNew)).toEqual(["brand_new_status"]);
  });
});
