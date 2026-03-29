import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildProspectReplyUpdate } from "./reply-workflow";
import { getProspectSendReadiness } from "./outreach-execution";
import type { CampaignSequenceStep, Prospect } from "./types";

const REPO_ROOT = resolve(__dirname, "../../../..");

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: "pros-1",
    user_id: "user-1",
    campaign_id: "camp-1",
    company_name: "Acme Painting",
    website_url: "https://acme.test",
    contact_name: "Alex",
    contact_email: "alex@acme.test",
    contact_phone: null,
    notes: null,
    status: "ready_for_outreach",
    source: null,
    campaign: null,
    outreach_summary: "Needs a stronger offer and clearer CTA.",
    outreach_status: "followup_due",
    last_outreach_sent_at: null,
    next_follow_up_due_at: "2026-03-29T10:00:00.000Z",
    follow_up_count: 1,
    metadata: {},
    converted_client_id: "client-1",
    converted_project_id: "proj-1",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStep(stepNumber: number, delayDays = 0): CampaignSequenceStep {
  return {
    id: `step-${stepNumber}`,
    campaign_id: "camp-1",
    step_number: stepNumber,
    label: `Step ${stepNumber}`,
    delay_days: delayDays,
    subject_template: "Subject",
    body_template: "Body",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
}

describe("reply workflow schema", () => {
  it("adds prospect reply events table", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000020_create_prospect_reply_events.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.prospect_reply_events");
    expect(source).toContain("outreach_send_id uuid references public.outreach_sends");
    expect(source).toContain("reply_note text");
    expect(source).toContain("reply_summary text");
  });

  it("adds ProspectReplyEvent type", () => {
    const typesPath = join(__dirname, "types.ts");
    const source = readFileSync(typesPath, "utf-8");
    expect(source).toContain("export interface ProspectReplyEvent");
  });
});

describe("reply workflow helpers", () => {
  it("marks the prospect replied and pauses the active sequence", () => {
    const update = buildProspectReplyUpdate({
      prospect: makeProspect({
        metadata: {
          sequence_state: {
            current_step: 2,
            paused: false,
            paused_reason: null,
            steps: [
              { step_number: 1, sent_at: "2026-03-20T00:00:00.000Z", send_id: "send-1", due_at: null, skipped: false },
              { step_number: 2, sent_at: null, send_id: null, due_at: "2026-03-29T00:00:00.000Z", skipped: false },
            ],
          },
        },
      }),
      sequenceSteps: [makeStep(1), makeStep(2, 7)],
      replySummary: "Asked for a call next week",
      outreachSendId: "send-2",
      now: new Date("2026-03-29T12:00:00.000Z"),
    });

    expect(update.outreach_status).toBe("replied");
    expect(update.next_follow_up_due_at).toBeNull();
    expect(update.metadata).toEqual(
      expect.objectContaining({
        latest_reply_summary: "Asked for a call next week",
        latest_reply_send_id: "send-2",
      }),
    );
    expect(update.metadata.sequence_state).toEqual(
      expect.objectContaining({
        paused: true,
        paused_reason: "replied",
      }),
    );
  });

  it("blocks new outreach sends when a prospect is marked replied", () => {
    const readiness = getProspectSendReadiness({
      prospect: {
        contact_email: "alex@acme.test",
        converted_project_id: "proj-1",
        outreach_status: "replied",
      },
      outreachPackage: {
        id: "pkg-1",
        email_subject: "Subject",
        email_body: "Body",
        status: "ready",
      },
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.issues).toContain("Prospect is marked replied.");
  });
});

describe("reply workflow integration", () => {
  it("records manual replies and updates prospect/send state", () => {
    const actionsPath = join(__dirname, "../app/dashboard/prospects/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function markProspectRepliedAction");
    expect(source).toContain('from("prospect_reply_events")');
    expect(source).toContain("buildProspectReplyUpdate");
    expect(source).toContain("latest_reply_event_id");
    expect(source).toContain('from("outreach_sends")');
    expect(source).toContain("provider_metadata");
    expect(source).toContain("reply_event_id");
  });

  it("surfaces reply controls and history on the prospect detail page", () => {
    const detailPath = join(__dirname, "../app/dashboard/prospects/[id]/page.tsx");
    const actionsUiPath = join(__dirname, "../app/dashboard/prospects/prospect-detail-actions.tsx");
    const detailSource = readFileSync(detailPath, "utf-8");
    const actionsSource = readFileSync(actionsUiPath, "utf-8");
    expect(detailSource).toContain('from("prospect_reply_events")');
    expect(detailSource).toContain('data-testid="prospect-reply-history"');
    expect(detailSource).toContain("Reply History");
    expect(actionsSource).toContain('data-testid="prospect-reply-controls"');
    expect(actionsSource).toContain('data-testid="prospect-reply-summary"');
    expect(actionsSource).toContain('data-testid="prospect-reply-note"');
    expect(actionsSource).toContain('data-testid="prospect-mark-replied-button"');
  });
});
