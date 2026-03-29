import type { createClient } from "./supabase/server";
import type {
  Campaign,
  OutreachSend,
  Prospect,
  Quote,
} from "./types";
import { readProspectSequenceState } from "./campaign-sequences";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

/* ── Funnel metrics ─────────────────────────────────────────────── */

export interface FunnelMetrics {
  totalProspects: number;
  prospectsByStatus: Record<string, number>;
  prospectsByOutreachStatus: Record<string, number>;
  campaignsCount: number;
  assignedToCampaign: number;
  withOutreachPackageReady: number;
  withSentOutreach: number;
  replied: number;
  followUpsDueNow: number;
  followUpsOverdue: number;
  pausedInSequence: number;
  convertedToClient: number;
  convertedToProject: number;
}

export interface SendMetrics {
  total: number;
  sent: number;
  pending: number;
  failed: number;
  blocked: number;
}

export interface CampaignRollup {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  totalProspects: number;
  sent: number;
  replied: number;
  followUpDue: number;
  paused: number;
  converted: number;
}

export interface FollowUpDueItem {
  prospectId: string;
  companyName: string;
  campaignId: string | null;
  campaignName: string | null;
  outreachStatus: string | null;
  nextFollowUpDueAt: string;
  overdue: boolean;
}

export interface QuotePipelineMetrics {
  totalQuotes: number;
  quotesByStatus: Record<string, number>;
  pipelineSetupCents: number;
  pipelineRecurringCents: number;
  acceptedSetupCents: number;
  acceptedRecurringCents: number;
}

export interface AnalyticsData {
  funnel: FunnelMetrics;
  sends: SendMetrics;
  campaignRollups: CampaignRollup[];
  followUpsDue: FollowUpDueItem[];
  quotePipeline: QuotePipelineMetrics;
}

/* ── Query helpers ──────────────────────────────────────────────── */

export async function fetchAnalyticsData(
  supabase: PortalSupabase,
): Promise<AnalyticsData> {
  const now = new Date();

  const [
    { data: prospects },
    { data: campaigns },
    { data: sends },
    { data: outreachPackages },
    { data: quotes },
  ] = await Promise.all([
    supabase.from("prospects").select("*").order("created_at", { ascending: false }),
    supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
    supabase.from("outreach_sends").select("id, status").order("created_at", { ascending: false }),
    supabase.from("prospect_outreach_packages").select("prospect_id, status"),
    supabase.from("quotes").select("status, setup_total_cents, recurring_total_cents"),
  ]);

  const allProspects = (prospects ?? []) as Prospect[];
  const allCampaigns = (campaigns ?? []) as Campaign[];
  const allSends = (sends ?? []) as Pick<OutreachSend, "id" | "status">[];
  const readyPackageProspectIds = new Set(
    ((outreachPackages ?? []) as Array<{ prospect_id: string; status: string }>)
      .filter((pkg) => pkg.status === "ready")
      .map((pkg) => pkg.prospect_id),
  );
  const allQuotes = (quotes ?? []) as Pick<Quote, "status" | "setup_total_cents" | "recurring_total_cents">[];

  const campaignMap = new Map(allCampaigns.map((c) => [c.id, c]));

  const funnel = computeFunnelMetrics(allProspects, allCampaigns, readyPackageProspectIds, now);
  const sendMetrics = computeSendMetrics(allSends);
  const campaignRollups = computeCampaignRollups(allProspects, campaignMap, now);
  const followUpsDue = computeFollowUpsDue(allProspects, campaignMap, now);
  const quotePipeline = computeQuotePipeline(allQuotes);

  return {
    funnel,
    sends: sendMetrics,
    campaignRollups,
    followUpsDue,
    quotePipeline,
  };
}

/* ── Pure computation (testable) ────────────────────────────────── */

export function computeFunnelMetrics(
  prospects: Prospect[],
  campaigns: Campaign[],
  readyPackageProspectIds: Set<string>,
  now: Date,
): FunnelMetrics {
  const prospectsByStatus: Record<string, number> = {};
  const prospectsByOutreachStatus: Record<string, number> = {};
  let assignedToCampaign = 0;
  let withSentOutreach = 0;
  let replied = 0;
  let followUpsDueNow = 0;
  let followUpsOverdue = 0;
  let pausedInSequence = 0;
  let convertedToClient = 0;
  let convertedToProject = 0;

  for (const p of prospects) {
    prospectsByStatus[p.status] = (prospectsByStatus[p.status] ?? 0) + 1;

    if (p.outreach_status) {
      prospectsByOutreachStatus[p.outreach_status] =
        (prospectsByOutreachStatus[p.outreach_status] ?? 0) + 1;
    }

    if (p.campaign_id) assignedToCampaign++;
    if (p.outreach_status === "sent" || p.outreach_status === "followup_due") withSentOutreach++;
    if (p.outreach_status === "replied") replied++;
    if (p.converted_client_id) convertedToClient++;
    if (p.converted_project_id) convertedToProject++;

    // Follow-up due tracking
    if (p.next_follow_up_due_at) {
      const dueAt = new Date(p.next_follow_up_due_at);
      if (dueAt <= now) {
        followUpsOverdue++;
      }
      // "due now" = due within the next 24 hours or overdue
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      if (dueAt <= tomorrow) {
        followUpsDueNow++;
      }
    }

    // Check sequence state for paused
    const seqState = readProspectSequenceState(p.metadata);
    if (seqState?.paused) pausedInSequence++;
  }

  return {
    totalProspects: prospects.length,
    prospectsByStatus,
    prospectsByOutreachStatus,
    campaignsCount: campaigns.length,
    assignedToCampaign,
    withOutreachPackageReady: prospects.filter((p) => readyPackageProspectIds.has(p.id)).length,
    withSentOutreach,
    replied,
    followUpsDueNow,
    followUpsOverdue,
    pausedInSequence,
    convertedToClient,
    convertedToProject,
  };
}

