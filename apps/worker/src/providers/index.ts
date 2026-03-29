import type {
  DeploymentProviderAdapter,
  ProviderExecutionContext,
  ProviderExecutionResult,
  ProviderStepResult,
} from "@vaen/shared";
import { PROVIDER_EXECUTION_ORDER } from "@vaen/shared";
import { GitHubProviderAdapter } from "./github.js";
import { VercelProviderAdapter } from "./vercel.js";
import { DomainProviderAdapter } from "./domain.js";

/**
 * Create all registered provider adapters.
 * Each adapter reads its own config from environment variables.
 */
export function createProviderAdapters(): DeploymentProviderAdapter[] {
  return [
    new GitHubProviderAdapter(),
    new VercelProviderAdapter(),
    new DomainProviderAdapter(),
  ];
}

/**
 * Execute all provider adapters in order for a validated deployment.
 *
 * Behavior:
 * - Runs adapters in PROVIDER_EXECUTION_ORDER (github → vercel → domain)
 * - If a required adapter (github, vercel) fails, subsequent adapters are skipped
 * - If no adapters are configured, returns { status: "not_configured" }
 * - Never fakes success: an unconfigured adapter explicitly says so
 */
export async function executeProviderAdapters(
  context: ProviderExecutionContext,
  adapters?: DeploymentProviderAdapter[],
): Promise<ProviderExecutionResult> {
  const allAdapters = adapters ?? createProviderAdapters();
  const adapterMap = new Map(allAdapters.map((a) => [a.type, a]));
  const steps: ProviderStepResult[] = [];
  let aborted = false;

  for (const providerType of PROVIDER_EXECUTION_ORDER) {
    const adapter = adapterMap.get(providerType);
    if (!adapter) continue;

    if (aborted) {
      steps.push({
        provider: providerType,
        status: "skipped",
        message: "Skipped due to earlier provider failure.",
        providerReference: null,
        executedAt: new Date().toISOString(),
        metadata: {},
      });
      continue;
    }

    const result = await adapter.execute(context);
    steps.push(result);

    // If a configured provider failed, abort remaining steps
    if (result.status === "failed") {
      aborted = true;
    }
  }

  const actionableSteps = steps.filter((s) => s.status !== "not_configured");
  const allNotConfigured = actionableSteps.length === 0;
  const anyFailed = steps.some((s) => s.status === "failed");
  const anyNotImplemented = steps.some((s) => s.status === "not_implemented");
  const anyUnsupported = steps.some((s) => s.status === "unsupported");
  const allSucceeded = actionableSteps.length > 0 && actionableSteps.every((s) => s.status === "succeeded");

  let overallStatus: ProviderExecutionResult["status"];
  let summary: string;

  if (allNotConfigured) {
    overallStatus = "not_configured";
    summary = "No deployment providers are configured. Deployment payload is validated and ready for provider automation.";
  } else if (anyNotImplemented) {
    overallStatus = "not_implemented";
    const pendingNames = steps.filter((s) => s.status === "not_implemented").map((s) => s.provider);
    summary = `Provider adapters are configured but not implemented yet: ${pendingNames.join(", ")}.`;
  } else if (anyUnsupported) {
    overallStatus = "unsupported";
    const unsupportedNames = steps.filter((s) => s.status === "unsupported").map((s) => s.provider);
    summary = `Provider execution is unsupported for: ${unsupportedNames.join(", ")}.`;
  } else if (allSucceeded) {
    overallStatus = "succeeded";
    summary = `All ${actionableSteps.length} actionable provider(s) completed successfully.`;
  } else if (anyFailed) {
    overallStatus = "failed";
    const failedNames = steps.filter((s) => s.status === "failed").map((s) => s.provider);
    summary = `Provider execution failed: ${failedNames.join(", ")}.`;
  } else {
    overallStatus = "not_configured";
    summary = "Provider execution completed with unconfigured providers.";
  }

  return { status: overallStatus, steps, summary };
}
