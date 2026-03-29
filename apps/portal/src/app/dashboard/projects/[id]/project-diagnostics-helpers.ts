import { detectMissingInfo } from "@/lib/intake-processor";
import { isRevisionStale } from "@/lib/revision-helpers";
import type { Asset, JobRecord, Project } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import type { ProjectDiagnostics } from "./project-diagnostics-types";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

export async function buildProjectDiagnostics(
  supabase: PortalSupabase,
  projectId: string,
  project: Project | null,
  assetList: Asset[],
  eventList: Array<{ event_type: string; created_at: string }>,
  jobList: JobRecord[],
  fileDiag: ProjectDiagnostics["files"],
): Promise<ProjectDiagnostics> {
  const draftObj = (project?.draft_request as Record<string, unknown>) ?? null;
  const draftDiag = {
    exists: draftObj !== null,
    hasVersion: !!draftObj?.version,
    hasBusiness: !!draftObj?.business,
    hasContact: !!draftObj?.contact,
    hasServices: Array.isArray(draftObj?.services) && (draftObj.services as unknown[]).length > 0,
    servicesCount: Array.isArray(draftObj?.services) ? (draftObj.services as unknown[]).length : 0,
    topLevelKeys: draftObj ? Object.keys(draftObj) : [],
  };

  const hasFinalRequest = project?.final_request !== null && project?.final_request !== undefined;
  const requestSource = hasFinalRequest ? "final" as const : draftDiag.exists ? "draft" as const : "none" as const;

  const lastGenerate = jobList.find((job) => job.job_type === "generate") ?? null;
  const lastReview = jobList.find((job) => job.job_type === "review") ?? null;

  const lastProcessedEvent = eventList.find(
    (event) => event.event_type === "intake_processed" || event.event_type === "intake_reprocessed",
  );
  const lastExportedEvent = eventList.find(
    (event) => event.event_type === "exported_to_generator" || event.event_type === "re_exported",
  );
  const lastGeneratedAt = lastGenerate?.completed_at ?? null;
  const lastReviewedAt = lastReview?.completed_at ?? null;

  const screenshotsStale = (() => {
    if (!fileDiag.hasScreenshots) return false;
    if (!lastGeneratedAt) return false;
    if (!lastReviewedAt) return true;
    return new Date(lastGeneratedAt) > new Date(lastReviewedAt);
  })();

  const liveMissingInfo = project ? detectMissingInfo(project, assetList) : [];

  let revisions: ProjectDiagnostics["revisions"] = null;
  try {
    const { data: revisionRows, error } = await supabase
      .from("project_request_revisions")
      .select("id, source")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (!error && revisionRows && project) {
      const staleness = isRevisionStale(project);
      const currentRev = project.current_revision_id
        ? revisionRows.find((row) => row.id === project.current_revision_id)
        : null;
      revisions = {
        count: revisionRows.length,
        currentSource: currentRev?.source ?? null,
        exportStale: staleness.exportStale,
        generateStale: staleness.generateStale,
        reviewStale: staleness.reviewStale,
      };
    }
  } catch {
    // pre-migration: silently skip
  }

  return {
    draft: draftDiag,
    requestSource,
    hasFinalRequest,
    files: fileDiag,
    jobs: {
      lastGenerate: lastGenerate
        ? { id: lastGenerate.id, status: lastGenerate.status, completedAt: lastGenerate.completed_at }
        : null,
      lastReview: lastReview
        ? { id: lastReview.id, status: lastReview.status, completedAt: lastReview.completed_at }
        : null,
    },
    timestamps: {
      lastProcessedAt: lastProcessedEvent?.created_at ?? null,
      lastExportedAt: lastExportedEvent?.created_at ?? null,
      lastGeneratedAt,
      lastReviewedAt,
    },
    screenshotsStale,
    liveMissingInfo,
    revisions,
  };
}
