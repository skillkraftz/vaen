import type {
  DeploymentProviderAdapter,
  ProviderExecutionContext,
  ProviderStepResult,
} from "@vaen/shared";

/**
 * Vercel provider adapter.
 *
 * When configured, this will:
 * 1. Create or link a Vercel project for the target slug
 * 2. Trigger a deployment from the GitHub repository
 * 3. Wait for deployment to complete or record the deployment URL
 * 4. Return the Vercel deployment URL as provider reference
 *
 * Currently: returns not_configured. The adapter boundary exists so that
 * real Vercel API integration has an obvious place to plug in.
 */
export class VercelProviderAdapter implements DeploymentProviderAdapter {
  readonly type = "vercel" as const;

  private token: string | null;
  private teamId: string | null;

  constructor() {
    this.token = process.env.VERCEL_TOKEN ?? null;
    this.teamId = process.env.VERCEL_TEAM_ID ?? null;
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  async execute(context: ProviderExecutionContext): Promise<ProviderStepResult> {
    const now = new Date().toISOString();

    if (!this.isConfigured()) {
      return {
        provider: "vercel",
        status: "not_configured",
        message: "Vercel provider is not configured. Set VERCEL_TOKEN environment variable.",
        providerReference: null,
        executedAt: now,
        metadata: {
          hasToken: Boolean(this.token),
          hasTeamId: Boolean(this.teamId),
        },
      };
    }

    // Real implementation will go here:
    // 1. Vercel API client from this.token
    // 2. Create project: POST /v10/projects or check existence
    // 3. Link to GitHub repo from previous step
    // 4. Trigger deployment or wait for auto-deploy
    // 5. Return deployment URL as providerReference
    //
    // For now, return not_configured to avoid faking success.
    return {
      provider: "vercel",
      status: "not_configured",
      message: "Vercel provider adapter is registered but execution is not yet implemented.",
      providerReference: null,
      executedAt: now,
      metadata: {
        teamId: this.teamId,
        targetSlug: context.targetSlug,
        implementation: "pending",
      },
    };
  }
}
