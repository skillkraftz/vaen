import { readProspectSequenceState, sortCampaignSequenceSteps } from "./campaign-sequences";
import type {
  CampaignSequenceStep,
  Prospect,
  ProspectOutreachPackage,
  ProspectSequenceState,
  ProspectSequenceStepState,
} from "./types";

const TEMPLATE_VARIABLE_PATTERN = /{{\s*([a-z0-9_]+)\s*}}/gi;

export interface SequenceTemplateValues {
  company_name: string;
  contact_name: string;
  website_url: string;
  offer_summary: string;
  pricing_summary: string;
}

export interface SequenceAdvanceResult {
  sequenceState: ProspectSequenceState;
  currentStepNumber: number | null;
  nextStepNumber: number | null;
  completed: boolean;
}

function addDays(base: Date, delayDays: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + delayDays);
  return next;
}

function emptyStepState(stepNumber: number): ProspectSequenceStepState {
  return {
    step_number: stepNumber,
    sent_at: null,
    send_id: null,
    due_at: null,
    skipped: false,
  };
}

export function buildSequenceTemplateValues(params: {
  prospect: Pick<Prospect, "company_name" | "contact_name" | "website_url" | "outreach_summary">;
  outreachPackage: Pick<ProspectOutreachPackage, "offer_summary" | "package_data"> | null;
}): SequenceTemplateValues {
  const packageData = (params.outreachPackage?.package_data ?? {}) as Record<string, unknown>;
  const quoteRecord = packageData.quote as Record<string, unknown> | undefined;
  return {
    company_name: params.prospect.company_name?.trim() ?? "",
    contact_name: params.prospect.contact_name?.trim() ?? "",
    website_url: params.prospect.website_url?.trim() ?? "",
    offer_summary: params.outreachPackage?.offer_summary?.trim()
      ?? params.prospect.outreach_summary?.trim()
      ?? "",
    pricing_summary:
      (typeof quoteRecord?.summary === "string" ? quoteRecord.summary.trim() : "")
      || "Pricing estimate pending quote creation.",
  };
}

