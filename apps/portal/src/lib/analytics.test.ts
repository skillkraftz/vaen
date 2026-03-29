import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  computeFunnelMetrics,
  computeSendMetrics,
  computeCampaignRollups,
  computeFollowUpsDue,
  computeQuotePipeline,
} from "./analytics";
import type { Campaign, Prospect, OutreachSend, Quote } from "./types";

const SRC_ROOT = resolve(__dirname, "..");

/* ── Helper factories ───────────────────────────────────────────── */

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: "p-1",
    user_id: "u-1",
    company_name: "Acme",
    website_url: "https://acme.com",
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    notes: null,
    status: "new",
    source: null,
    campaign: null,
    outreach_summary: null,
    metadata: {},
    converted_client_id: null,
    converted_project_id: null,
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

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

/* ── Pure computation tests ─────────────────────────────────────── */

describe("analytics funnel metrics", () => {
  const now = new Date("2026-03-29T12:00:00Z");

  it("counts total prospects and status breakdowns", () => {
    const prospects = [
      makeProspect({ id: "p-1", status: "new" }),
      makeProspect({ id: "p-2", status: "analyzed" }),
      makeProspect({ id: "p-3", status: "converted", converted_client_id: "cl-1" }),
    ];
    const funnel = computeFunnelMetrics(prospects, [], new Set(), now);

    expect(funnel.totalProspects).toBe(3);
    expect(funnel.prospectsByStatus).toEqual({ new: 1, analyzed: 1, converted: 1 });
    expect(funnel.convertedToClient).toBe(1);
  });

  it("counts campaign assignments and outreach statuses", () => {
    const campaigns = [makeCampaign()];
    const prospects = [
      makeProspect({ id: "p-1", campaign_id: "c-1", outreach_status: "sent" }),
      makeProspect({ id: "p-2", campaign_id: "c-1", outreach_status: "replied" }),
      makeProspect({ id: "p-3", outreach_status: "draft" }),
    ];
    const funnel = computeFunnelMetrics(prospects, campaigns, new Set(), now);

    expect(funnel.assignedToCampaign).toBe(2);
    expect(funnel.withSentOutreach).toBe(1);
    expect(funnel.replied).toBe(1);
    expect(funnel.prospectsByOutreachStatus).toEqual({ sent: 1, replied: 1, draft: 1 });
    expect(funnel.campaignsCount).toBe(1);
  });

  it("counts ready outreach packages", () => {
    const prospects = [
      makeProspect({ id: "p-1" }),
      makeProspect({ id: "p-2" }),
    ];
    const readyIds = new Set(["p-2"]);
    const funnel = computeFunnelMetrics(prospects, [], readyIds, now);
    expect(funnel.withOutreachPackageReady).toBe(1);
  });

  it("tracks follow-ups due and overdue", () => {
    const prospects = [
      makeProspect({ id: "p-1", next_follow_up_due_at: "2026-03-29T10:00:00Z" }), // overdue (before now)
      makeProspect({ id: "p-2", next_follow_up_due_at: "2026-03-29T18:00:00Z" }), // due today (within 24h)
      makeProspect({ id: "p-3", next_follow_up_due_at: "2026-04-05T00:00:00Z" }), // future
    ];
    const funnel = computeFunnelMetrics(prospects, [], new Set(), now);

    expect(funnel.followUpsOverdue).toBe(1);
    expect(funnel.followUpsDueNow).toBe(2); // both overdue + due today
  });

  it("excludes paused and do_not_contact prospects from due follow-up counts", () => {
    const prospects = [
      makeProspect({
        id: "p-1",
        outreach_status: "do_not_contact",
        next_follow_up_due_at: "2026-03-29T10:00:00Z",
      }),
      makeProspect({
        id: "p-2",
        next_follow_up_due_at: "2026-03-29T11:00:00Z",
        metadata: {
          sequence_state: {
            current_step: 2,
            steps: [],
            paused: true,
            paused_reason: "manual",
          },
        },
      }),
      makeProspect({
        id: "p-3",
        next_follow_up_due_at: "2026-03-29T09:00:00Z",
      }),
    ];

    const funnel = computeFunnelMetrics(prospects, [], new Set(), now);

    expect(funnel.followUpsOverdue).toBe(1);
    expect(funnel.followUpsDueNow).toBe(1);
  });

  it("detects paused prospects via sequence state", () => {
    const prospects = [
      makeProspect({
        id: "p-1",
        metadata: {
          sequence_state: {
            current_step: 1,
            steps: [{ step_number: 1, sent_at: null, send_id: null, due_at: null, skipped: false }],
            paused: true,
            paused_reason: "replied",
          },
        },
      }),
      makeProspect({ id: "p-2", metadata: {} }),
    ];
    const funnel = computeFunnelMetrics(prospects, [], new Set(), now);
    expect(funnel.pausedInSequence).toBe(1);
  });
});

