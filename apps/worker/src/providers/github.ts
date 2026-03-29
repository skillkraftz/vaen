import type {
  DeploymentProviderAdapter,
  ProviderExecutionContext,
  ProviderStepResult,
} from "@vaen/shared";

/**
 * GitHub provider adapter.
 *
 * When configured, this will:
 * 1. Create or update a GitHub repository for the target slug
 * 2. Push the generated site source to the repository
 * 3. Return the repo URL as provider reference
 *
 * Currently: returns not_configured. The adapter boundary exists so that
 * real GitHub API integration has an obvious place to plug in.
 */
export class GitHubProviderAdapter implements DeploymentProviderAdapter {
  readonly type = "github" as const;

  private token: string | null;
  private org: string | null;

  constructor() {
    this.token = process.env.GITHUB_TOKEN ?? null;
    this.org = process.env.GITHUB_ORG ?? null;
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.org);
  }

  async execute(context: ProviderExecutionContext): Promise<ProviderStepResult> {
    const now = new Date().toISOString();

    if (!this.isConfigured()) {
      return {
        provider: "github",
        status: "not_configured",
        message: "GitHub provider is not configured. Set GITHUB_TOKEN and GITHUB_ORG environment variables.",
        providerReference: null,
        executedAt: now,
        metadata: {
          hasToken: Boolean(this.token),
          hasOrg: Boolean(this.org),
        },
      };
    }

    // Real implementation will go here:
    // 1. Octokit client from this.token
    // 2. Create repo: POST /orgs/{org}/repos or check existence
    // 3. Push site source from generated/<slug>/site/
    // 4. Return repo URL as providerReference
    //
    // For now, return not_configured to avoid faking success.
    return {
      provider: "github",
      status: "not_configured",
      message: "GitHub provider adapter is registered but execution is not yet implemented.",
      providerReference: null,
      executedAt: now,
      metadata: {
        org: this.org,
        targetSlug: context.targetSlug,
        implementation: "pending",
      },
    };
  }
}
