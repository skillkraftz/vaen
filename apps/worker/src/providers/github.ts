import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type {
  DeploymentProviderAdapter,
  ProviderExecutionContext,
  ProviderStepResult,
} from "@vaen/shared";
import { spawn } from "node:child_process";

export interface GitHubRepositoryInfo {
  name: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  existed: boolean;
}

export interface GitHubApiClient {
  getRepository(org: string, repo: string): Promise<GitHubRepositoryInfo | null>;
  createRepository(org: string, repo: string, description: string): Promise<GitHubRepositoryInfo>;
}

export interface PushSiteSourceOptions {
  siteDir: string;
  remoteUrl: string;
  defaultBranch: string;
  commitMessage: string;
  authorName: string;
  authorEmail: string;
}

export interface PushSiteSourceResult {
  commitSha: string;
  pushedFilesCount: number;
}

interface GitHubProviderDeps {
  apiClient: GitHubApiClient;
  pushSiteSource: (options: PushSiteSourceOptions) => Promise<PushSiteSourceResult>;
  resolveSiteDir: (context: ProviderExecutionContext) => string | null;
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

class GitHubRestApiClient implements GitHubApiClient {
  constructor(private readonly token: string) {}

  async getRepository(org: string, repo: string): Promise<GitHubRepositoryInfo | null> {
    const response = await fetch(`https://api.github.com/repos/${org}/${repo}`, {
      headers: this.headers(),
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`GitHub repository lookup failed (${response.status}).`);
    }

    return parseGitHubRepository((await response.json()) as Record<string, unknown>, true);
  }

