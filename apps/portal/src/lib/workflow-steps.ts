/**
 * 10-step workflow model for the portal UX.
 *
 * Maps internal status strings to plain-language steps that a non-technical
 * operator can understand. The internal state machine (packages/shared/src/state.ts)
 * stays as-is — this is a UX-layer mapping only.
 */

// ── Step definitions ─────────────────────────────────────────────────

export interface WorkflowStep {
  /** Step number (1-10) */
  step: number;
  /** Plain-language label */
  label: string;
  /** Short description for the operator */
  description: string;
  /** Internal status values that map to this step */
  statuses: string[];
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: 1,
    label: "New Project",
    description: "Client information entered",
    statuses: ["intake_received"],
  },
  {
    step: 2,
    label: "Processing",
    description: "Generating a website plan from the project info",
    statuses: ["intake_processing"],
  },
  {
    step: 3,
    label: "Review Plan",
    description: "Review and edit the website plan",
    statuses: ["intake_draft_ready", "intake_needs_revision", "custom_quote_required"],
  },
  {
    step: 4,
    label: "Approve Plan",
    description: "Plan approved, ready to prepare content",
    statuses: ["intake_approved"],
  },
  {
    step: 5,
    label: "Prepare Content",
    description: "Finalize content for website build",
    statuses: ["intake_parsed"],
  },
  {
    step: 6,
    label: "Select Version",
    description: "Choose which version to build",
    statuses: ["awaiting_review", "template_selected"],
  },
  {
    step: 7,
    label: "Build Website",
    description: "Website built from approved content",
    statuses: ["workspace_generated"],
  },
  {
    step: 8,
    label: "Building",
    description: "Website is being compiled",
    statuses: ["build_in_progress", "build_failed"],
  },
  {
    step: 9,
    label: "Preview Ready",
    description: "Preview screenshots are ready for review",
    statuses: ["review_ready"],
  },
  {
    step: 10,
    label: "Ready to Launch",
    description: "Website is approved and ready to go live",
    statuses: ["deploy_ready", "deploying", "deploy_failed", "deployed", "managed"],
  },
];

// ── Lookup functions ─────────────────────────────────────────────────

/** Build a status → step lookup map (cached on first call) */
let _statusMap: Map<string, number> | null = null;

function getStatusMap(): Map<string, number> {
  if (!_statusMap) {
    _statusMap = new Map();
    for (const ws of WORKFLOW_STEPS) {
      for (const s of ws.statuses) {
        _statusMap.set(s, ws.step);
      }
    }
  }
  return _statusMap;
}

/**
 * Get the workflow step number (1-10) for an internal status string.
 * Returns null if the status is not recognized.
 */
export function getWorkflowStep(status: string): number | null {
  return getStatusMap().get(status) ?? null;
}

/**
 * Get the plain-language label for a step number (1-10).
 * Returns null if the step number is out of range.
 */
export function getStepLabel(step: number): string | null {
  const ws = WORKFLOW_STEPS.find((s) => s.step === step);
  return ws?.label ?? null;
}

/**
 * Get the full step definition for a step number.
 */
export function getStepDefinition(step: number): WorkflowStep | null {
  return WORKFLOW_STEPS.find((s) => s.step === step) ?? null;
}

/**
 * Format a status for display: "Step N: Label"
 */
export function formatStatusLabel(status: string): string {
  const step = getWorkflowStep(status);
  if (step == null) return status.replace(/_/g, " ");
  const label = getStepLabel(step);
  return `Step ${step}: ${label}`;
}

/**
 * Check if all statuses in the system are covered by the workflow steps.
 * Useful as a test assertion to catch new statuses that haven't been mapped.
 */
export function getUnmappedStatuses(allStatuses: string[]): string[] {
  const map = getStatusMap();
  return allStatuses.filter((s) => !map.has(s));
}
