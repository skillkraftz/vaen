import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  canRemoveCampaignStep,
  getAvailableStepNumbers,
  getLockedCampaignStepCounts,
  readProspectSequenceState,
  validateCampaignSequenceSteps,
} from "./campaign-sequences";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("campaign sequence schema", () => {
  it("adds campaign_sequence_steps with campaign-owned rls", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000016_create_campaign_sequence_steps.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.campaign_sequence_steps");
    expect(source).toContain("step_number integer not null check (step_number between 1 and 5)");
    expect(source).toContain("delay_days integer not null default 0 check (delay_days >= 0)");
    expect(source).toContain("unique (campaign_id, step_number)");
    expect(source).toContain("create policy steps_access");
    expect(source).toContain("public.campaigns.user_id = auth.uid()");
  });
});

describe("campaign sequence helpers", () => {
  it("allows a 3-step campaign sequence", () => {
    expect(validateCampaignSequenceSteps([
      { step_number: 1, label: "Initial outreach", delay_days: 0, subject_template: "Hi {{company_name}}", body_template: "Body 1" },
      { step_number: 2, label: "Follow-up", delay_days: 3, subject_template: "Checking in", body_template: "Body 2" },
      { step_number: 3, label: "Final note", delay_days: 7, subject_template: "Last note", body_template: "Body 3" },
    ])).toEqual({ valid: true });
  });

  it("enforces unique step numbers and the five-step limit", () => {
    expect(validateCampaignSequenceSteps([
      { step_number: 1, label: "A", delay_days: 0 },
      { step_number: 1, label: "B", delay_days: 3 },
    ])).toEqual({
      valid: false,
      error: "Each sequence step number must be unique.",
    });

    expect(validateCampaignSequenceSteps([
      { step_number: 1, label: "1", delay_days: 0 },
      { step_number: 2, label: "2", delay_days: 1 },
      { step_number: 3, label: "3", delay_days: 2 },
      { step_number: 4, label: "4", delay_days: 3 },
      { step_number: 5, label: "5", delay_days: 4 },
      { step_number: 6, label: "6", delay_days: 5 },
    ])).toEqual({
      valid: false,
      error: "Campaign sequences are limited to 5 steps.",
    });
  });

  it("detects locked steps from prospect sequence metadata", () => {
    const locked = getLockedCampaignStepCounts([
      {
        metadata: {
          sequence_state: {
            current_step: 2,
            steps: [
              { step_number: 1, sent_at: "2026-03-29T10:00:00Z", send_id: "send-1", due_at: null, skipped: false },
              { step_number: 2, sent_at: null, send_id: null, due_at: "2026-04-01T10:00:00Z", skipped: false },
            ],
            paused: false,
            paused_reason: null,
          },
        },
      },
      {
        metadata: {
          sequence_state: {
            current_step: 1,
            steps: [
              { step_number: 1, sent_at: "2026-03-30T10:00:00Z", send_id: "send-2", due_at: null, skipped: false },
            ],
            paused: false,
            paused_reason: null,
          },
        },
      },
    ] as never);

    expect(locked.get(1)).toBe(2);
    expect(canRemoveCampaignStep(1, locked)).toBe(false);
    expect(canRemoveCampaignStep(2, locked)).toBe(true);
  });

  it("reads prospect sequence state and available step slots safely", () => {
    expect(readProspectSequenceState({
      sequence_state: {
        current_step: 1,
        steps: [{ step_number: 1, sent_at: null, send_id: null, due_at: null, skipped: false }],
        paused: true,
        paused_reason: "manual",
      },
    })).toEqual({
      current_step: 1,
      steps: [{ step_number: 1, sent_at: null, send_id: null, due_at: null, skipped: false }],
      paused: true,
      paused_reason: "manual",
    });

    expect(getAvailableStepNumbers([{ step_number: 1 }, { step_number: 3 }])).toEqual([2, 4, 5]);
  });
});

describe("campaign sequence actions and ui", () => {
  it("adds sequence actions to the campaign server surface", () => {
    const actionsPath = join(__dirname, "../app/dashboard/campaigns/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function listCampaignSequenceStepsAction");
    expect(source).toContain("export async function saveCampaignSequenceAction");
    expect(source).toContain("export async function deleteCampaignSequenceStepAction");
    expect(source).toContain("export async function advanceDueFollowUpsAction");
    expect(source).toContain("getSequenceLockCounts");
    expect(source).toContain("locked and cannot be edited");
    expect(source).toContain("locked and cannot be removed");
    expect(source).toContain("executeProspectOutreachSend");
    expect(source).toContain("Step");
    expect(source).toContain("Sequence paused because the prospect is marked replied");
  });

  it("renders a sequence builder on the campaign detail page", () => {
    const pagePath = join(__dirname, "../app/dashboard/campaigns/[id]/page.tsx");
    const uiPath = join(__dirname, "../app/dashboard/campaigns/[id]/campaign-detail-manager.tsx");
    const pageSource = readFileSync(pagePath, "utf-8");
    const uiSource = readFileSync(uiPath, "utf-8");
    expect(pageSource).toContain('from("campaign_sequence_steps")');
    expect(pageSource).toContain("lockedStepCounts");
    expect(uiSource).toContain('data-testid="campaign-sequence-builder"');
    expect(uiSource).toContain('data-testid="campaign-sequence-add-step"');
    expect(uiSource).toContain('data-testid="campaign-sequence-save"');
    expect(uiSource).toContain('data-testid="campaign-sequence-progress"');
    expect(uiSource).toContain('data-testid="campaign-sequence-advance-button"');
    expect(uiSource).toContain("Steps with existing sends are locked");
    expect(uiSource).toContain("{{company_name}}");
    expect(uiSource).toContain("Manual sends do not move prospects through the sequence");
  });
});
