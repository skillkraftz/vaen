export interface ResendTag {
  name: string;
  value: string;
}

function maybeTag(name: string, value: string | null | undefined): ResendTag | null {
  const trimmed = value?.trim();
  return trimmed ? { name, value: trimmed } : null;
}

export function buildResendTags(params: {
  campaignId?: string | null;
  prospectId: string;
  projectId?: string | null;
  sendType: "manual" | "sequence";
  sequenceStep?: number | null;
}) {
  return [
    maybeTag("campaign_id", params.campaignId ?? null),
    maybeTag("prospect_id", params.prospectId),
    maybeTag("project_id", params.projectId ?? null),
    maybeTag("send_type", params.sendType),
    params.sequenceStep ? maybeTag("sequence_step", String(params.sequenceStep)) : null,
  ].filter((tag): tag is ResendTag => !!tag);
}
