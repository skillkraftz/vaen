import type {
  DeploymentProviderAdapter,
  ProviderExecutionContext,
  ProviderStepResult,
} from "@vaen/shared";

export interface VercelProjectDomainInfo {
  name: string;
  verified: boolean | null;
}

export interface VercelDeploymentAliasInfo {
  alias: string;
  deploymentId: string | null;
}

export interface DomainApiClient {
  getProjectDomain(projectName: string, domain: string): Promise<VercelProjectDomainInfo | null>;
  addProjectDomain(projectName: string, domain: string): Promise<VercelProjectDomainInfo>;
  createDeploymentAlias(deploymentId: string, domain: string): Promise<VercelDeploymentAliasInfo>;
}

interface DomainProviderDeps {
  apiClient: DomainApiClient;
}

function appendTeamId(url: string, teamId: string | null): string {
  if (!teamId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}teamId=${encodeURIComponent(teamId)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sanitizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

function normalizeBaseDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.+$/, "");
}

export function deriveManagedDomain(
  targetSlug: string,
  payload: Record<string, unknown>,
  baseDomain: string,
): string | null {
  const domain = asRecord(payload.domain);
  const requestedSubdomain =
    typeof domain.subdomain === "string" && domain.subdomain.trim().length > 0
      ? domain.subdomain
      : targetSlug;
  const label = sanitizeLabel(requestedSubdomain);
  const normalizedBaseDomain = normalizeBaseDomain(baseDomain);

  if (!label || !normalizedBaseDomain) return null;
  return `${label}.${normalizedBaseDomain}`;
}

