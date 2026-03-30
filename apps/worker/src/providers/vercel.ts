import type {
  DeploymentProviderAdapter,
  ProviderExecutionContext,
  ProviderStepResult,
} from "@vaen/shared";
import { deriveGitHubRepoName } from "./github.js";

export interface VercelProjectInfo {
  id: string;
  name: string;
  link: {
    type: string | null;
    org: string | null;
    repo: string | null;
    productionBranch: string | null;
  } | null;
  framework: string | null;
}

export interface VercelDeploymentInfo {
  id: string;
  url: string | null;
  inspectorUrl: string | null;
  status: string | null;
}

export interface VercelApiClient {
  getProject(name: string): Promise<VercelProjectInfo | null>;
  createProject(input: {
    name: string;
    repo: string;
    org: string;
    productionBranch: string;
    framework: string;
    buildCommand: string | null;
    outputDirectory: string | null;
    rootDirectory: string | null;
    nodeVersion: string | null;
    installCommand: string | null;
  }): Promise<VercelProjectInfo>;
  createDeployment(input: {
    projectName: string;
    repo: string;
    org: string;
    ref: string;
    sha: string | null;
    target: "preview" | "production";
    projectSettings: {
      framework: string;
      buildCommand: string | null;
      outputDirectory: string | null;
      rootDirectory: string | null;
      nodeVersion: string | null;
      installCommand: string | null;
    };
  }): Promise<VercelDeploymentInfo>;
}

interface VercelProviderDeps {
  apiClient: VercelApiClient;
}

