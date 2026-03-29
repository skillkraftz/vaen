import type { ArtifactStatus } from "@/app/dashboard/projects/[id]/project-review-types";
import type { JobRecord } from "./types";

export interface ProjectArtifactViewerItem {
  key: string;
  label: string;
  available: boolean;
  description: string;
  nextStep: string;
}

export interface OperatorJobSummary {
  heading: string;
  happened: string;
  nextStep: string;
  logSummary: string | null;
}

export function getLatestAttemptedJob(
  jobs: JobRecord[],
  jobType: string,
): JobRecord | null {
  return jobs.find((job) => job.job_type === jobType) ?? null;
}

export function getLatestSuccessfulJob(
  jobs: JobRecord[],
  jobType: string,
): JobRecord | null {
  return jobs.find((job) => job.job_type === jobType && job.status === "completed") ?? null;
}

export function getJobRelatedArtifacts(jobType: string): string[] {
  switch (jobType) {
    case "generate":
      return ["Request snapshot", "Build manifest", "Claude brief", "Site build"];
    case "review":
      return ["Screenshots", "Validation report"];
    case "deploy_prepare":
      return ["Deployment payload"];
    default:
      return [];
  }
}

export function summarizeJobForOperator(job: JobRecord): OperatorJobSummary {
  const stderrExcerpt = job.stderr?.trim().split("\n").slice(-4).join("\n") ?? null;
  const stdoutExcerpt = job.stdout?.trim().split("\n").slice(-4).join("\n") ?? null;
  const resultMessage = job.result?.message ?? null;
  const resultError = typeof job.result?.error === "string" ? job.result.error : null;
  const logSummary = resultError ?? stderrExcerpt ?? stdoutExcerpt ?? null;

  if (job.status === "pending") {
    return {
      heading: "Queued",
      happened: "This task is waiting for the worker to pick it up.",
      nextStep: "Wait for the worker heartbeat and job status to move to running.",
      logSummary: resultMessage,
    };
  }

  if (job.status === "running") {
    return {
      heading: "In progress",
      happened: "The worker is currently processing this task.",
      nextStep: "Wait for completion. If it stays running too long, check worker health and logs.",
      logSummary,
    };
  }

  if (job.status === "failed") {
    switch (job.job_type) {
      case "generate":
        return {
          heading: "Build failed",
          happened: resultMessage ?? "Website generation did not finish successfully.",
          nextStep: "Review the error summary, fix Request Data or Business Details if needed, then build again.",
          logSummary,
        };
      case "review":
        return {
          heading: "Preview failed",
          happened: resultMessage ?? "Screenshot capture or preview validation failed.",
          nextStep: "Review the error summary, rebuild if the site changed, then create a preview again.",
          logSummary,
        };
      case "deploy_prepare":
        return {
          heading: "Deployment prep failed",
          happened: resultMessage ?? "Deployment metadata could not be validated.",
          nextStep: "Review the error summary, confirm the latest export/build are current, then prepare deployment again.",
          logSummary,
        };
      default:
        return {
          heading: "Job failed",
          happened: resultMessage ?? "The task did not complete successfully.",
          nextStep: "Review the error summary and retry when ready.",
          logSummary,
        };
    }
  }

  switch (job.job_type) {
    case "generate":
      return {
        heading: "Website built",
        happened: resultMessage ?? "The generated site workspace is ready.",
        nextStep: "Create a preview to capture screenshots and verify the site.",
        logSummary,
      };
    case "review":
      return {
        heading: "Preview ready",
        happened: resultMessage ?? "Preview screenshots were created successfully.",
        nextStep: "Review the screenshots and continue toward deployment when satisfied.",
        logSummary,
      };
    case "deploy_prepare":
      return {
        heading: "Deployment payload ready",
        happened: resultMessage ?? "Deployment metadata was prepared and validated.",
        nextStep: "Provider deployment can be connected later; for now, inspect the payload and deployment history.",
        logSummary,
      };
    default:
      return {
        heading: "Completed",
        happened: resultMessage ?? "The task completed successfully.",
        nextStep: "No operator action needed right now.",
        logSummary,
      };
  }
}

export function getProjectArtifactViewerItems(
  artifacts: ArtifactStatus,
): ProjectArtifactViewerItem[] {
  return [
    {
      key: "request",
      label: "Request snapshot",
      available: artifacts.hasClientRequest,
      description: "The exported client-request.json used by generation.",
      nextStep: "Export the current version if this is missing.",
    },
    {
      key: "manifest",
      label: "Build manifest",
      available: artifacts.hasBuildManifest,
      description: "The generated build manifest that explains the site workspace plan.",
      nextStep: "Build the website again if this artifact is missing.",
    },
    {
      key: "brief",
      label: "Claude brief",
      available: artifacts.hasClaudeBrief,
      description: "The AI handoff brief created during generation.",
      nextStep: "Rebuild the website if you need a fresh brief.",
    },
    {
      key: "prompt",
      label: "Request improvement prompt",
      available: artifacts.hasPromptTxt,
      description: "The prompt artifact used for AI-assisted request improvements.",
      nextStep: "Generate the prompt again if you need a new AI handoff package.",
    },
    {
      key: "screenshots",
      label: "Screenshots",
      available: artifacts.hasScreenshots,
      description: artifacts.hasScreenshots
        ? `${artifacts.screenshotCount} review screenshot${artifacts.screenshotCount === 1 ? "" : "s"} are available.`
        : "Preview screenshots are not available yet.",
      nextStep: "Create a preview if screenshots are missing.",
    },
    {
      key: "deployment",
      label: "Deployment payload",
      available: artifacts.hasDeploymentPayload,
      description: "The deployment-payload.json prepared for future provider deployment wiring.",
      nextStep: "Prepare deployment once the latest export and build are current.",
    },
  ];
}
