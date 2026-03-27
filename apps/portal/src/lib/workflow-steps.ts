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
    label: "Intake",
    description: "Raw client data entered into the system",
    statuses: ["intake_received"],
  },
  {
    step: 2,
    label: "Processing",
    description: "Generating a draft from the intake data",
    statuses: ["intake_processing"],
  },
  {
    step: 3,
    label: "Review Draft",
    description: "Review and edit the generated draft before export",
    statuses: ["intake_draft_ready", "intake_needs_revision", "custom_quote_required"],
  },
  {
    step: 4,
    label: "Export Prompt",
    description: "Generate prompt.txt for AI handoff",
    statuses: ["intake_approved"],
  },
  {
    step: 5,
    label: "Import Final",
    description: "Paste AI-improved JSON back into the system",
    statuses: ["intake_parsed"],
  },
  {
    step: 6,
    label: "Select Active",
    description: "Choose which revision to use for generation",
    statuses: ["awaiting_review", "template_selected"],
  },
  {
    step: 7,
    label: "Generate",
    description: "Build the site from the active revision",
    statuses: ["workspace_generated"],
  },
  {
    step: 8,
    label: "Build",
    description: "Compile the site and install dependencies",
    statuses: ["build_in_progress", "build_failed"],
  },
  {
    step: 9,
    label: "Review Screenshots",
    description: "View screenshots, approve or regenerate",
    statuses: ["review_ready"],
  },
  {
    step: 10,
    label: "Ready for Deploy",
    description: "Site is approved and ready to go live",
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
