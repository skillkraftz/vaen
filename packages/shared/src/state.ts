/**
 * Client/target lifecycle states.
 *
 * A target moves through these states as it progresses from initial intake
 * to a deployed, managed website. Each state has clear entry criteria and
 * expected next transitions.
 */

// ── State definitions ────────────────────────────────────────────────

export type TargetState =
  | "intake_received"
  | "intake_processing"
  | "intake_draft_ready"
  | "intake_needs_revision"
  | "intake_approved"
  | "custom_quote_required"
  | "intake_parsed"
  | "awaiting_review"
  | "template_selected"
  | "workspace_generated"
  | "build_in_progress"
  | "build_failed"
  | "review_ready"
  | "deploy_ready"
  | "deploying"
  | "deploy_failed"
  | "deployed"
  | "managed";

/** Human-readable labels for display. */
export const STATE_LABELS: Record<TargetState, string> = {
  intake_received: "Intake received",
  intake_processing: "Processing intake",
  intake_draft_ready: "Draft ready for review",
  intake_needs_revision: "Needs revision",
  intake_approved: "Intake approved",
  custom_quote_required: "Custom quote required",
  intake_parsed: "Intake parsed",
  awaiting_review: "Awaiting review",
  template_selected: "Template selected",
  workspace_generated: "Workspace generated",
  build_in_progress: "Build in progress",
  build_failed: "Build failed",
  review_ready: "Ready for review",
  deploy_ready: "Ready to deploy",
  deploying: "Deploying",
  deploy_failed: "Deploy failed",
  deployed: "Deployed",
  managed: "Managed",
};

/** Which states a target can transition to from each state. */
export const STATE_TRANSITIONS: Record<TargetState, TargetState[]> = {
  intake_received: ["intake_processing"],
  intake_processing: ["intake_draft_ready"],
  intake_draft_ready: ["intake_approved", "intake_needs_revision", "custom_quote_required"],
  intake_needs_revision: ["intake_processing"], // re-process after edits
  intake_approved: ["intake_parsed"],
  custom_quote_required: ["intake_approved", "intake_needs_revision"], // resolved → approved or back to revision
  intake_parsed: ["awaiting_review"],
  awaiting_review: ["template_selected"],
  template_selected: ["workspace_generated"],
  workspace_generated: ["build_in_progress"],
  build_in_progress: ["review_ready", "build_failed"],
  build_failed: ["build_in_progress"], // retry
  review_ready: ["deploy_ready", "workspace_generated"], // reject → regenerate
  deploy_ready: ["deploying"],
  deploying: ["deployed", "deploy_failed"],
  deploy_failed: ["deploying"], // retry
  deployed: ["managed"],
  managed: [], // terminal
};

/**
 * Validate that a state transition is allowed.
 */
export function canTransition(from: TargetState, to: TargetState): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

// ── Target status record ─────────────────────────────────────────────

export interface TargetStatus {
  /** Target slug */
  slug: string;
  /** Current lifecycle state */
  state: TargetState;
  /** Template ID once selected */
  templateId?: string;
  /** Module IDs once selected */
  moduleIds?: string[];
  /** ISO timestamp of last state change */
  updatedAt: string;
  /** State history for audit trail */
  history: StateTransition[];
}

export interface StateTransition {
  from: TargetState;
  to: TargetState;
  at: string; // ISO timestamp
  reason?: string;
}

/**
 * Create an initial target status for a newly received intake.
 */
export function createTargetStatus(slug: string): TargetStatus {
  const now = new Date().toISOString();
  return {
    slug,
    state: "intake_received",
    updatedAt: now,
    history: [],
  };
}

/**
 * Advance a target to a new state, recording the transition.
 * Throws if the transition is not allowed.
 */
export function advanceState(
  status: TargetStatus,
  to: TargetState,
  reason?: string,
): TargetStatus {
  if (!canTransition(status.state, to)) {
    throw new Error(
      `Invalid state transition: ${status.state} → ${to}. ` +
      `Allowed: ${STATE_TRANSITIONS[status.state].join(", ") || "(none)"}`,
    );
  }

  const now = new Date().toISOString();
  return {
    ...status,
    state: to,
    updatedAt: now,
    history: [
      ...status.history,
      { from: status.state, to, at: now, reason },
    ],
  };
}
