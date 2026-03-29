import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeCampaignDetailAnalytics } from "./campaign-detail-analytics";
import type { Campaign, ContinuationRequest, Prospect, ProspectOutreachPackage } from "./types";

const SRC_ROOT = resolve(__dirname, "..");

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "c-1",
    user_id: "u-1",
    name: "Spring Push",
    description: null,
    status: "active",
    metadata: {},
    last_activity_at: null,
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: "p-1",
    user_id: "u-1",
    campaign_id: "c-1",
    company_name: "Acme",
    website_url: "https://acme.com",
    contact_name: "Alex",
    contact_email: "alex@acme.com",
    contact_phone: null,
    notes: null,
    status: "new",
    source: null,
    campaign: null,
    outreach_summary: null,
    outreach_status: "draft",
    last_outreach_sent_at: null,
    next_follow_up_due_at: null,
    follow_up_count: 0,
    metadata: {},
    converted_client_id: null,
    converted_project_id: null,
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function makePackage(overrides: Partial<ProspectOutreachPackage> = {}): ProspectOutreachPackage {
  return {
    id: "pkg-1",
    prospect_id: "p-1",
    client_id: null,
    project_id: "proj-1",
    quote_id: null,
    status: "ready",
    package_data: {},
    offer_summary: "Offer summary",
    email_subject: "Subject",
    email_body: "Body",
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

function makeContinuation(overrides: Partial<ContinuationRequest> = {}): ContinuationRequest {
  return {
    id: "cr-1",
    prospect_id: "p-1",
    project_id: "proj-1",
    campaign_id: "c-1",
    user_id: "u-1",
    request_type: "pending_review",
    status: "pending",
    context: {},
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

describe("campaign detail analytics", () => {
  const campaign = makeCampaign();
  const now = new Date("2026-03-29T12:00:00Z");

  it("renders zero-safe metrics for an empty campaign", () => {
    expect(computeCampaignDetailAnalytics({
      campaign,
      rows: [],
      pendingContinuations: [],
      now,
    })).toEqual({
      totalProspects: 0,
      analyzed: 0,
      outreachPackageReady: 0,
      sentOutreach: 0,
      replied: 0,
      followUpsDue: 0,
      pausedInSequence: 0,
      pendingContinuations: 0,
      converted: 0,
      blockedProspects: 0,
      blockedOrPaused: 0,
    });
  });

  it("counts due, paused, continuation, and conversion signals", () => {
    const rows = [
      {
        prospect: makeProspect({
          id: "p-1",
          status: "analyzed",
          outreach_status: "followup_due",
          next_follow_up_due_at: "2026-03-29T10:00:00Z",
          converted_project_id: "proj-1",
        }),
        latestPackage: makePackage({ prospect_id: "p-1" }),
      },
      {
        prospect: makeProspect({
          id: "p-2",
          status: "ready_for_outreach",
          contact_email: null,
          metadata: {
            sequence_state: {
              current_step: 2,
              steps: [],
              paused: true,
              paused_reason: "manual",
            },
          },
        }),
        latestPackage: makePackage({ id: "pkg-2", prospect_id: "p-2", client_id: "cl-1", project_id: "proj-2" }),
      },
      {
        prospect: makeProspect({
          id: "p-3",
          status: "converted",
          outreach_status: "replied",
          converted_client_id: "cl-3",
        }),
        latestPackage: makePackage({ id: "pkg-3", prospect_id: "p-3" }),
      },
    ];

    const analytics = computeCampaignDetailAnalytics({
      campaign,
      rows,
      pendingContinuations: [makeContinuation()],
      now,
    });

    expect(analytics.totalProspects).toBe(3);
    expect(analytics.analyzed).toBe(3);
    expect(analytics.outreachPackageReady).toBe(3);
    expect(analytics.sentOutreach).toBe(2);
    expect(analytics.replied).toBe(1);
    expect(analytics.followUpsDue).toBe(1);
    expect(analytics.pausedInSequence).toBe(1);
    expect(analytics.pendingContinuations).toBe(1);
    expect(analytics.converted).toBe(2);
    expect(analytics.blockedProspects).toBe(2);
    expect(analytics.blockedOrPaused).toBe(2);
  });

  it("does not count do-not-contact prospects as due follow-ups", () => {
    const analytics = computeCampaignDetailAnalytics({
      campaign,
      rows: [
        {
          prospect: makeProspect({
            id: "p-1",
            outreach_status: "do_not_contact",
            next_follow_up_due_at: "2026-03-29T09:00:00Z",
          }),
          latestPackage: makePackage({ prospect_id: "p-1" }),
        },
      ],
      pendingContinuations: [],
      now,
    });

    expect(analytics.followUpsDue).toBe(0);
  });
});

describe("campaign detail analytics ui integration", () => {
  it("loads analytics into the campaign detail page and manager", () => {
    const pagePath = join(SRC_ROOT, "app/dashboard/campaigns/[id]/page.tsx");
    const managerPath = join(SRC_ROOT, "app/dashboard/campaigns/[id]/campaign-detail-manager.tsx");
    const pageSource = readFileSync(pagePath, "utf-8");
    const managerSource = readFileSync(managerPath, "utf-8");

    expect(pageSource).toContain("computeCampaignDetailAnalytics");
    expect(pageSource).toContain("analytics={analytics}");
    expect(managerSource).toContain('data-testid="campaign-analytics-row"');
    expect(managerSource).toContain('data-testid="campaign-analytics-needs-attention"');
    expect(managerSource).toContain('testId="campaign-analytics-total-prospects"');
    expect(managerSource).toContain('testId="campaign-analytics-followups-due"');
    expect(managerSource).toContain('testId="campaign-analytics-pending-continuations"');
    expect(managerSource).toContain("Needs Attention");
  });
});