  async createRepository(org: string, repo: string, description: string): Promise<GitHubRepositoryInfo> {
    const response = await fetch(`https://api.github.com/orgs/${org}/repos`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: repo,
        description,
        private: true,
        auto_init: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub repository creation failed (${response.status}): ${body.slice(0, 400)}`);
    }

    return parseGitHubRepository((await response.json()) as Record<string, unknown>, false);
  }

  private headers() {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "User-Agent": "vaen-worker",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }
}

function parseGitHubRepository(
  payload: Record<string, unknown>,
  existed: boolean,
): GitHubRepositoryInfo {
  const name = typeof payload.name === "string" ? payload.name : "unknown";
  const htmlUrl = typeof payload.html_url === "string" ? payload.html_url : "";
  const cloneUrl = typeof payload.clone_url === "string" ? payload.clone_url : "";
  const defaultBranch =
    typeof payload.default_branch === "string" && payload.default_branch.length > 0
      ? payload.default_branch
      : "main";

  return {
    name,
    htmlUrl,
    cloneUrl,
    defaultBranch,
    existed,
  };
}

function shouldCopySitePath(srcPath: string): boolean {
  const name = basename(srcPath);
  return name !== "node_modules" && name !== ".next" && name !== "dist";
}

async function copySiteSourceToTempRepo(siteDir: string): Promise<string> {
  const worktree = await mkdtemp(join(tmpdir(), "vaen-github-provider-"));
  const entries = await readdir(siteDir);

  for (const entry of entries) {
    const source = join(siteDir, entry);
    if (!shouldCopySitePath(source)) continue;
    await cp(source, join(worktree, entry), {
      recursive: true,
      force: true,
      filter: shouldCopySitePath,
    });
  }

  return worktree;
}

export async function pushSiteSourceToGitHubRepo(
  options: PushSiteSourceOptions,
): Promise<PushSiteSourceResult> {
  const worktree = await copySiteSourceToTempRepo(options.siteDir);

  try {
    const remoteBranch = options.defaultBranch || "main";
    const addResult = await runCommand("git", ["init"], worktree);
    if (addResult.exitCode !== 0) {
      throw new Error(`git init failed: ${(addResult.stderr || addResult.stdout).trim()}`);
    }

    await runCommand("git", ["checkout", "-B", remoteBranch], worktree);
    await runCommand("git", ["config", "user.name", options.authorName], worktree);
    await runCommand("git", ["config", "user.email", options.authorEmail], worktree);

    const gitignorePath = join(worktree, ".gitignore");
    let gitignore = "";
    try {
      gitignore = await readFile(gitignorePath, "utf-8");
    } catch {
      gitignore = "";
    }
    const requiredIgnores = [".next", "node_modules", "dist"];
    const missingIgnores = requiredIgnores.filter((entry) => !gitignore.includes(entry));
    if (missingIgnores.length > 0) {
      const nextContents = `${gitignore}${gitignore.endsWith("\n") || gitignore.length === 0 ? "" : "\n"}${missingIgnores.join("\n")}\n`;
      await writeFile(gitignorePath, nextContents, "utf-8");
    }

    const addAll = await runCommand("git", ["add", "-A"], worktree);
    if (addAll.exitCode !== 0) {
      throw new Error(`git add failed: ${(addAll.stderr || addAll.stdout).trim()}`);
    }

    const commit = await runCommand("git", ["commit", "-m", options.commitMessage], worktree);
    if (commit.exitCode !== 0) {
      throw new Error(`git commit failed: ${(commit.stderr || commit.stdout).trim()}`);
    }

    const remote = await runCommand("git", ["remote", "add", "origin", options.remoteUrl], worktree);
    if (remote.exitCode !== 0) {
      throw new Error(`git remote add failed: ${(remote.stderr || remote.stdout).trim()}`);
    }

    const push = await runCommand("git", ["push", "--force", "origin", `${remoteBranch}:${remoteBranch}`], worktree);
    if (push.exitCode !== 0) {
      throw new Error(`git push failed: ${(push.stderr || push.stdout).trim()}`);
    }

    const commitSha = (await runCommand("git", ["rev-parse", "HEAD"], worktree)).stdout.trim();
    const trackedFiles = (await runCommand("git", ["ls-files"], worktree)).stdout
      .split("\n")
      .filter(Boolean);

    return {
      commitSha,
      pushedFilesCount: trackedFiles.length,
    };
  } finally {
    await rm(worktree, { recursive: true, force: true });
  }
}

export function deriveGitHubRepoName(targetSlug: string): string {
  const slug = targetSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const prefixed = slug.startsWith("vaen-") ? slug : `vaen-${slug}`;
  return prefixed.slice(0, 100).replace(/-+$/g, "");
}

export async function ensureGitHubRepository(
  apiClient: GitHubApiClient,
  org: string,
  repoName: string,
  targetSlug: string,
): Promise<GitHubRepositoryInfo> {
  const existing = await apiClient.getRepository(org, repoName);
  if (existing) return existing;

  return apiClient.createRepository(
    org,
    repoName,
    `Vaen deployment source for ${targetSlug}`,
  );
}

export function resolveGitHubSiteDir(
  context: ProviderExecutionContext,
): string | null {
  if (context.payload.framework !== "nextjs") return null;
  const sitePath = typeof context.payload.sitePath === "string" ? context.payload.sitePath : null;
  if (!sitePath || sitePath.length === 0) return null;
  if (isAbsolute(sitePath)) return sitePath;

  const providerDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(providerDir, "..", "..", "..", "..");
  return resolve(repoRoot, sitePath);
}

export function getGitHubRemoteUrl(org: string, repoName: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${org}/${repoName}.git`;
}

/**
 * GitHub provider adapter.
 *
 * Real behavior:
 * 1. Create or reuse a GitHub repository for the target slug
 * 2. Push the generated site source to the repository
 * 3. Return the repo URL as provider reference
 */
export class GitHubProviderAdapter implements DeploymentProviderAdapter {
  readonly type = "github" as const;

  private token: string | null;
  private org: string | null;
  private deps: GitHubProviderDeps | null;

  constructor(deps?: Partial<GitHubProviderDeps>) {
    this.token = process.env.GITHUB_TOKEN ?? null;
    this.org = process.env.GITHUB_ORG ?? null;
    this.deps = this.token
      ? {
          apiClient: deps?.apiClient ?? new GitHubRestApiClient(this.token),
          pushSiteSource: deps?.pushSiteSource ?? pushSiteSourceToGitHubRepo,
          resolveSiteDir: deps?.resolveSiteDir ?? resolveGitHubSiteDir,
        }
      : deps?.apiClient && deps?.pushSiteSource && deps?.resolveSiteDir
        ? {
            apiClient: deps.apiClient,
            pushSiteSource: deps.pushSiteSource,
            resolveSiteDir: deps.resolveSiteDir,
          }
        : null;
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.org);
  }

  async execute(context: ProviderExecutionContext): Promise<ProviderStepResult> {
    const now = new Date().toISOString();

    if (!this.isConfigured() || !this.deps || !this.org || !this.token) {
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

    const siteDir = this.deps.resolveSiteDir(context);
    if (!siteDir) {
      return {
        provider: "github",
        status: "unsupported",
        message: "GitHub provider only supports validated Next.js deployment payloads with a sitePath.",
        providerReference: null,
        executedAt: now,
        metadata: {
          framework: context.payload.framework ?? null,
          hasSitePath: typeof context.payload.sitePath === "string",
        },
      };
    }

    try {
      const repoName = deriveGitHubRepoName(context.targetSlug);
      const repository = await ensureGitHubRepository(
        this.deps.apiClient,
        this.org,
        repoName,
        context.targetSlug,
      );
      const pushResult = await this.deps.pushSiteSource({
        siteDir,
        remoteUrl: getGitHubRemoteUrl(this.org, repoName, this.token),
        defaultBranch: repository.defaultBranch,
        commitMessage: `Deploy ${context.targetSlug} from deployment run ${context.deploymentRunId}`,
        authorName: "Vaen Deploy Bot",
        authorEmail: "support@skillkraftz.com",
      });

      return {
        provider: "github",
        status: "succeeded",
        message: repository.existed
          ? `Pushed generated site source to existing GitHub repository ${this.org}/${repository.name}.`
          : `Created GitHub repository ${this.org}/${repository.name} and pushed generated site source.`,
        providerReference: repository.htmlUrl,
        executedAt: now,
        metadata: {
          org: this.org,
          repoName: repository.name,
          repoUrl: repository.htmlUrl,
          cloneUrl: repository.cloneUrl,
          defaultBranch: repository.defaultBranch,
          existed: repository.existed,
          commitSha: pushResult.commitSha,
          pushedFilesCount: pushResult.pushedFilesCount,
          siteDir,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        provider: "github",
        status: "failed",
        message: `GitHub deployment failed: ${message}`,
        providerReference: null,
        executedAt: now,
        metadata: {
          org: this.org,
          targetSlug: context.targetSlug,
          error: message,
        },
      };
    }
  }
}