function appendTeamId(url: string, teamId: string | null): string {
  if (!teamId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}teamId=${encodeURIComponent(teamId)}`;
}

function normalizeVercelUrl(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseVercelProject(payload: Record<string, unknown>): VercelProjectInfo {
  const link = asRecord(payload.link);
  return {
    id: typeof payload.id === "string" ? payload.id : "",
    name: typeof payload.name === "string" ? payload.name : "",
    link: Object.keys(link).length
      ? {
          type: typeof link.type === "string" ? link.type : null,
          org: typeof link.org === "string" ? link.org : null,
          repo: typeof link.repo === "string" ? link.repo : null,
          productionBranch:
            typeof link.productionBranch === "string" ? link.productionBranch : null,
        }
      : null,
    framework: typeof payload.framework === "string" ? payload.framework : null,
  };
}

function parseVercelDeployment(payload: Record<string, unknown>): VercelDeploymentInfo {
  return {
    id: typeof payload.id === "string" ? payload.id : "",
    url: normalizeVercelUrl(typeof payload.url === "string" ? payload.url : null),
    inspectorUrl: normalizeVercelUrl(
      typeof payload.inspectorUrl === "string" ? payload.inspectorUrl : null,
    ),
    status: typeof payload.status === "string" ? payload.status : null,
  };
}

class VercelRestApiClient implements VercelApiClient {
  constructor(
    private readonly token: string,
    private readonly teamId: string | null,
  ) {}

  async getProject(name: string): Promise<VercelProjectInfo | null> {
    const response = await fetch(
      appendTeamId(`https://api.vercel.com/v9/projects/${encodeURIComponent(name)}`, this.teamId),
      {
        headers: this.headers(),
      },
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Vercel project lookup failed (${response.status}).`);
    }

    return parseVercelProject((await response.json()) as Record<string, unknown>);
  }

  async createProject(input: {
    name: string;
    repo: string;
    org: string;
    productionBranch: string;
    framework: string;
    buildCommand: string | null;
    outputDirectory: string | null;
    rootDirectory: string | null;
    nodeVersion: string | null;
    installCommand: string | null;
  }): Promise<VercelProjectInfo> {
    const response = await fetch(
      appendTeamId("https://api.vercel.com/v10/projects", this.teamId),
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: input.name,
          framework: input.framework,
          buildCommand: input.buildCommand ?? undefined,
          outputDirectory: input.outputDirectory ?? undefined,
          rootDirectory: input.rootDirectory ?? undefined,
          nodeVersion: input.nodeVersion ?? undefined,
          installCommand: input.installCommand ?? undefined,
          gitRepository: {
            type: "github",
            repo: input.repo,
            org: input.org,
            productionBranch: input.productionBranch,
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Vercel project creation failed (${response.status}): ${body.slice(0, 400)}`);
    }

    return parseVercelProject((await response.json()) as Record<string, unknown>);
  }

  async createDeployment(input: {
    projectName: string;
    repo: string;
    org: string;
    ref: string;
    sha: string | null;
    target: "preview" | "production";
    projectSettings: {
      framework: string;
      buildCommand: string | null;
      outputDirectory: string | null;
      rootDirectory: string | null;
      nodeVersion: string | null;
      installCommand: string | null;
    };
  }): Promise<VercelDeploymentInfo> {
    const response = await fetch(
      appendTeamId("https://api.vercel.com/v13/deployments", this.teamId),
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: input.projectName,
          project: input.projectName,
          target: input.target === "production" ? "production" : undefined,
          gitSource: {
            type: "github",
            repo: input.repo,
            org: input.org,
            ref: input.ref,
            sha: input.sha ?? undefined,
          },
          projectSettings: {
            framework: input.projectSettings.framework,
            buildCommand: input.projectSettings.buildCommand ?? undefined,
            outputDirectory: input.projectSettings.outputDirectory ?? undefined,
            rootDirectory: input.projectSettings.rootDirectory ?? undefined,
            nodeVersion: input.projectSettings.nodeVersion ?? undefined,
            installCommand: input.projectSettings.installCommand ?? undefined,
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Vercel deployment creation failed (${response.status}): ${body.slice(0, 400)}`);
    }

    return parseVercelDeployment((await response.json()) as Record<string, unknown>);
  }

  private headers() {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      "User-Agent": "vaen-worker",
    };
  }
}

interface GitHubLinkInfo {
  org: string;
  repoName: string;
  defaultBranch: string;
  commitSha: string | null;
  repoUrl: string | null;
}

function resolveGitHubLinkInfo(context: ProviderExecutionContext): GitHubLinkInfo | null {
  const githubStep = context.priorSteps?.find((step) => step.provider === "github");
  const githubMetadata = asRecord(githubStep?.metadata);
  const repoName =
    typeof githubMetadata.repoName === "string"
      ? githubMetadata.repoName
      : deriveGitHubRepoName(context.targetSlug);
  const org =
    typeof githubMetadata.org === "string"
      ? githubMetadata.org
      : process.env.GITHUB_ORG ?? null;

  if (!org) return null;

  return {
    org,
    repoName,
    defaultBranch:
      typeof githubMetadata.defaultBranch === "string" ? githubMetadata.defaultBranch : "main",
    commitSha: typeof githubMetadata.commitSha === "string" ? githubMetadata.commitSha : null,
    repoUrl:
      typeof githubMetadata.repoUrl === "string"
        ? githubMetadata.repoUrl
        : githubStep?.providerReference ?? null,
  };
}

function getVercelProjectName(targetSlug: string): string {
  return targetSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

export class VercelProviderAdapter implements DeploymentProviderAdapter {
  readonly type = "vercel" as const;

  private token: string | null;
  private teamId: string | null;
  private deps: VercelProviderDeps | null;

  constructor(deps?: Partial<VercelProviderDeps>) {
    this.token = process.env.VERCEL_TOKEN ?? null;
    this.teamId = process.env.VERCEL_TEAM_ID ?? null;
    this.deps = this.token
      ? {
          apiClient: deps?.apiClient ?? new VercelRestApiClient(this.token, this.teamId),
        }
      : deps?.apiClient
        ? { apiClient: deps.apiClient }
        : null;
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  async execute(context: ProviderExecutionContext): Promise<ProviderStepResult> {
    const now = new Date().toISOString();

    if (!this.isConfigured() || !this.deps) {
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

    if (context.payload.framework !== "nextjs") {
      return {
        provider: "vercel",
        status: "unsupported",
        message: "Vercel provider currently supports validated Next.js deployment payloads only.",
        providerReference: null,
        executedAt: now,
        metadata: {
          framework: context.payload.framework ?? null,
        },
      };
    }

    const githubLink = resolveGitHubLinkInfo(context);
    if (!githubLink) {
      return {
        provider: "vercel",
        status: "unsupported",
        message: "Vercel execution requires a GitHub repository reference from the GitHub provider step or GITHUB_ORG fallback.",
        providerReference: null,
        executedAt: now,
        metadata: {
          hasPriorGitHubStep: Boolean(context.priorSteps?.some((step) => step.provider === "github")),
          hasGitHubOrg: Boolean(process.env.GITHUB_ORG),
        },
      };
    }

    const projectName = getVercelProjectName(context.targetSlug);
    const buildCommand =
      typeof context.payload.buildCommand === "string" ? context.payload.buildCommand : null;
    const outputDirectory =
      typeof context.payload.outputDir === "string" ? context.payload.outputDir : null;
    const rootDirectory = null;
    const nodeVersion =
      typeof context.payload.nodeVersion === "string" ? context.payload.nodeVersion : null;

    try {
      let project = await this.deps.apiClient.getProject(projectName);
      let created = false;

      if (!project) {
        project = await this.deps.apiClient.createProject({
          name: projectName,
          repo: githubLink.repoName,
          org: githubLink.org,
          productionBranch: githubLink.defaultBranch,
          framework: "nextjs",
          buildCommand,
          outputDirectory,
          rootDirectory,
          nodeVersion,
          installCommand: "pnpm install",
        });
        created = true;
      }

      if (
        project.link &&
        project.link.type === "github" &&
        project.link.repo &&
        project.link.repo !== githubLink.repoName
      ) {
        return {
          provider: "vercel",
          status: "unsupported",
          message: `Existing Vercel project ${project.name} is linked to GitHub repo ${project.link.repo}, not ${githubLink.repoName}.`,
          providerReference: null,
          executedAt: now,
          metadata: {
            projectId: project.id,
            projectName: project.name,
            linkedRepo: project.link.repo,
            expectedRepo: githubLink.repoName,
          },
        };
      }

      if (
        project.link &&
        project.link.type !== "github"
      ) {
        return {
          provider: "vercel",
          status: "unsupported",
          message: `Existing Vercel project ${project.name} is linked to unsupported provider type ${project.link.type}.`,
          providerReference: null,
          executedAt: now,
          metadata: {
            projectId: project.id,
            projectName: project.name,
            linkType: project.link.type,
          },
        };
      }

      const deployment = await this.deps.apiClient.createDeployment({
        projectName,
        repo: githubLink.repoName,
        org: githubLink.org,
        ref: githubLink.defaultBranch,
        sha: githubLink.commitSha,
        target: "preview",
        projectSettings: {
          framework: "nextjs",
          buildCommand,
          outputDirectory,
          rootDirectory,
          nodeVersion,
          installCommand: "pnpm install",
        },
      });

      return {
        provider: "vercel",
        status: "succeeded",
        message: created
          ? `Created Vercel project ${project.name} and triggered a preview deployment.`
          : `Triggered a preview deployment for existing Vercel project ${project.name}.`,
        providerReference: normalizeVercelUrl(deployment.url) ?? normalizeVercelUrl(deployment.inspectorUrl),
        executedAt: now,
        metadata: {
          projectId: project.id,
          projectName: project.name,
          projectCreated: created,
          teamId: this.teamId,
          linkedRepo: githubLink.repoName,
          linkedOrg: githubLink.org,
          githubRepoUrl: githubLink.repoUrl,
          deploymentId: deployment.id,
          deploymentUrl: normalizeVercelUrl(deployment.url),
          inspectorUrl: normalizeVercelUrl(deployment.inspectorUrl),
          deploymentStatus: deployment.status,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        provider: "vercel",
        status: "failed",
        message: `Vercel deployment failed: ${message}`,
        providerReference: null,
        executedAt: now,
        metadata: {
          teamId: this.teamId,
          targetSlug: context.targetSlug,
          error: message,
        },
      };
    }
  }
}
