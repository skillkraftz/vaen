import type { ApprovalRequest, ApprovalStatus } from "./types";

export const APPROVAL_EXPIRY_HOURS = 72;

export function getApprovalExpiryDate(now = new Date()) {
  return new Date(now.getTime() + APPROVAL_EXPIRY_HOURS * 60 * 60 * 1000);
}

export function isApprovalExpired(
  request: Pick<ApprovalRequest, "status" | "expires_at">,
  now = new Date(),
) {
  return request.status === "pending"
    && !!request.expires_at
    && new Date(request.expires_at).getTime() < now.getTime();
}

export function getApprovalEffectiveStatus(
  request: Pick<ApprovalRequest, "status" | "expires_at">,
  now = new Date(),
): ApprovalStatus {
  return isApprovalExpired(request, now) ? "expired" : request.status;
}

export function canResolveApproval(params: {
  requestedBy: string;
  resolverId: string;
  adminCount: number;
}) {
  if (params.requestedBy !== params.resolverId) {
    return { allowed: true, soleAdminFallback: false };
  }

  if (params.adminCount === 1) {
    return { allowed: true, soleAdminFallback: true };
  }

  return { allowed: false, soleAdminFallback: false };
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summarizeApprovalRequest(request: ApprovalRequest) {
  const context = request.context ?? {};
  if (request.request_type === "large_discount") {
    const quoteNumber = asNumber(context.quote_number);
    const percent = asNumber(context.discount_percent);
    const company = asString(context.client_name);
    return `Quote #${quoteNumber ?? "?"} · ${percent ?? 0}% discount${company ? ` · ${company}` : ""}`;
  }
  if (request.request_type === "batch_outreach") {
    const count = asNumber(context.prospect_count);
    const campaignName = asString(context.campaign_name);
    return `Batch outreach · ${count ?? 0} prospects${campaignName ? ` · ${campaignName}` : ""}`;
  }
  return `Project purge · ${asString(context.project_name) ?? asString(context.project_slug) ?? "Unknown project"}`;
}
