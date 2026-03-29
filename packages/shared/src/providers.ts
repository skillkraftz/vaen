/**
 * Deployment provider adapter interfaces.
 *
 * A provider adapter bridges a validated deployment_run to an actual hosting
 * platform (GitHub repo push, Vercel project, custom domain wiring).
 *
 * Each adapter is independently implementable and reports a structured result
 * rather than faking success. An adapter that is not yet configured returns
 * { status: "not_configured" } — never a fake success.
 */

// ── Provider types ──────────────────────────────────────────────────

export type DeploymentProviderType = "github" | "vercel" | "domain";

/** Human-readable labels. */
export const PROVIDER_LABELS: Record<DeploymentProviderType, string> = {
  github: "GitHub Repository",
  vercel: "Vercel Deployment",
  domain: "Domain Configuration",
};

// ── Provider result model ───────────────────────────────────────────

export type ProviderResultStatus =
  | "not_configured"
  | "not_implemented"
  | "unsupported"
  | "succeeded"
  | "failed"
  | "skipped";

export interface ProviderStepResult {
  /** Which provider produced this result. */
  provider: DeploymentProviderType;
  /** Outcome of the provider step. */
  status: ProviderResultStatus;
  /** Human-readable message for the operator. */
  message: string;
  /** Provider-specific reference (e.g. GitHub repo URL, Vercel deployment ID). */
  providerReference: string | null;
  /** ISO timestamp of execution. */
  executedAt: string;
  /** Arbitrary provider-specific metadata. */
  metadata: Record<string, unknown>;
}

export interface ProviderExecutionResult {
  /** Overall outcome. Succeeds only if all required steps succeed. */
  status: ProviderResultStatus;
  /** Per-provider step results. */
  steps: ProviderStepResult[];
  /** Human-readable summary of the entire execution. */
  summary: string;
}

// ── Provider adapter interface ──────────────────────────────────────

export interface DeploymentProviderAdapter {
  /** Provider type identifier. */
  readonly type: DeploymentProviderType;

  /**
   * Whether this adapter has the configuration it needs to execute.
   * An unconfigured adapter will produce a { status: "not_configured" } result.
   */
  isConfigured(): boolean;

  /**
   * Execute the provider step for a validated deployment.
   *
   * @param context - the validated deployment context
   * @returns a structured result, never throws
   */
  execute(context: ProviderExecutionContext): Promise<ProviderStepResult>;
}

export interface ProviderExecutionContext {
  /** The deployment run being executed. */
  deploymentRunId: string;
  /** Project identifier. */
  projectId: string;
  /** Target slug (used for repo names, subdomain, etc.). */
  targetSlug: string;
  /** The validated deployment payload. */
  payload: Record<string, unknown>;
  /** The deployment payload summary from validation. */
  payloadSummary: Record<string, unknown>;
}

// ── Provider registry ───────────────────────────────────────────────

/** Default ordered execution sequence. */
export const PROVIDER_EXECUTION_ORDER: DeploymentProviderType[] = [
  "github",
  "vercel",
  "domain",
];

/**
 * Check if a set of provider results represents a fully successful execution.
 */
export function isProviderExecutionSuccessful(result: ProviderExecutionResult): boolean {
  return result.status === "succeeded";
}

/**
 * Check if any provider is configured and ready to execute.
 */
export function hasAnyConfiguredProvider(adapters: DeploymentProviderAdapter[]): boolean {
  return adapters.some((adapter) => adapter.isConfigured());
}

/**
 * Summarize provider execution for display.
 */
export function summarizeProviderExecution(result: ProviderExecutionResult): string {
  if (result.steps.length === 0) return "No provider steps executed.";

  const actionable = result.steps.filter((s) => s.status !== "not_configured");
  if (actionable.length === 0) {
    return "No providers are configured. Configure GitHub, Vercel, or domain settings to enable deployment.";
  }

  const succeeded = actionable.filter((s) => s.status === "succeeded").length;
  const failed = actionable.filter((s) => s.status === "failed").length;
  const notImplemented = actionable.filter((s) => s.status === "not_implemented").length;
  const unsupported = actionable.filter((s) => s.status === "unsupported").length;

  return [
    `${succeeded} succeeded`,
    `${failed} failed`,
    notImplemented > 0 ? `${notImplemented} not implemented` : null,
    unsupported > 0 ? `${unsupported} unsupported` : null,
    `out of ${actionable.length} actionable provider(s)`,
  ]
    .filter(Boolean)
    .join(", ");
}
