import { readProspectSequenceState } from "./campaign-sequences";
import { buildPausedSequenceState } from "./sequence-execution";
import type { CampaignSequenceStep, Prospect } from "./types";

export function buildProspectReplyUpdate(params: {
  prospect: Pick<Prospect, "metadata" | "outreach_status">;
  sequenceSteps?: CampaignSequenceStep[];
  replySummary?: string | null;
  outreachSendId?: string | null;
  now?: Date;
}) {
  const nowIso = (params.now ?? new Date()).toISOString();
  const baseMetadata = {
    ...(params.prospect.metadata ?? {}),
    latest_reply_at: nowIso,
    latest_reply_summary: params.replySummary?.trim() || null,
    latest_reply_send_id: params.outreachSendId ?? null,
  } as Record<string, unknown>;

  const existingState = readProspectSequenceState(params.prospect.metadata);
  if (params.sequenceSteps && params.sequenceSteps.length > 0) {
    baseMetadata.sequence_state = buildPausedSequenceState({
      sequenceSteps: params.sequenceSteps,
      existingState,
      pausedReason: "replied",
    });
  } else if (existingState) {
    baseMetadata.sequence_state = {
      ...existingState,
      paused: true,
      paused_reason: "replied",
    };
  }

  return {
    outreach_status: "replied" as const,
    next_follow_up_due_at: null,
    metadata: baseMetadata,
  };
}
