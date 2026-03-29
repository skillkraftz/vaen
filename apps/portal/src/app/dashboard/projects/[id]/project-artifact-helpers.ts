import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactStatus, ReviewManifest } from "./project-review-types";

export function getPortalRepoRoot() {
  return join(process.cwd(), "../..");
}

export async function readArtifactStatusFromDisk(slug: string): Promise<ArtifactStatus> {
  const repoRoot = getPortalRepoRoot();
  const result: ArtifactStatus = {
    hasClientRequest: false,
    hasWorkspace: false,
    hasSiteBuild: false,
    hasBuildManifest: false,
    hasClaudeBrief: false,
    hasPromptTxt: false,
    hasDeploymentPayload: false,
    hasValidationReport: false,
    hasScreenshots: false,
    screenshotCount: 0,
    screenshotNames: [],
    screenshotManifest: null,
  };

  try {
    await access(join(repoRoot, "generated", slug, "client-request.json"));
    result.hasClientRequest = true;
  } catch {
    // noop
  }

  try {
    await access(join(repoRoot, "generated", slug, "site", "config.json"));
    result.hasWorkspace = true;
  } catch {
    // noop
  }

  try {
    await access(join(repoRoot, "generated", slug, "site", ".next"));
    result.hasSiteBuild = true;
  } catch {
    // noop
  }

  try {
    await access(join(repoRoot, "generated", slug, "build-manifest.json"));
    result.hasBuildManifest = true;
  } catch {
    // noop
  }

  try {
    await access(join(repoRoot, "generated", slug, "claude-brief.md"));
    result.hasClaudeBrief = true;
  } catch {
    // noop
  }

  try {
    await access(join(repoRoot, "generated", slug, "artifacts", "prompt.txt"));
    result.hasPromptTxt = true;
  } catch {
    // noop
  }

  try {
    await access(join(repoRoot, "generated", slug, "deployment-payload.json"));
    result.hasDeploymentPayload = true;
  } catch {
    // noop
  }

  try {
    await access(join(repoRoot, "generated", slug, "artifacts", "validation.json"));
    result.hasValidationReport = true;
  } catch {
    // noop
  }

  try {
    const screenshotsDir = join(repoRoot, "generated", slug, "artifacts", "screenshots");
    const files = await readdir(screenshotsDir);
    const pngs = files.filter((file) => file.endsWith(".png")).sort();
    result.hasScreenshots = pngs.length > 0;
    result.screenshotCount = pngs.length;
    result.screenshotNames = pngs;
  } catch {
    // noop
  }

  try {
    const manifestPath = join(
      repoRoot,
      "generated",
      slug,
      "artifacts",
      "screenshots",
      "manifest.json",
    );
    const manifestRaw = await readFile(manifestPath, "utf-8");
    result.screenshotManifest = JSON.parse(manifestRaw) as ReviewManifest;
  } catch {
    // noop
  }

  return result;
}

export async function readLocalScreenshotDataUrl(
  slug: string,
  filename: string,
): Promise<{ error?: string; dataUrl?: string }> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe.endsWith(".png")) {
    return { error: "Invalid filename" };
  }

  const repoRoot = getPortalRepoRoot();
  const filepath = join(repoRoot, "generated", slug, "artifacts", "screenshots", safe);

  try {
    const data = await readFile(filepath);
    return { dataUrl: `data:image/png;base64,${data.toString("base64")}` };
  } catch {
    return { error: "Screenshot not found" };
  }
}

export async function readGeneratedFileFlags(slug: string): Promise<{
  hasExportedRequest: boolean;
  hasWorkspace: boolean;
  hasBuild: boolean;
  hasScreenshots: boolean;
  screenshotCount: number;
  hasPromptTxt: boolean;
}> {
  const repoRoot = getPortalRepoRoot();
  const flags = {
    hasExportedRequest: false,
    hasWorkspace: false,
    hasBuild: false,
    hasScreenshots: false,
    screenshotCount: 0,
    hasPromptTxt: false,
  };

  try {
    await access(join(repoRoot, "generated", slug, "client-request.json"));
    flags.hasExportedRequest = true;
  } catch {
    // noop
  }
  try {
    await access(join(repoRoot, "generated", slug, "site", "config.json"));
    flags.hasWorkspace = true;
  } catch {
    // noop
  }
  try {
    await access(join(repoRoot, "generated", slug, "site", ".next"));
    flags.hasBuild = true;
  } catch {
    // noop
  }
  try {
    await access(join(repoRoot, "generated", slug, "artifacts", "prompt.txt"));
    flags.hasPromptTxt = true;
  } catch {
    // noop
  }
  try {
    const screenshotsDir = join(repoRoot, "generated", slug, "artifacts", "screenshots");
    const files = await readdir(screenshotsDir);
    const pngs = files.filter((file) => file.endsWith(".png"));
    flags.hasScreenshots = pngs.length > 0;
    flags.screenshotCount = pngs.length;
  } catch {
    // noop
  }

  return flags;
}
