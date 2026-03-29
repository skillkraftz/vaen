import type { CampaignSequenceStep, Prospect, ProspectSequenceState } from "./types";

export interface CampaignSequenceStepInput {
  id?: string;
  step_number: number;
  label: string;
  delay_days: number;
  subject_template?: string | null;
  body_template?: string | null;
}

export function normalizeCampaignSequenceStepInput(
  step: CampaignSequenceStepInput,
): CampaignSequenceStepInput {
  return {
    id: step.id,
    step_number: Math.trunc(step.step_number),
    label: step.label.trim(),
    delay_days: Math.max(0, Math.trunc(step.delay_days)),
    subject_template: step.subject_template?.trim() ? step.subject_template.trim() : null,
    body_template: step.body_template?.trim() ? step.body_template.trim() : null,
  };
}

export function validateCampaignSequenceSteps(
  steps: CampaignSequenceStepInput[],
): { valid: boolean; error?: string } {
  if (steps.length > 5) {
    return { valid: false, error: "Campaign sequences are limited to 5 steps." };
  }

  const seen = new Set<number>();
  for (const rawStep of steps) {
    const step = normalizeCampaignSequenceStepInput(rawStep);
    if (step.step_number < 1 || step.step_number > 5) {
      return { valid: false, error: "Step number must be between 1 and 5." };
    }
    if (seen.has(step.step_number)) {
      return { valid: false, error: "Each sequence step number must be unique." };
    }
    if (!step.label) {
      return { valid: false, error: "Each sequence step requires a label." };
    }
    if (step.delay_days < 0) {
      return { valid: false, error: "Step delay must be a non-negative number of days." };
    }
    seen.add(step.step_number);
  }

  return { valid: true };
}

export function readProspectSequenceState(
  metadata: Record<string, unknown> | null | undefined,
): ProspectSequenceState | null {
  const value = metadata?.sequence_state;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.steps)) return null;
  return {
    current_step: typeof record.current_step === "number" ? record.current_step : 0,
    steps: record.steps
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        step_number: typeof item.step_number === "number" ? item.step_number : 0,
        sent_at: typeof item.sent_at === "string" ? item.sent_at : null,
        send_id: typeof item.send_id === "string" ? item.send_id : null,
        due_at: typeof item.due_at === "string" ? item.due_at : null,
        skipped: item.skipped === true,
      })),
    paused: record.paused === true,
    paused_reason:
      record.paused_reason === "replied"
      || record.paused_reason === "manual"
      || record.paused_reason === "do_not_contact"
        ? record.paused_reason
        : null,
  };
}

export function getLockedCampaignStepCounts(
  prospects: Array<Pick<Prospect, "metadata">>,
) {
  const counts = new Map<number, number>();

  for (const prospect of prospects) {
    const sequenceState = readProspectSequenceState(prospect.metadata);
    if (!sequenceState) continue;
    for (const step of sequenceState.steps) {
      if (!step.step_number) continue;
      if (step.sent_at || step.send_id) {
        counts.set(step.step_number, (counts.get(step.step_number) ?? 0) + 1);
      }
    }
  }

  return counts;
}

export function isCampaignStepLocked(
  stepNumber: number,
  lockedCounts: Map<number, number>,
) {
  return (lockedCounts.get(stepNumber) ?? 0) > 0;
}

export function canRemoveCampaignStep(
  stepNumber: number,
  lockedCounts: Map<number, number>,
) {
  return !isCampaignStepLocked(stepNumber, lockedCounts);
}

export function sortCampaignSequenceSteps<T extends Pick<CampaignSequenceStepInput, "step_number">>(steps: T[]) {
  return [...steps].sort((left, right) => left.step_number - right.step_number);
}

export function getAvailableStepNumbers(steps: Array<Pick<CampaignSequenceStep | CampaignSequenceStepInput, "step_number">>) {
  const taken = new Set(steps.map((step) => step.step_number));
  return [1, 2, 3, 4, 5].filter((value) => !taken.has(value));
}