export function computeSendMetrics(
  sends: Pick<OutreachSend, "id" | "status">[],
): SendMetrics {
  let sent = 0;
  let pending = 0;
  let failed = 0;
  let blocked = 0;

  for (const s of sends) {
    switch (s.status) {
      case "sent": sent++; break;
      case "pending": pending++; break;
      case "failed": failed++; break;
      case "blocked": blocked++; break;
    }
  }

  return { total: sends.length, sent, pending, failed, blocked };
}

export function computeCampaignRollups(
  prospects: Prospect[],
  campaignMap: Map<string, Campaign>,
  now: Date,
): CampaignRollup[] {
  const rollupMap = new Map<string, CampaignRollup>();

  for (const [id, campaign] of campaignMap) {
    rollupMap.set(id, {
      campaignId: id,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      totalProspects: 0,
      sent: 0,
      replied: 0,
      followUpDue: 0,
      paused: 0,
      converted: 0,
    });
  }

  for (const p of prospects) {
    if (!p.campaign_id || !rollupMap.has(p.campaign_id)) continue;
    const rollup = rollupMap.get(p.campaign_id)!;
    rollup.totalProspects++;

    if (p.outreach_status === "sent" || p.outreach_status === "followup_due") rollup.sent++;
    if (p.outreach_status === "replied") rollup.replied++;
    if (p.converted_client_id || p.converted_project_id) rollup.converted++;

    if (p.next_follow_up_due_at) {
      const dueAt = new Date(p.next_follow_up_due_at);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      if (dueAt <= tomorrow) rollup.followUpDue++;
    }

    const seqState = readProspectSequenceState(p.metadata);
    if (seqState?.paused) rollup.paused++;
  }

  return Array.from(rollupMap.values())
    .filter((r) => r.totalProspects > 0 || r.campaignStatus === "active")
    .sort((a, b) => b.totalProspects - a.totalProspects);
}

export function computeFollowUpsDue(
  prospects: Prospect[],
  campaignMap: Map<string, Campaign>,
  now: Date,
): FollowUpDueItem[] {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const items: FollowUpDueItem[] = [];

  for (const p of prospects) {
    if (!p.next_follow_up_due_at) continue;
    const dueAt = new Date(p.next_follow_up_due_at);
    if (dueAt > tomorrow) continue;

    const campaign = p.campaign_id ? campaignMap.get(p.campaign_id) : null;
    items.push({
      prospectId: p.id,
      companyName: p.company_name,
      campaignId: p.campaign_id ?? null,
      campaignName: campaign?.name ?? null,
      outreachStatus: p.outreach_status ?? null,
      nextFollowUpDueAt: p.next_follow_up_due_at,
      overdue: dueAt <= now,
    });
  }

  return items.sort((a, b) => new Date(a.nextFollowUpDueAt).getTime() - new Date(b.nextFollowUpDueAt).getTime());
}

export function computeQuotePipeline(
  quotes: Pick<Quote, "status" | "setup_total_cents" | "recurring_total_cents">[],
): QuotePipelineMetrics {
  const quotesByStatus: Record<string, number> = {};
  let pipelineSetupCents = 0;
  let pipelineRecurringCents = 0;
  let acceptedSetupCents = 0;
  let acceptedRecurringCents = 0;

  for (const q of quotes) {
    quotesByStatus[q.status] = (quotesByStatus[q.status] ?? 0) + 1;

    // Pipeline = sent quotes not yet resolved
    if (q.status === "sent") {
      pipelineSetupCents += q.setup_total_cents;
      pipelineRecurringCents += q.recurring_total_cents;
    }

    if (q.status === "accepted") {
      acceptedSetupCents += q.setup_total_cents;
      acceptedRecurringCents += q.recurring_total_cents;
    }
  }

  return {
    totalQuotes: quotes.length,
    quotesByStatus,
    pipelineSetupCents,
    pipelineRecurringCents,
    acceptedSetupCents,
    acceptedRecurringCents,
  };
}
