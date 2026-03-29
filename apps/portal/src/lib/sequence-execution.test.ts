import { describe, expect, it } from "vitest";
import {
  advanceCampaignSequenceStateAfterSend,
  buildCampaignSequenceState,
  buildSequenceTemplateValues,
  getCampaignSequenceProgress,
  getCurrentCampaignStep,
  getSequencePauseReason,
  renderSequenceTemplate,
} from "./sequence-execution";
import type { CampaignSequenceStep } from "./types";

const STEPS: CampaignSequenceStep[] = [
  {
    id: "step-1",
    campaign_id: "camp-1",
    step_number: 1,
    label: "Initial",
    delay_days: 0,
    subject_template: "Hi {{company_name}}",
    body_template: "Hello {{contact_name}} at {{website_url}}",
    created_at: "",
    updated_at: "",
  },
  {
    id: "step-2",
    campaign_id: "camp-1",
    step_number: 2,
    label: "Follow-up",
    delay_days: 3,
    subject_template: "Checking in about {{company_name}}",
    body_template: "{{offer_summary}}\n{{pricing_summary}}",
    created_at: "",
    updated_at: "",
  },
];

describe("sequence execution helpers", () => {
  it("renders step templates from prospect and package values", () => {
    const values = buildSequenceTemplateValues({
      prospect: {
        company_name: "Acme Painting",
        contact_name: "Alex",
        website_url: "https://acme.test",
        outreach_summary: null,
      },
      outreachPackage: {
        offer_summary: "What we noticed: weak CTA",
        package_data: {
          quote: {
            summary: "$1,500 setup / $99 mo",
          },
        },
      } as never,
    });

    expect(renderSequenceTemplate("Hi {{company_name}}", values)).toBe("Hi Acme Painting");
    expect(renderSequenceTemplate("{{contact_name}} {{website_url}}", values)).toBe("Alex https://acme.test");
  });

  it("degrades cleanly when template variables are missing", () => {
    const values = buildSequenceTemplateValues({
      prospect: {
        company_name: "Acme Painting",
        contact_name: null,
        website_url: "https://acme.test",
        outreach_summary: null,
      },
      outreachPackage: null,
    });

    expect(renderSequenceTemplate("Hi {{contact_name}}", values)).toBe("Hi");
    expect(renderSequenceTemplate("{{unknown_value}}", values)).toBe("");
  });

  it("initializes step one as due when no sequence state exists", () => {
    const current = getCurrentCampaignStep({
      sequenceSteps: STEPS,
      sequenceState: null,
      now: new Date("2026-03-29T10:00:00Z"),
    });

    expect(current.step?.step_number).toBe(1);
    expect(current.due).toBe(true);
  });

  it("advances to the next step and computes the due date after a successful send", () => {
    const sentAt = new Date("2026-03-29T10:00:00Z");
    const nextState = advanceCampaignSequenceStateAfterSend({
      sequenceSteps: STEPS,
      existingState: buildCampaignSequenceState({
        sequenceSteps: STEPS,
        existingState: null,
      }),
      sentStepNumber: 1,
      sendId: "send-1",
      sentAt,
    });

    expect(nextState.currentStepNumber).toBe(1);
    expect(nextState.nextStepNumber).toBe(2);
    expect(nextState.sequenceState.current_step).toBe(2);
    expect(nextState.sequenceState.steps[0]).toMatchObject({
      step_number: 1,
      send_id: "send-1",
    });
    expect(nextState.sequenceState.steps[1].due_at).toContain("2026-04-01");
  });

  it("treats replied and do_not_contact prospects as paused", () => {
    expect(getSequencePauseReason({
      outreach_status: "replied",
      metadata: {},
    })).toBe("replied");

    expect(getSequencePauseReason({
      outreach_status: "do_not_contact",
      metadata: {},
    })).toBe("do_not_contact");
  });

  it("computes per-step sent and due counts", () => {
    const progress = getCampaignSequenceProgress({
      sequenceSteps: STEPS,
      now: new Date("2026-03-29T10:00:00Z"),
      prospects: [
        {
          outreach_status: "sent",
          metadata: {
            sequence_state: {
              current_step: 2,
              steps: [
                { step_number: 1, sent_at: "2026-03-28T10:00:00Z", send_id: "send-1", due_at: null, skipped: false },
                { step_number: 2, sent_at: null, send_id: null, due_at: "2026-03-29T09:00:00Z", skipped: false },
              ],
              paused: false,
              paused_reason: null,
            },
          },
        },
        {
          outreach_status: "ready",
          metadata: {},
        },
      ] as never,
    });

    expect(progress[0]).toMatchObject({ step_number: 1, sentCount: 1, dueCount: 1 });
    expect(progress[1]).toMatchObject({ step_number: 2, dueCount: 1 });
  });
});
