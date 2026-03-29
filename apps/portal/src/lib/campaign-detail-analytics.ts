import { computeFollowUpsDue } from "./analytics";
import { readProspectSequenceState } from "./campaign-sequences";
import { getProspectSendReadiness } from "./outreach-execution";
import type {
  Campaign,
  ContinuationRequest,
  Prospect,
  ProspectOutreachPackage,
} from "./types";

export interface CampaignDetailAnalyticsInputRow {
  prospect: Prospect;
  latestPackage: ProspectOutreachPackage | null;
}

export interface CampaignDetailAnalytics {
  totalProspects: number;
  analyzed: number;
  outreachPackageReady: number;
  sentOutreach: number;
  replied: number;
  followUpsDue: number;
  pausedInSequence: number;
  pendingContinuations: number;
  converted: number;
  blockedProspects: number;
  blockedOrPaused: number;
}

const ANALYZED_STATUSES = new Set<Prospect["status"]>([
  "analyzed",
  "ready_for_outreach",
  "converted",
]);

const SENT_OUTREACH_STATUSES = new Set<NonNullable<Prospect["outreach_status"]>>([
  "sent",
  "followup_due",
  "replied",
]);

function isPaused(prospect: Prospect) {
  return readProspectSequenceState(prospect.metadata)?.paused === true;
}

function isConverted(prospect: Prospect) {
  return Boolean(prospect.converted_client_id || prospect.converted_project_id || prospect.status === "converted");
}

export function computeCampaignDetailAnalytics(params: {
  campaign: Pick<Campaign, "id" | "name" | "status">;
  rows: CampaignDetailAnalyticsInputRow[];
  pendingContinuations: ContinuationRequest[];
  now?: Date;
}): CampaignDetailAnalytics {
  const now = params.now ?? new Date();
  const pausedIds = new Set<string>();
  const blockedOrPausedIds = new Set<string>();
  let analyzed = 0;
  let outreachPackageReady = 0;
  let sentOutreach = 0;
  let replied = 0;
  let converted = 0;
  let blockedProspects = 0;

  for (const row of params.rows) {
    const { prospect, latestPackage } = row;

    if (ANALYZED_STATUSES.has(prospect.status)) analyzed++;
    if (latestPackage?.status === "ready") outreachPackageReady++;
    if (prospect.outreach_status && SENT_OUTREACH_STATUSES.has(prospect.outreach_status)) sentOutreach++;
    if (prospect.outreach_status === "replied") replied++;
    if (isConverted(prospect)) converted++;

    if (isPaused(prospect)) {
      pausedIds.add(prospect.id);
      blockedOrPausedIds.add(prospect.id);
    }

    const readiness = getProspectSendReadiness({
      prospect,
      outreachPackage: latestPackage,
    });
    if (!readiness.ready) {
      blockedProspects++;
      blockedOrPausedIds.add(prospect.id);
    }
  }

  const followUpsDue = computeFollowUpsDue(
    params.rows.map((row) => row.prospect),
    new Map([[params.campaign.id, params.campaign as Campaign]]),
    now,
  ).length;

  return {
    totalProspects: params.rows.length,
    analyzed,
    outreachPackageReady,
    sentOutreach,
    replied,
    followUpsDue,
    pausedInSequence: pausedIds.size,
    pendingContinuations: params.pendingContinuations.length,
    converted,
    blockedProspects,
    blockedOrPaused: blockedOrPausedIds.size,
  };
}