export function renderSequenceTemplate(
  template: string | null | undefined,
  values: SequenceTemplateValues,
) {
  if (!template?.trim()) return "";
  return template
    .replace(TEMPLATE_VARIABLE_PATTERN, (_match, rawKey: string) => {
      const key = rawKey.toLowerCase() as keyof SequenceTemplateValues;
      return values[key] ?? "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getSequencePauseReason(
  prospect: Pick<Prospect, "outreach_status" | "metadata">,
): ProspectSequenceState["paused_reason"] {
  const existing = readProspectSequenceState(prospect.metadata);
  if (prospect.outreach_status === "replied") return "replied";
  if (prospect.outreach_status === "do_not_contact") return "do_not_contact";
  return existing?.paused ? existing.paused_reason : null;
}

export function buildCampaignSequenceState(params: {
  sequenceSteps: CampaignSequenceStep[];
  existingState?: ProspectSequenceState | null;
  now?: Date;
}) {
  const sortedSteps = sortCampaignSequenceSteps(params.sequenceSteps);
  const existingSteps = new Map(
    (params.existingState?.steps ?? []).map((step) => [step.step_number, step]),
  );
  const firstStep = sortedSteps[0] ?? null;
  const currentStep = typeof params.existingState?.current_step === "number"
    ? params.existingState.current_step
    : (firstStep?.step_number ?? 0);

  return {
    current_step: currentStep,
    steps: sortedSteps.map((step) => existingSteps.get(step.step_number) ?? emptyStepState(step.step_number)),
    paused: params.existingState?.paused ?? false,
    paused_reason: params.existingState?.paused_reason ?? null,
  } satisfies ProspectSequenceState;
}

export function getCurrentCampaignStep(params: {
  sequenceSteps: CampaignSequenceStep[];
  sequenceState?: ProspectSequenceState | null;
  now?: Date;
}) {
  const sortedSteps = sortCampaignSequenceSteps(params.sequenceSteps);
  if (sortedSteps.length === 0) {
    return {
      step: null,
      state: null,
      due: false,
      completed: true,
    };
  }

  const state = buildCampaignSequenceState({
    sequenceSteps: sortedSteps,
    existingState: params.sequenceState ?? null,
    now: params.now,
  });
  if (state.current_step === 0) {
    return {
      step: null,
      state: null,
      due: false,
      completed: true,
    };
  }

  const activeStepNumber = state.current_step;
  const step = sortedSteps.find((item) => item.step_number === activeStepNumber) ?? null;
  if (!step) {
    return {
      step: null,
      state: null,
      due: false,
      completed: true,
    };
  }

  const stepState = state.steps.find((item) => item.step_number === step.step_number) ?? emptyStepState(step.step_number);
  const now = params.now ?? new Date();
  const due = !stepState.sent_at && (!stepState.due_at || new Date(stepState.due_at) <= now);

  return {
    step,
    state: stepState,
    due,
    completed: false,
  };
}

export function advanceCampaignSequenceStateAfterSend(params: {
  sequenceSteps: CampaignSequenceStep[];
  existingState?: ProspectSequenceState | null;
  sentStepNumber: number;
  sendId: string;
  sentAt: Date;
  pausedReason?: ProspectSequenceState["paused_reason"];
}): SequenceAdvanceResult {
  const sortedSteps = sortCampaignSequenceSteps(params.sequenceSteps);
  const nextStep = sortedSteps.find((step) => step.step_number === params.sentStepNumber + 1) ?? null;
  const state = buildCampaignSequenceState({
    sequenceSteps: sortedSteps,
    existingState: params.existingState ?? null,
    now: params.sentAt,
  });

  const nextSteps = state.steps.map((step) => {
    if (step.step_number === params.sentStepNumber) {
      return {
        ...step,
        sent_at: params.sentAt.toISOString(),
        send_id: params.sendId,
        due_at: step.due_at ?? null,
        skipped: false,
      };
    }
    if (nextStep && step.step_number === nextStep.step_number) {
      return {
        ...step,
        due_at: addDays(params.sentAt, nextStep.delay_days).toISOString(),
      };
    }
    return step;
  });

  return {
    sequenceState: {
      current_step: nextStep?.step_number ?? 0,
      steps: nextSteps,
      paused: false,
      paused_reason: params.pausedReason ?? null,
    },
    currentStepNumber: params.sentStepNumber,
    nextStepNumber: nextStep?.step_number ?? null,
    completed: !nextStep,
  };
}

export function buildPausedSequenceState(params: {
  sequenceSteps: CampaignSequenceStep[];
  existingState?: ProspectSequenceState | null;
  pausedReason: ProspectSequenceState["paused_reason"];
}) {
  const state = buildCampaignSequenceState({
    sequenceSteps: params.sequenceSteps,
    existingState: params.existingState ?? null,
  });
  return {
    ...state,
    paused: true,
    paused_reason: params.pausedReason,
  } satisfies ProspectSequenceState;
}

export function getCampaignSequenceProgress(params: {
  sequenceSteps: CampaignSequenceStep[];
  prospects: Array<Pick<Prospect, "metadata" | "outreach_status">>;
  now?: Date;
}) {
  const sortedSteps = sortCampaignSequenceSteps(params.sequenceSteps);
  const now = params.now ?? new Date();

  return sortedSteps.map((step) => {
    let sentCount = 0;
    let dueCount = 0;
    let pausedCount = 0;

    for (const prospect of params.prospects) {
      const sequenceState = readProspectSequenceState(prospect.metadata);
      const current = getCurrentCampaignStep({
        sequenceSteps: sortedSteps,
        sequenceState,
        now,
      });
      const pauseReason = getSequencePauseReason(prospect);

      const sentStep = sequenceState?.steps.find((item) => item.step_number === step.step_number);
      if (sentStep?.sent_at) {
        sentCount += 1;
        continue;
      }

      if (pauseReason && current.step?.step_number === step.step_number) {
        pausedCount += 1;
        continue;
      }

      if (current.step?.step_number === step.step_number && current.due) {
        dueCount += 1;
      }
    }

    return {
      step_number: step.step_number,
      label: step.label,
      sentCount,
      dueCount,
      pausedCount,
    };
  });
}
