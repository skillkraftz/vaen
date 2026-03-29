import { getEmailSenderConfig, getOutreachFromEmail } from "./email-sender-config";

export { getOutreachFromEmail } from "./email-sender-config";

export interface OutreachConfigCheck {
  ok: boolean;
  env: string;
  message: string;
}

export interface OutreachConfigReadiness {
  ready: boolean;
  issues: string[];
  checks: {
    resendApiKey: OutreachConfigCheck;
    fromEmail: OutreachConfigCheck;
    fromName: OutreachConfigCheck;
    replyTo: OutreachConfigCheck;
    portalUrl: OutreachConfigCheck;
  };
  values: {
    fromEmail: string | null;
    fromName: string;
    fromAddress: string | null;
    replyTo: string | null;
    portalUrl: string | null;
  };
}

export function normalizePortalBaseUrl(value: string | undefined) {
  const trimmed = value?.trim() ? value.trim() : null;
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function getOutreachConfigReadiness(
  env: NodeJS.ProcessEnv = process.env,
): OutreachConfigReadiness {
  const apiKey = env.RESEND_API_KEY?.trim() ? env.RESEND_API_KEY.trim() : null;
  const senderConfig = getEmailSenderConfig(env);
  const fromEmail = getOutreachFromEmail(env);
  const portalUrl = normalizePortalBaseUrl(env.NEXT_PUBLIC_PORTAL_URL);
  const fromEmailIssue = senderConfig.issues.find((issue) => (
    issue.includes("RESEND_FROM_EMAIL") || issue.includes("OUTREACH_FROM_EMAIL")
  )) ?? null;
  const replyToIssue = senderConfig.issues.find((issue) => issue.includes("RESEND_REPLY_TO")) ?? null;

  const checks = {
    resendApiKey: {
      ok: !!apiKey,
      env: "RESEND_API_KEY",
      message: apiKey
        ? "Resend API key is configured."
        : "RESEND_API_KEY is missing.",
    },
    fromEmail: {
      ok: !fromEmailIssue,
      env: "RESEND_FROM_EMAIL or OUTREACH_FROM_EMAIL",
      message: fromEmailIssue
        ? fromEmailIssue
        : fromEmail
        ? `Outbound email sender is configured as ${fromEmail}.`
        : "RESEND_FROM_EMAIL or OUTREACH_FROM_EMAIL is missing.",
    },
    fromName: {
      ok: !!senderConfig.fromName,
      env: "RESEND_FROM_NAME",
      message: `Outbound sender name resolves to ${senderConfig.fromName}.`,
    },
    replyTo: {
      ok: !replyToIssue,
      env: "RESEND_REPLY_TO",
      message: replyToIssue
        ? replyToIssue
        : senderConfig.replyTo
        ? `Reply-to email resolves to ${senderConfig.replyTo}.`
        : "Reply-to email is optional and currently unset.",
    },
    portalUrl: {
      ok: !!portalUrl,
      env: "NEXT_PUBLIC_PORTAL_URL",
      message: portalUrl
        ? `Portal URL is configured as ${portalUrl}.`
        : "NEXT_PUBLIC_PORTAL_URL is missing or not a valid absolute URL.",
    },
  } satisfies OutreachConfigReadiness["checks"];

  const issues = Object.values(checks)
    .filter((check) => !check.ok)
    .map((check) => check.message);

  return {
    ready: issues.length === 0,
    issues,
    checks,
    values: {
      fromEmail,
      fromName: senderConfig.fromName,
      fromAddress: senderConfig.fromAddress,
      replyTo: senderConfig.replyTo,
      portalUrl,
    },
  };
}
