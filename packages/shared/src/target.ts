/**
 * Target resolution — derives all canonical paths for a target (client slug).
 *
 * Every tool in the vaen pipeline (generator, review, worker, portal, deploy)
 * uses this module to agree on where artifacts live.
 */

import { join } from "node:path";

export interface TargetPaths {
  /** Root of the target workspace: generated/<slug>/ */
  workspace: string;
  /** The Next.js site directory: generated/<slug>/site/ */
  site: string;
  /** Artifacts root: generated/<slug>/artifacts/ */
  artifacts: string;
  /** Screenshot output: generated/<slug>/artifacts/screenshots/ */
  screenshots: string;
  /** Build manifest: generated/<slug>/build-manifest.json */
  buildManifest: string;
  /** Claude brief: generated/<slug>/claude-brief.md */
  claudeBrief: string;
  /** Deployment payload: generated/<slug>/deployment-payload.json */
  deploymentPayload: string;
  /** Config injected into site: generated/<slug>/site/config.json */
  siteConfig: string;
}

export interface ResolvedTarget {
  /** The target slug (e.g. "flower-city-painting") */
  slug: string;
  /** Absolute path to the client-request.json input */
  clientRequestPath: string;
  /** All derived workspace paths */
  paths: TargetPaths;
}

export interface ResolveTargetOptions {
  /** Target slug — directory name under generated/ */
  slug: string;
  /** Absolute path to the repository root */
  repoRoot: string;
  /**
   * Override the client-request.json input path.
   * Defaults to generated/<slug>/client-request.json (the canonical export location).
   */
  inputPath?: string;
  /**
   * Override the output workspace directory.
   * Defaults to generated/<slug>/
   */
  outputDir?: string;
}

/**
 * Resolve a target slug into all canonical paths.
 *
 * This is the single source of truth for path layout. Every CLI, app, and
 * service should call this instead of hardcoding paths.
 */
export function resolveTarget(options: ResolveTargetOptions): ResolvedTarget {
  const { slug, repoRoot, inputPath, outputDir } = options;

  const clientRequestPath =
    inputPath ?? join(repoRoot, "generated", slug, "client-request.json");

  const workspace = outputDir ?? join(repoRoot, "generated", slug);

  const paths: TargetPaths = {
    workspace,
    site: join(workspace, "site"),
    artifacts: join(workspace, "artifacts"),
    screenshots: join(workspace, "artifacts", "screenshots"),
    buildManifest: join(workspace, "build-manifest.json"),
    claudeBrief: join(workspace, "claude-brief.md"),
    deploymentPayload: join(workspace, "deployment-payload.json"),
    siteConfig: join(workspace, "site", "config.json"),
  };

  return { slug, clientRequestPath, paths };
}

/**
 * Standard artifact filenames within a workspace.
 * Useful for tools that need to list or validate artifacts without full resolution.
 */
export const WORKSPACE_FILES = {
  buildManifest: "build-manifest.json",
  claudeBrief: "claude-brief.md",
  deploymentPayload: "deployment-payload.json",
  siteDir: "site",
  artifactsDir: "artifacts",
  screenshotsDir: "artifacts/screenshots",
} as const;
