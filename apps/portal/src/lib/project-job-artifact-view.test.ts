import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getLatestAttemptedJob,
  getLatestSuccessfulJob,
  getProjectArtifactViewerItems,
  summarizeJobForOperator,
} from "./project-job-artifact-view";
import type { ArtifactStatus } from "@/app/dashboard/projects/[id]/project-review-types";
import type { JobRecord } from "./types";

const REPO_ROOT = resolve(__dirname, "../../../..");

function job(overrides: Partial<JobRecord>): JobRecord {
  return {
    id: "job-1",
    project_id: "project-1",
    job_type: "generate",
    status: "pending",
    payload: {},
    result: null,
    stdout: null,
    stderr: null,
    created_at: "2026-03-29T12:00:00.000Z",
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function artifacts(overrides: Partial<ArtifactStatus> = {}): ArtifactStatus {
  return {
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
    ...overrides,
  };
}

describe("project job artifact view helpers", () => {
  it("returns latest attempted and latest successful jobs separately", () => {
    const jobs = [
      job({ id: "job-old", job_type: "generate", status: "completed", created_at: "2026-03-29T10:00:00.000Z" }),
      job({ id: "job-new", job_type: "generate", status: "failed", created_at: "2026-03-29T12:00:00.000Z" }),
    ];

    expect(getLatestAttemptedJob(jobs, "generate")?.id).toBe("job-old");
    expect(getLatestSuccessfulJob(jobs, "generate")?.id).toBe("job-old");
  });

  it("summarizes failed review jobs with next-step guidance", () => {
    const summary = summarizeJobForOperator(
      job({
        job_type: "review",
        status: "failed",
        result: { success: false, message: "Screenshot capture failed", error: "Browser closed" },
        stderr: "Browser closed\nPlaywright crashed",
      }),
    );

    expect(summary.heading).toBe("Preview failed");
    expect(summary.happened).toContain("Screenshot capture failed");
    expect(summary.nextStep).toContain("create a preview again");
    expect(summary.logSummary).toContain("Browser closed");
  });

  it("normalizes artifact availability with useful empty-state next steps", () => {
    const items = getProjectArtifactViewerItems(
      artifacts({
        hasClientRequest: true,
        hasScreenshots: true,
        screenshotCount: 3,
      }),
    );

    expect(items.find((item) => item.key === "request")?.available).toBe(true);
    expect(items.find((item) => item.key === "screenshots")?.description).toContain("3 review screenshots");
    expect(items.find((item) => item.key === "deployment")?.nextStep).toContain("Prepare deployment");
  });
});

describe("project job artifact viewer integration", () => {
  it("adds a unified job and artifact viewer to the project page", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const viewerPath = join(__dirname, "../app/dashboard/projects/[id]/project-job-artifact-viewer.tsx");
    const pageSource = readFileSync(pagePath, "utf-8");
    const viewerSource = readFileSync(viewerPath, "utf-8");

    expect(pageSource).toContain("ProjectJobArtifactViewer");
    expect(pageSource).toContain('from("jobs")');
    expect(pageSource).toContain("loadLatestWorkerHeartbeat");
    expect(viewerSource).toContain('data-testid="project-job-artifact-viewer"');
    expect(viewerSource).toContain('testId="project-worker-health"');
    expect(viewerSource).toContain('data-testid="job-artifact-latest-jobs"');
    expect(viewerSource).toContain('data-testid="job-artifact-artifacts"');
    expect(viewerSource).toContain('data-testid={`artifact-view-item-${item.key}`}' );
    expect(viewerSource).toContain("This view explains what was attempted");
    expect(viewerSource).toContain("Worker status");
  });

  it("extends artifact status to include normalized operator-facing files", () => {
    const helperPath = join(REPO_ROOT, "apps/portal/src/app/dashboard/projects/[id]/project-artifact-helpers.ts");
    const source = readFileSync(helperPath, "utf-8");

    expect(source).toContain("hasBuildManifest");
    expect(source).toContain("hasClaudeBrief");
    expect(source).toContain("hasPromptTxt");
    expect(source).toContain("hasDeploymentPayload");
    expect(source).toContain("build-manifest.json");
    expect(source).toContain("claude-brief.md");
    expect(source).toContain("deployment-payload.json");
  });
});