describe("analytics send metrics", () => {
  it("counts sends by status", () => {
    const sends: Pick<OutreachSend, "id" | "status">[] = [
      { id: "s-1", status: "sent" },
      { id: "s-2", status: "sent" },
      { id: "s-3", status: "failed" },
      { id: "s-4", status: "pending" },
      { id: "s-5", status: "blocked" },
    ];
    const result = computeSendMetrics(sends);

    expect(result.total).toBe(5);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.blocked).toBe(1);
  });

  it("handles empty sends", () => {
    const result = computeSendMetrics([]);
    expect(result).toEqual({ total: 0, sent: 0, pending: 0, failed: 0, blocked: 0 });
  });
});

describe("analytics campaign rollups", () => {
  const now = new Date("2026-03-29T12:00:00Z");

  it("aggregates prospect metrics per campaign", () => {
    const campaign = makeCampaign({ id: "c-1", name: "Spring Push" });
    const campaignMap = new Map([["c-1", campaign]]);
    const prospects = [
      makeProspect({ id: "p-1", campaign_id: "c-1", outreach_status: "sent" }),
      makeProspect({ id: "p-2", campaign_id: "c-1", outreach_status: "replied" }),
      makeProspect({ id: "p-3", campaign_id: "c-1", converted_client_id: "cl-1" }),
      makeProspect({ id: "p-4" }), // no campaign
    ];
    const rollups = computeCampaignRollups(prospects, campaignMap, now);

    expect(rollups).toHaveLength(1);
    expect(rollups[0].campaignName).toBe("Spring Push");
    expect(rollups[0].totalProspects).toBe(3);
    expect(rollups[0].sent).toBe(1);
    expect(rollups[0].replied).toBe(1);
    expect(rollups[0].converted).toBe(1);
  });

  it("does not count paused or do_not_contact prospects as due follow-ups in rollups", () => {
    const campaign = makeCampaign({ id: "c-1", name: "Spring Push" });
    const campaignMap = new Map([["c-1", campaign]]);
    const prospects = [
      makeProspect({
        id: "p-1",
        campaign_id: "c-1",
        next_follow_up_due_at: "2026-03-29T10:00:00Z",
        metadata: {
          sequence_state: {
            current_step: 2,
            steps: [],
            paused: true,
            paused_reason: "manual",
          },
        },
      }),
      makeProspect({
        id: "p-2",
        campaign_id: "c-1",
        outreach_status: "do_not_contact",
        next_follow_up_due_at: "2026-03-29T11:00:00Z",
      }),
      makeProspect({
        id: "p-3",
        campaign_id: "c-1",
        next_follow_up_due_at: "2026-03-29T09:00:00Z",
      }),
    ];

    const rollups = computeCampaignRollups(prospects, campaignMap, now);
    expect(rollups[0].followUpDue).toBe(1);
  });

  it("includes active campaigns with zero prospects", () => {
    const campaign = makeCampaign({ id: "c-1", status: "active" });
    const campaignMap = new Map([["c-1", campaign]]);
    const rollups = computeCampaignRollups([], campaignMap, now);

    expect(rollups).toHaveLength(1);
    expect(rollups[0].totalProspects).toBe(0);
  });

  it("excludes non-active empty campaigns", () => {
    const campaign = makeCampaign({ id: "c-1", status: "draft" });
    const campaignMap = new Map([["c-1", campaign]]);
    const rollups = computeCampaignRollups([], campaignMap, now);

    expect(rollups).toHaveLength(0);
  });
});

describe("analytics follow-ups due", () => {
  const now = new Date("2026-03-29T12:00:00Z");

  it("returns overdue and due-soon follow-ups sorted by date", () => {
    const campaign = makeCampaign({ id: "c-1", name: "Spring Push" });
    const campaignMap = new Map([["c-1", campaign]]);
    const prospects = [
      makeProspect({
        id: "p-1",
        company_name: "Late Co",
        campaign_id: "c-1",
        next_follow_up_due_at: "2026-03-28T10:00:00Z",
        outreach_status: "followup_due",
      }),
      makeProspect({
        id: "p-2",
        company_name: "Soon Co",
        next_follow_up_due_at: "2026-03-29T20:00:00Z",
      }),
      makeProspect({
        id: "p-3",
        company_name: "Far Co",
        next_follow_up_due_at: "2026-04-15T00:00:00Z",
      }),
    ];

    const result = computeFollowUpsDue(prospects, campaignMap, now);

    expect(result).toHaveLength(2);
    expect(result[0].companyName).toBe("Late Co");
    expect(result[0].overdue).toBe(true);
    expect(result[0].campaignName).toBe("Spring Push");
    expect(result[1].companyName).toBe("Soon Co");
    expect(result[1].overdue).toBe(false);
  });

  it("omits paused and do_not_contact prospects from the due list", () => {
    const campaign = makeCampaign({ id: "c-1", name: "Spring Push" });
    const campaignMap = new Map([["c-1", campaign]]);
    const prospects = [
      makeProspect({
        id: "p-1",
        company_name: "Paused Co",
        campaign_id: "c-1",
        next_follow_up_due_at: "2026-03-28T10:00:00Z",
        metadata: {
          sequence_state: {
            current_step: 2,
            steps: [],
            paused: true,
            paused_reason: "manual",
          },
        },
      }),
      makeProspect({
        id: "p-2",
        company_name: "Blocked Co",
        campaign_id: "c-1",
        outreach_status: "do_not_contact",
        next_follow_up_due_at: "2026-03-28T11:00:00Z",
      }),
      makeProspect({
        id: "p-3",
        company_name: "Real Co",
        campaign_id: "c-1",
        next_follow_up_due_at: "2026-03-28T12:00:00Z",
      }),
    ];

    const result = computeFollowUpsDue(prospects, campaignMap, now);
    expect(result.map((item) => item.companyName)).toEqual(["Real Co"]);
  });
});

