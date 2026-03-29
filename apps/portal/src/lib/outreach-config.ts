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
    portalUrl: OutreachConfigCheck;
  };
  values: {
    fromEmail: string | null;
    portalUrl: string | null;
  };
}

function asTrimmedValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getOutreachFromEmail(env: NodeJS.ProcessEnv = process.env) {
  return asTrimmedValue(env.OUTREACH_FROM_EMAIL) ?? asTrimmedValue(env.RESEND_FROM_EMAIL);
}

export function normalizePortalBaseUrl(value: string | undefined) {
  const trimmed = asTrimmedValue(value);
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
  const apiKey = asTrimmedValue(env.RESEND_API_KEY);
  const fromEmail = getOutreachFromEmail(env);
  const portalUrl = normalizePortalBaseUrl(env.NEXT_PUBLIC_PORTAL_URL);

  const checks = {
    resendApiKey: {
      ok: !!apiKey,
      env: "RESEND_API_KEY",
      message: apiKey
        ? "Resend API key is configured."
        : "RESEND_API_KEY is missing.",
    },
    fromEmail: {
      ok: !!fromEmail,
      env: "OUTREACH_FROM_EMAIL or RESEND_FROM_EMAIL",
      message: fromEmail
        ? `Outbound email sender is configured as ${fromEmail}.`
        : "OUTREACH_FROM_EMAIL or RESEND_FROM_EMAIL is missing.",
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
      portalUrl,
    },
  };
}