function normalizeManagedCustomDomain(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function resolveVercelDeploymentContext(context: ProviderExecutionContext) {
  const vercelStep = context.priorSteps?.find((step) => step.provider === "vercel");
  const vercelMetadata = asRecord(vercelStep?.metadata);

  return {
    hasPriorStep: Boolean(vercelStep),
    projectName:
      typeof vercelMetadata.projectName === "string" ? vercelMetadata.projectName : null,
    projectId:
      typeof vercelMetadata.projectId === "string" ? vercelMetadata.projectId : null,
    deploymentId:
      typeof vercelMetadata.deploymentId === "string" ? vercelMetadata.deploymentId : null,
    deploymentUrl:
      typeof vercelMetadata.deploymentUrl === "string" ? vercelMetadata.deploymentUrl : null,
  };
}

function parseProjectDomain(payload: Record<string, unknown>): VercelProjectDomainInfo {
  return {
    name: typeof payload.name === "string" ? payload.name : "",
    verified: typeof payload.verified === "boolean" ? payload.verified : null,
  };
}

function parseAlias(payload: Record<string, unknown>): VercelDeploymentAliasInfo {
  return {
    alias:
      typeof payload.alias === "string"
        ? payload.alias
        : typeof payload.uid === "string"
          ? payload.uid
          : "",
    deploymentId:
      typeof payload.deploymentId === "string"
        ? payload.deploymentId
        : typeof payload.deployment === "string"
          ? payload.deployment
          : null,
  };
}

class VercelDomainApiClient implements DomainApiClient {
  constructor(
    private readonly token: string,
    private readonly teamId: string | null,
  ) {}

  async getProjectDomain(projectName: string, domain: string): Promise<VercelProjectDomainInfo | null> {
    const response = await fetch(
      appendTeamId(
        `https://api.vercel.com/v10/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(domain)}`,
        this.teamId,
      ),
      { headers: this.headers() },
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Vercel project domain lookup failed (${response.status}): ${body.slice(0, 400)}`);
    }

    return parseProjectDomain((await response.json()) as Record<string, unknown>);
  }

  async addProjectDomain(projectName: string, domain: string): Promise<VercelProjectDomainInfo> {
    const response = await fetch(
      appendTeamId(
        `https://api.vercel.com/v10/projects/${encodeURIComponent(projectName)}/domains`,
        this.teamId,
      ),
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: domain }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Vercel project domain creation failed (${response.status}): ${body.slice(0, 400)}`);
    }

    return parseProjectDomain((await response.json()) as Record<string, unknown>);
  }

  async createDeploymentAlias(deploymentId: string, domain: string): Promise<VercelDeploymentAliasInfo> {
    const response = await fetch(
      appendTeamId(
        `https://api.vercel.com/v2/deployments/${encodeURIComponent(deploymentId)}/aliases`,
        this.teamId,
      ),
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ alias: domain }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Vercel deployment alias creation failed (${response.status}): ${body.slice(0, 400)}`);
    }

    return parseAlias((await response.json()) as Record<string, unknown>);
  }

  private headers() {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      "User-Agent": "vaen-worker",
    };
  }
}

export class DomainProviderAdapter implements DeploymentProviderAdapter {
  readonly type = "domain" as const;

  private apiToken: string | null;
  private baseDomain: string | null;
  private teamId: string | null;
  private deps: DomainProviderDeps | null;

  constructor(deps?: Partial<DomainProviderDeps>) {
    this.apiToken = process.env.DNS_PROVIDER_TOKEN ?? null;
    this.baseDomain = process.env.VAEN_BASE_DOMAIN ?? null;
    this.teamId = process.env.VERCEL_TEAM_ID ?? null;
    this.deps = this.apiToken
      ? {
          apiClient: deps?.apiClient ?? new VercelDomainApiClient(this.apiToken, this.teamId),
        }
      : deps?.apiClient
        ? { apiClient: deps.apiClient }
        : null;
  }

  isConfigured(): boolean {
    return Boolean(this.apiToken && this.baseDomain);
  }

  async execute(context: ProviderExecutionContext): Promise<ProviderStepResult> {
    const now = new Date().toISOString();

    if (!this.isConfigured() || !this.deps || !this.baseDomain) {
      return {
        provider: "domain",
        status: "not_configured",
        message:
          "Domain provider is not configured. Set DNS_PROVIDER_TOKEN (currently used for Vercel domain-management API access) and VAEN_BASE_DOMAIN.",
        providerReference: null,
        executedAt: now,
        metadata: {
          hasApiToken: Boolean(this.apiToken),
          hasBaseDomain: Boolean(this.baseDomain),
          hasTeamId: Boolean(this.teamId),
        },
      };
    }

    const requestedCustomDomain = normalizeManagedCustomDomain(
      asRecord(context.payload.domain).customDomain,
    );
    const managedDomain = deriveManagedDomain(context.targetSlug, context.payload, this.baseDomain);

    if (!managedDomain) {
      return {
        provider: "domain",
        status: "unsupported",
        message: "Domain provider could not derive a managed subdomain from the validated deployment payload.",
        providerReference: null,
        executedAt: now,
        metadata: {
          baseDomain: this.baseDomain,
          targetSlug: context.targetSlug,
        },
      };
    }

    if (requestedCustomDomain && requestedCustomDomain !== managedDomain) {
      return {
        provider: "domain",
        status: "unsupported",
        message: `Domain provider currently supports managed subdomains under ${this.baseDomain} only. Custom domain ${requestedCustomDomain} is not supported yet.`,
        providerReference: null,
        executedAt: now,
        metadata: {
          baseDomain: this.baseDomain,
          requestedCustomDomain,
          managedDomain,
        },
      };
    }

    const vercelContext = resolveVercelDeploymentContext(context);
    if (!vercelContext.projectName || !vercelContext.deploymentId) {
      return {
        provider: "domain",
        status: "unsupported",
        message: "Domain execution requires a successful Vercel provider step with project and deployment metadata.",
        providerReference: null,
        executedAt: now,
        metadata: {
          hasPriorVercelStep: vercelContext.hasPriorStep,
          projectName: vercelContext.projectName,
          deploymentId: vercelContext.deploymentId,
        },
      };
    }

    try {
      let projectDomain = await this.deps.apiClient.getProjectDomain(
        vercelContext.projectName,
        managedDomain,
      );
      let createdProjectDomain = false;

      if (!projectDomain) {
        projectDomain = await this.deps.apiClient.addProjectDomain(
          vercelContext.projectName,
          managedDomain,
        );
        createdProjectDomain = true;
      }

      const alias = await this.deps.apiClient.createDeploymentAlias(
        vercelContext.deploymentId,
        managedDomain,
      );

      return {
        provider: "domain",
        status: "succeeded",
        message: createdProjectDomain
          ? `Attached ${managedDomain} to Vercel project ${vercelContext.projectName} and aliased the current deployment.`
          : `Updated ${managedDomain} for the current Vercel deployment.`,
        providerReference: `https://${managedDomain}`,
        executedAt: now,
        metadata: {
          baseDomain: this.baseDomain,
          managedDomain,
          requestedCustomDomain,
          projectName: vercelContext.projectName,
          projectId: vercelContext.projectId,
          deploymentId: vercelContext.deploymentId,
          deploymentUrl: vercelContext.deploymentUrl,
          createdProjectDomain,
          alias,
          projectDomain,
          teamId: this.teamId,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        provider: "domain",
        status: "failed",
        message: `Domain provider failed: ${message}`,
        providerReference: null,
        executedAt: now,
        metadata: {
          baseDomain: this.baseDomain,
          managedDomain,
          teamId: this.teamId,
          error: message,
        },
      };
    }
  }
}
