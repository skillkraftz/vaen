import type {
  DeploymentProviderAdapter,
  ProviderExecutionContext,
  ProviderStepResult,
} from "@vaen/shared";

/**
 * Domain provider adapter.
 *
 * When configured, this will:
 * 1. Configure the subdomain (e.g. <slug>.vaen.space) via DNS provider
 * 2. Optionally set up a custom domain if specified in the deployment payload
 * 3. Verify DNS propagation
 * 4. Return the live domain as provider reference
 *
 * Currently: returns not_configured. This adapter runs last in the
 * provider execution sequence since it depends on the hosting target
 * being live first.
 */
export class DomainProviderAdapter implements DeploymentProviderAdapter {
  readonly type = "domain" as const;

  private apiToken: string | null;
  private baseDomain: string | null;

  constructor() {
    this.apiToken = process.env.DNS_PROVIDER_TOKEN ?? null;
    this.baseDomain = process.env.VAEN_BASE_DOMAIN ?? null;
  }

  isConfigured(): boolean {
    return Boolean(this.apiToken && this.baseDomain);
  }

  async execute(context: ProviderExecutionContext): Promise<ProviderStepResult> {
    const now = new Date().toISOString();

    if (!this.isConfigured()) {
      return {
        provider: "domain",
        status: "not_configured",
        message: "Domain provider is not configured. Set DNS_PROVIDER_TOKEN and VAEN_BASE_DOMAIN environment variables.",
        providerReference: null,
        executedAt: now,
        metadata: {
          hasApiToken: Boolean(this.apiToken),
          hasBaseDomain: Boolean(this.baseDomain),
        },
      };
    }

    // Real implementation will go here:
    // 1. DNS API client from this.apiToken
    // 2. Create CNAME: <slug>.vaen.space → Vercel deployment
    // 3. Optionally: configure custom domain from payload.domain.customDomain
    // 4. Verify propagation or schedule async check
    // 5. Return domain as providerReference
    //
    // For now, return not_configured to avoid faking success.
    return {
      provider: "domain",
      status: "not_configured",
      message: "Domain provider adapter is registered but execution is not yet implemented.",
      providerReference: null,
      executedAt: now,
      metadata: {
        baseDomain: this.baseDomain,
        targetSlug: context.targetSlug,
        implementation: "pending",
      },
    };
  }
}