describe("analytics quote pipeline", () => {
  it("computes pipeline and accepted totals", () => {
    const quotes: Pick<Quote, "status" | "setup_total_cents" | "recurring_total_cents">[] = [
      { status: "sent", setup_total_cents: 50000, recurring_total_cents: 10000 },
      { status: "sent", setup_total_cents: 30000, recurring_total_cents: 5000 },
      { status: "accepted", setup_total_cents: 20000, recurring_total_cents: 3000 },
      { status: "draft", setup_total_cents: 10000, recurring_total_cents: 0 },
    ];
    const result = computeQuotePipeline(quotes);

    expect(result.totalQuotes).toBe(4);
    expect(result.pipelineSetupCents).toBe(80000);
    expect(result.pipelineRecurringCents).toBe(15000);
    expect(result.acceptedSetupCents).toBe(20000);
    expect(result.acceptedRecurringCents).toBe(3000);
    expect(result.quotesByStatus).toEqual({ sent: 2, accepted: 1, draft: 1 });
  });

  it("handles zero quotes", () => {
    const result = computeQuotePipeline([]);
    expect(result.totalQuotes).toBe(0);
    expect(result.pipelineSetupCents).toBe(0);
  });
});

/* ── Integration tests ──────────────────────────────────────────── */

describe("analytics page integration", () => {
  it("has analytics page with role gating and data fetch", () => {
    const pagePath = join(SRC_ROOT, "app/dashboard/analytics/page.tsx");
    expect(existsSync(pagePath)).toBe(true);
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain('requireRole("sales")');
    expect(source).toContain("fetchAnalyticsData");
    expect(source).toContain("AnalyticsDashboard");
    expect(source).toContain('data-testid="analytics-page-error"');
    expect(source).toContain("Analytics data is unavailable right now.");
  });

  it("has analytics dashboard with expected sections", () => {
    const dashboardPath = join(SRC_ROOT, "app/dashboard/analytics/analytics-dashboard.tsx");
    expect(existsSync(dashboardPath)).toBe(true);
    const source = readFileSync(dashboardPath, "utf-8");
    expect(source).toContain('data-testid="analytics-page"');
    expect(source).toContain('data-testid="analytics-send-metrics"');
    expect(source).toContain('data-testid="analytics-funnel-metrics"');
    expect(source).toContain('data-testid="analytics-campaign-rollups"');
    expect(source).toContain('data-testid="analytics-followups-due"');
    expect(source).toContain('data-testid="analytics-prospect-status"');
    expect(source).toContain('data-testid="analytics-outreach-status"');
    expect(source).toContain('data-testid="analytics-quote-pipeline-empty"');
    expect(source).toContain("/dashboard/prospects/");
    expect(source).toContain("/dashboard/campaigns/");
  });

  it("adds analytics nav link to the dashboard layout with role gating", () => {
    const layoutPath = join(SRC_ROOT, "app/dashboard/layout.tsx");
    const source = readFileSync(layoutPath, "utf-8");
    expect(source).toContain('href="/dashboard/analytics"');
    expect(source).toContain("roleSatisfies");
    expect(source).toContain('"sales"');
  });

  it("exports pure computation helpers for unit testing", () => {
    const analyticsPath = join(SRC_ROOT, "lib/analytics.ts");
    expect(existsSync(analyticsPath)).toBe(true);
    const source = readFileSync(analyticsPath, "utf-8");
    expect(source).toContain("export function computeFunnelMetrics");
    expect(source).toContain("export function computeSendMetrics");
    expect(source).toContain("export function computeCampaignRollups");
    expect(source).toContain("export function computeFollowUpsDue");
    expect(source).toContain("export function computeQuotePipeline");
    expect(source).toContain("export async function fetchAnalyticsData");
  });
});
