import { normalizePortalBaseUrl } from "./outreach-config";

export interface DeploymentReadinessCheck {
  ok: boolean;
  level: "required" | "recommended";
  label: string;
  message: string;
}

export interface DeploymentReadiness {
  ready: boolean;
  warnings: string[];
  blockers: string[];
  checks: {
    portalUrl: DeploymentReadinessCheck;
    portalHost: DeploymentReadinessCheck;
    authCallback: DeploymentReadinessCheck;
    resendWebhook: DeploymentReadinessCheck;
    supabaseUrl: DeploymentReadinessCheck;
    supabaseAnonKey: DeploymentReadinessCheck;
    serviceRoleKey: DeploymentReadinessCheck;
    deploymentPayloadSupport: DeploymentReadinessCheck;
  };
  values: {
    portalUrl: string | null;
    authCallbackUrl: string | null;
    resendWebhookUrl: string | null;
    expectedProductionHost: string;
  };
}

export interface DeploymentReadinessOptions {
  deploymentPayloadSupport?: boolean;
}

function hasEnv(value: string | undefined) {
  return Boolean(value?.trim());
}

export function getDeploymentReadiness(
  env: NodeJS.ProcessEnv = process.env,
  options: DeploymentReadinessOptions = {},
): DeploymentReadiness {
  const expectedProductionHost = "vaen.space";
  const portalUrl = normalizePortalBaseUrl(env.NEXT_PUBLIC_PORTAL_URL);
  const portalHostMatches = portalUrl
    ? new URL(portalUrl).hostname === expectedProductionHost || new URL(portalUrl).hostname === "localhost"
    : false;
  const authCallbackUrl = portalUrl ? `${portalUrl}/auth/callback` : null;
  const resendWebhookUrl = portalUrl ? `${portalUrl}/api/webhooks/resend` : null;
  const payloadSupport = options.deploymentPayloadSupport ?? true;

  const checks = {
    portalUrl: {
      ok: !!portalUrl,
      level: "required",
      label: "Portal base URL",
      message: portalUrl
        ? `Portal base URL resolves to ${portalUrl}.`
        : "NEXT_PUBLIC_PORTAL_URL is missing or not a valid absolute URL.",
    },
    portalHost: {
      ok: !!portalUrl && portalHostMatches,
      level: "recommended",
      label: "Production hostname",
      message: portalUrl
        ? portalHostMatches
          ? `Portal hostname is compatible with production expectations (${new URL(portalUrl).hostname}).`
          : `Portal hostname is ${new URL(portalUrl).hostname}; production should use ${expectedProductionHost}.`
        : "Portal hostname cannot be evaluated until NEXT_PUBLIC_PORTAL_URL is set.",
    },
    authCallback: {
      ok: !!authCallbackUrl,
      level: "required",
      label: "Auth callback URL",
      message: authCallbackUrl
        ? `Supabase auth callback should be configured as ${authCallbackUrl}.`
        : "Auth callback URL cannot be derived until NEXT_PUBLIC_PORTAL_URL is configured.",
    },
    resendWebhook: {
      ok: hasEnv(env.RESEND_WEBHOOK_SECRET) && !!resendWebhookUrl,
      level: "recommended",
      label: "Resend webhook target",
      message: resendWebhookUrl
        ? hasEnv(env.RESEND_WEBHOOK_SECRET)
          ? `Resend webhook signing is ready for ${resendWebhookUrl}.`
          : `Resend webhook endpoint will be ${resendWebhookUrl}, but RESEND_WEBHOOK_SECRET is not configured yet.`
        : "Resend webhook URL cannot be derived until NEXT_PUBLIC_PORTAL_URL is configured.",
    },
    supabaseUrl: {
      ok: hasEnv(env.NEXT_PUBLIC_SUPABASE_URL),
      level: "required",
      label: "Supabase URL",
      message: hasEnv(env.NEXT_PUBLIC_SUPABASE_URL)
        ? "NEXT_PUBLIC_SUPABASE_URL is configured."
        : "NEXT_PUBLIC_SUPABASE_URL is missing.",
    },
    supabaseAnonKey: {
      ok: hasEnv(env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      level: "required",
      label: "Supabase anon key",
      message: hasEnv(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
        ? "NEXT_PUBLIC_SUPABASE_ANON_KEY is configured."
        : "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.",
    },
    serviceRoleKey: {
      ok: hasEnv(env.SUPABASE_SERVICE_ROLE_KEY),
      level: "required",
      label: "Service role key",
      message: hasEnv(env.SUPABASE_SERVICE_ROLE_KEY)
        ? "SUPABASE_SERVICE_ROLE_KEY is configured for worker/job and webhook flows."
        : "SUPABASE_SERVICE_ROLE_KEY is missing; job execution, admin queries, and webhook correlation will fail.",
    },
    deploymentPayloadSupport: {
      ok: payloadSupport,
      level: "required",
      label: "Deployment payload support",
      message: payloadSupport
        ? "Generator and schema support for deployment-payload.json are present in the repo."
        : "Deployment payload support files are missing from the repo.",
    },
  } satisfies DeploymentReadiness["checks"];

  const blockers = Object.values(checks)
    .filter((check) => check.level === "required" && !check.ok)
    .map((check) => check.message);
  const warnings = Object.values(checks)
    .filter((check) => check.level === "recommended" && !check.ok)
    .map((check) => check.message);

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    checks,
    values: {
      portalUrl,
      authCallbackUrl,
      resendWebhookUrl,
      expectedProductionHost,
    },
  };
}
