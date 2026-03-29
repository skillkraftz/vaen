"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  getArtifactStatusAction,
  getProjectJobsAction,
  getProjectWorkflowSnapshotAction,
  getScreenshotAction,
  getScreenshotsForProjectAction,
  getScreenshotUrlAction,
} from "./actions";
import type { JobRecord } from "@/lib/types";
import type { ArtifactStatus, ReviewManifest } from "./project-review-types";
import { formatStatusLabel } from "@/lib/workflow-steps";
import { JobStatusPanel } from "./project-workflow-job-status";
import {
  ActionSection,
  ProcessBtn,
  ApproveBtn,
  RevisionBtn,
  CustomQuoteBtn,
  ExportBtn,
  GenerateBtn,
  ReviewBtn,
  ExportPromptBtn,
  ImportFinalRequestPanel,
  RequestSourceIndicator,
  ReprocessBtn,
  ReExportBtn,
  ResetToDraftBtn,
} from "./project-workflow-actions";
import { DiagnosticsPanel } from "./project-diagnostics-panel";

interface WorkflowPanelProps {
  projectId: string;
  slug: string;
  status: string;
  lastReviewedRevisionId: string | null;
}

interface NextStepInfo {
  heading: string;
  description: string;
  actionElement?: (
    projectId: string,
    refreshJobs: () => Promise<JobRecord[]>,
    hasActiveJob: boolean,
  ) => React.ReactNode;
}

function getNextStep(status: string, hasActiveJob: boolean): NextStepInfo | null {
  if (hasActiveJob) {
    return {
      heading: "Working on it...",
      description: "A background task is running. This page will update automatically when it finishes.",
    };
  }

  switch (status) {
    case "intake_received":
    case "intake_needs_revision":
      return {
        heading: "Create a Website Plan",
        description: "Process the project information to generate a website plan with content recommendations.",
        actionElement: (pid) => <ProcessBtn projectId={pid} />,
      };
    case "intake_draft_ready":
      return {
        heading: "Review & Approve the Plan",
        description: "Check the website plan below. When it looks good, approve it to move forward.",
        actionElement: (pid) => <ApproveBtn projectId={pid} />,
      };
    case "intake_approved":
      return {
        heading: "Prepare the Content",
        description: "Export the approved plan so the website content is ready to build.",
        actionElement: (pid) => <ExportBtn projectId={pid} />,
      };
    case "intake_parsed":
      return {
        heading: "Build the Website",
        description: "The content is ready. Click below to build the website from this plan.",
        actionElement: (pid, refresh) => (
          <GenerateBtn projectId={pid} onDispatched={refresh} testId="build-generate-site" />
        ),
      };
    case "workspace_generated":
      return {
        heading: "Create a Preview",
        description: "The website has been built. Create a preview to see how it looks.",
        actionElement: (pid, refresh) => (
          <ReviewBtn projectId={pid} onDispatched={refresh} testId="build-review" />
        ),
      };
    case "build_failed":
      return {
        heading: "Build Failed",
        description: "Something went wrong during the build. Check the details below and try again.",
        actionElement: (pid, refresh) => (
          <div className="action-row">
            <GenerateBtn projectId={pid} onDispatched={refresh} testId="build-generate-site" />
            <ReviewBtn projectId={pid} onDispatched={refresh} testId="build-review" />
          </div>
        ),
      };
    case "review_ready":
      return {
        heading: "Preview Ready!",
        description: "Screenshots of the website are ready below. Review them and decide if you want to rebuild or proceed.",
      };
    case "deploy_ready":
      return {
        heading: "Ready to Launch",
        description: "The website is approved. Deployment is coming soon.",
      };
    default:
      return null;
  }
}

function statusPhase(status: string): "intake" | "build" | "deploy" | "done" {
  if (
    [
      "intake_received",
      "intake_processing",
      "intake_draft_ready",
      "intake_needs_revision",
      "intake_approved",
      "custom_quote_required",
    ].includes(status)
  ) {
    return "intake";
  }
  if (
    [
      "intake_parsed",
      "awaiting_review",
      "template_selected",
      "workspace_generated",
      "build_in_progress",
      "build_failed",
      "review_ready",
    ].includes(status)
  ) {
    return "build";
  }
  if (["deploy_ready", "deploying", "deploy_failed"].includes(status)) {
    return "deploy";
  }
  return "done";
}

export function WorkflowPanel({ projectId, slug, status, lastReviewedRevisionId }: WorkflowPanelProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [liveStatus, setLiveStatus] = useState(status);
  const [liveLastReviewedRevisionId, setLiveLastReviewedRevisionId] = useState(lastReviewedRevisionId);
  const [viewerRefreshToken, setViewerRefreshToken] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const prevActiveRef = useRef(false);
  const lastActiveJobRef = useRef<{ id: string; type: string } | null>(null);

  useEffect(() => {
    setLiveStatus(status);
  }, [status]);

  useEffect(() => {
    setLiveLastReviewedRevisionId(lastReviewedRevisionId);
  }, [lastReviewedRevisionId]);

  const effectiveStatus = liveStatus;
  const phase = statusPhase(effectiveStatus);

  const refreshJobs = useCallback(async () => {
    const result = await getProjectJobsAction(projectId);
    setJobs(result);
    return result;
  }, [projectId]);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs, effectiveStatus]);

  const hasActiveJob = jobs.some((job) => job.status === "pending" || job.status === "running");

  useEffect(() => {
    const activeJob = jobs.find((job) => job.status === "pending" || job.status === "running");
    if (activeJob) {
      lastActiveJobRef.current = { id: activeJob.id, type: activeJob.job_type };
    }
  }, [jobs]);

  const refreshProjectView = useCallback(
    async (options?: { awaitReviewReady?: boolean }) => {
      const maxAttempts = options?.awaitReviewReady ? 8 : 4;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const snapshot = await getProjectWorkflowSnapshotAction(projectId);
        const nextStatus = snapshot.status ?? effectiveStatus;
        const nextRevisionId = snapshot.lastReviewedRevisionId ?? null;

        setLiveStatus(nextStatus);
        setLiveLastReviewedRevisionId(nextRevisionId);
        setViewerRefreshToken((value) => value + 1);
        router.refresh();

        if (!options?.awaitReviewReady) {
          return;
        }

        if (nextStatus === "review_ready" && nextRevisionId) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      setViewerRefreshToken((value) => value + 1);
      router.refresh();
    },
    [projectId, router, effectiveStatus],
  );

  useEffect(() => {
    if (prevActiveRef.current && !hasActiveJob) {
      const completedJob = lastActiveJobRef.current;
      const awaitReviewReady = completedJob?.type === "review";
      refreshProjectView({ awaitReviewReady }).catch(() => undefined);
    }
    prevActiveRef.current = hasActiveJob;
  }, [hasActiveJob, refreshProjectView]);

  useEffect(() => {
    if (!hasActiveJob) return;
    const interval = setInterval(refreshJobs, 3000);
    return () => clearInterval(interval);
  }, [hasActiveJob, refreshJobs]);

  const canProcess =
    effectiveStatus === "intake_received" || effectiveStatus === "intake_needs_revision";
  const canApprove = effectiveStatus === "intake_draft_ready";
  const canRevise =
    effectiveStatus === "intake_draft_ready" || effectiveStatus === "custom_quote_required";
  const canQuote = effectiveStatus === "intake_draft_ready";
  const canExport = effectiveStatus === "intake_approved";
  const canGenerate =
    [
      "intake_parsed",
      "awaiting_review",
      "template_selected",
      "workspace_generated",
      "build_failed",
      "review_ready",
    ].includes(effectiveStatus) && !hasActiveJob;
  const canReview =
    ["workspace_generated", "build_failed", "review_ready"].includes(effectiveStatus) && !hasActiveJob;

  const nextStep = getNextStep(effectiveStatus, hasActiveJob);
  const hasWorkflowCardContent =
    jobs.length > 0 ||
    (phase === "intake" && !nextStep) ||
    ((phase === "build" || canGenerate) && !nextStep) ||
    phase === "deploy" ||
    phase === "done";

  return (
    <div data-testid="workflow-panel">
      {nextStep && (
        <div className="next-step-banner" data-testid="next-step-banner">
          <div className="next-step-banner-label">Next Step</div>
          <div className="next-step-banner-heading">{nextStep.heading}</div>
          <div className="next-step-banner-desc">{nextStep.description}</div>
          {nextStep.actionElement?.(projectId, refreshJobs, hasActiveJob)}
        </div>
      )}

      <div className="section" data-testid="preview-section">
        <div className="section-label">Preview</div>
        <ScreenshotViewer
          slug={slug}
          projectId={projectId}
          lastReviewedRevisionId={liveLastReviewedRevisionId}
          status={effectiveStatus}
          refreshToken={viewerRefreshToken}
        />
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "1.5rem" }}>
        <div
          data-testid="workflow-status"
          style={{
            padding: nextStep ? "0.5rem 1.25rem" : "1rem 1.25rem",
            borderBottom: hasWorkflowCardContent ? "1px solid var(--color-border)" : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {nextStep ? (
            <span className="text-sm text-muted" style={{ fontSize: "0.75rem" }}>
              Status:{" "}
              <strong data-testid="workflow-status-label" style={{ color: "var(--color-text)" }}>
                {formatStatusLabel(effectiveStatus)}
              </strong>
            </span>
          ) : (
            <div>
              <span
                className="text-sm"
                style={{ color: "var(--color-text-muted)", marginRight: "0.5rem" }}
              >
                Status:
              </span>
              <strong data-testid="workflow-status-label">{formatStatusLabel(effectiveStatus)}</strong>
            </div>
          )}
          {!nextStep && <PhaseIndicator phase={phase} />}
        </div>

        {jobs.length > 0 && <JobStatusPanel jobs={jobs} />}

        {phase === "intake" && !nextStep && (
          <ActionSection label="Project Setup" testId="section-intake">
            {canProcess && <ProcessBtn projectId={projectId} />}
            {canApprove && <ApproveBtn projectId={projectId} />}
            {canRevise && <RevisionBtn projectId={projectId} />}
            {canQuote && <CustomQuoteBtn projectId={projectId} />}
            {canExport && <ExportBtn projectId={projectId} />}
          </ActionSection>
        )}

        {(phase === "build" || canGenerate) && !nextStep && (
          <ActionSection label="Build" testId="section-build">
            {canExport && <ExportBtn projectId={projectId} />}
            {canGenerate && (
              <GenerateBtn
                projectId={projectId}
                onDispatched={refreshJobs}
                testId="build-generate-site"
              />
            )}
            {canReview && (
              <ReviewBtn
                projectId={projectId}
                onDispatched={refreshJobs}
                testId="build-review"
              />
            )}
            {hasActiveJob && (
              <span className="text-sm text-muted" data-testid="job-running-indicator">
                Working on it...
              </span>
            )}
          </ActionSection>
        )}

        {(phase === "deploy" || phase === "done") && (
          <ActionSection label="Launch">
            <span className="text-sm text-muted">Deployment coming soon.</span>
          </ActionSection>
        )}
      </div>

      <div className="section" data-testid="advanced-section">
        <div
          className={`collapsible-header${advancedOpen ? " open" : ""}`}
          onClick={() => setAdvancedOpen(!advancedOpen)}
          data-testid="advanced-toggle"
        >
          <span className="collapsible-header-title">Advanced Tools</span>
          <span className="collapsible-header-icon">{advancedOpen ? "▾" : "▸"}</span>
        </div>
        {advancedOpen && (
          <div className="collapsible-body">
            {(phase === "build" ||
              effectiveStatus === "intake_approved" ||
              effectiveStatus === "intake_parsed") && (
              <ActionSection label="AI Handoff" testId="section-handoff">
                <ExportPromptBtn projectId={projectId} />
                <ImportFinalRequestPanel projectId={projectId} />
                <RequestSourceIndicator projectId={projectId} />
              </ActionSection>
            )}

            <ActionSection label="Recovery" testId="section-recovery">
              <ReprocessBtn projectId={projectId} />
              <ReExportBtn projectId={projectId} />
              <ResetToDraftBtn projectId={projectId} />
              {canGenerate && (
                <GenerateBtn
                  projectId={projectId}
                  onDispatched={refreshJobs}
                  testId="recovery-generate-site"
                />
              )}
              {canReview && (
                <ReviewBtn
                  projectId={projectId}
                  onDispatched={refreshJobs}
                  testId="recovery-review"
                />
              )}
            </ActionSection>

            <ArtifactStatusRow slug={slug} status={effectiveStatus} />
            <DiagnosticsPanel projectId={projectId} slug={slug} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screenshot viewer ─────────────────────────────────────────────────

function ScreenshotViewer({
  slug,
  projectId,
  lastReviewedRevisionId,
  status,
  refreshToken,
}: {
  slug: string;
  projectId: string;
  lastReviewedRevisionId: string | null;
  status: string;
  refreshToken: number;
}) {
  const [artifacts, setArtifacts] = useState<ArtifactStatus | null>(null);
  const [supabaseScreenshots, setSupabaseScreenshots] = useState<
    Array<{
      id: string;
      file_name: string;
      storage_path: string;
      source_job_id: string | null;
      request_revision_id: string | null;
      checksum_sha256: string | null;
      metadata: Record<string, unknown>;
      created_at: string;
    }>
  >([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageData, setImageData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [fetchDone, setFetchDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFetchDone(false);

    async function loadViewerData() {
      const maxAttempts =
        status === "review_ready" || status === "build_in_progress" || refreshToken > 0 ? 6 : 1;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const [artifactResult, screenshotResult] = await Promise.all([
          getArtifactStatusAction(slug),
          getScreenshotsForProjectAction(projectId, lastReviewedRevisionId),
        ]);

        if (cancelled) return;

        setArtifacts(artifactResult);
        setSupabaseScreenshots(screenshotResult.screenshots);

        const hasAnyScreenshots =
          artifactResult.hasScreenshots || screenshotResult.screenshots.length > 0;
        const shouldRetry =
          !hasAnyScreenshots &&
          attempt < maxAttempts - 1 &&
          (status === "review_ready" || status === "build_in_progress" || refreshToken > 0);

        if (!shouldRetry) {
          setFetchDone(true);
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      if (!cancelled) {
        setFetchDone(true);
      }
    }

    loadViewerData().catch(() => {
      if (!cancelled) {
        setFetchDone(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [slug, projectId, lastReviewedRevisionId, status, refreshToken]);

  const hasSupabase = supabaseScreenshots.length > 0;
  const hasLocal = artifacts?.hasScreenshots;
  const manifest = artifacts?.screenshotManifest ?? null;

  if (!fetchDone) {
    return (
      <div
        className="preview-card preview-card-empty"
        data-testid="screenshot-viewer"
        data-viewer-state="loading"
      >
        <span className="text-sm text-muted">Loading preview...</span>
      </div>
    );
  }

  if (!hasSupabase && !hasLocal) {
    return (
      <div
        className="preview-card preview-card-empty"
        data-testid="screenshot-viewer"
        data-viewer-state="empty"
      >
        <div className="preview-card-empty-icon">🖼</div>
        <p>No preview available yet.</p>
        <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
          Build the website and create a preview to see screenshots here.
        </p>
      </div>
    );
  }

  const screenshotItems = hasSupabase
    ? supabaseScreenshots.map((screenshot) => ({
        key: screenshot.id,
        fileName: screenshot.file_name,
        label: screenshot.file_name.replace(/\.png$/, ""),
        source: "supabase" as const,
        storagePath: screenshot.storage_path,
        jobId: screenshot.source_job_id,
        revisionId: screenshot.request_revision_id,
        checksumSha256: screenshot.checksum_sha256,
        metadata: screenshot.metadata,
        date: screenshot.created_at,
      }))
    : (artifacts?.screenshotNames ?? []).map((name) => ({
        key: name,
        fileName: name,
        label: name.replace(/\.png$/, ""),
        source: "local" as const,
        storagePath: null,
        jobId: null,
        revisionId: null,
        checksumSha256: null,
        metadata: {},
        date: null,
      }));

  const selectedItem = screenshotItems.find((item) => item.key === selectedImage) ?? null;

  const manifestByFile = new Map(
    (manifest?.screenshot_files ?? []).map((file) => [file.file_name, file]),
  );

  const uploadedByFile = new Map<
    string,
    Array<{
      id: string;
      file_name: string;
      checksum_sha256: string | null;
      storage_path: string;
    }>
  >();
  for (const screenshot of supabaseScreenshots) {
    const existing = uploadedByFile.get(screenshot.file_name) ?? [];
    existing.push({
      id: screenshot.id,
      file_name: screenshot.file_name,
      checksum_sha256: screenshot.checksum_sha256,
      storage_path: screenshot.storage_path,
    });
    uploadedByFile.set(screenshot.file_name, existing);
  }

  const missingInUpload: string[] = [];
  const hashMismatches: string[] = [];
  if (manifest) {
    for (const file of manifest.screenshot_files) {
      const uploaded = uploadedByFile.get(file.file_name);
      if (!uploaded || uploaded.length === 0) {
        missingInUpload.push(file.file_name);
        continue;
      }
      if (uploaded.some((item) => item.checksum_sha256 !== file.sha256)) {
        hashMismatches.push(file.file_name);
      }
    }
  }

  const extraUploaded = manifest
    ? Array.from(uploadedByFile.keys()).filter((fileName) => !manifestByFile.has(fileName))
    : [];

  const verificationMatched =
    manifest != null &&
    missingInUpload.length === 0 &&
    extraUploaded.length === 0 &&
    hashMismatches.length === 0;
  const verificationState =
    manifest == null ? "manifest-missing" : verificationMatched ? "matched" : "mismatch";
  const verificationSummary =
    manifest == null
      ? "No screenshot manifest found on disk for this review run."
      : verificationMatched
        ? `Disk manifest matches uploaded assets (${manifest.screenshot_files.length} files).`
        : `Mismatch detected — missing upload: ${missingInUpload.length}, extra uploaded: ${extraUploaded.length}, hash mismatches: ${hashMismatches.length}.`;

  async function loadImage(key: string, source: "supabase" | "local", storagePath: string | null) {
    if (imageData[key]) {
      setSelectedImage(key);
      return;
    }
    setLoading(key);

    if (source === "supabase" && storagePath) {
      const result = await getScreenshotUrlAction(storagePath);
      if (result.url) {
        setImageData((prev) => ({ ...prev, [key]: result.url! }));
        setSelectedImage(key);
      }
    } else {
      const filename = key;
      const result = await getScreenshotAction(slug, filename);
      if (result.dataUrl) {
        setImageData((prev) => ({ ...prev, [key]: result.dataUrl! }));
        setSelectedImage(key);
      }
    }
    setLoading(null);
  }

  const batchJobId = screenshotItems[0]?.jobId ?? null;
  const batchRevisionId = screenshotItems[0]?.revisionId ?? null;
  const batchDate = screenshotItems[0]?.date ?? null;

  return (
    <div
      className="preview-card"
      data-testid="screenshot-viewer"
      data-viewer-state="loaded"
      data-screenshot-count={screenshotItems.length}
      data-manifest-path={manifest?.manifest_path ?? ""}
      data-verification-state={verificationState}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "0.5rem",
        }}
      >
        <span
          className="text-sm"
          style={{
            color: "var(--color-text-muted)",
            fontWeight: 500,
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Screenshots ({screenshotItems.length})
        </span>
        {batchDate && (
          <span className="text-sm text-muted" style={{ fontSize: "0.75rem" }}>
            {new Date(batchDate).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      <div
        data-testid="screenshot-thumbnails"
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}
      >
        {screenshotItems.map((item) => (
          <button
            key={item.key}
            className="btn btn-sm"
            data-testid={`screenshot-thumb-${item.label}`}
            style={{
              fontSize: "0.7rem",
              padding: "0.2rem 0.5rem",
              background: selectedImage === item.key ? "var(--color-primary)" : undefined,
              color: selectedImage === item.key ? "#fff" : undefined,
            }}
            onClick={() => loadImage(item.key, item.source, item.storagePath)}
            disabled={loading === item.key}
          >
            {loading === item.key ? "Loading..." : item.label}
          </button>
        ))}
      </div>

      <PreviewDiagnostics
        verificationState={verificationState}
        verificationSummary={verificationSummary}
        hasSupabase={hasSupabase}
        batchRevisionId={batchRevisionId}
        batchJobId={batchJobId}
        batchDate={batchDate}
        manifest={manifest}
      />

      {selectedImage && imageData[selectedImage] && (
        <div data-testid="screenshot-preview" style={{ marginTop: "0.75rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.5rem",
            }}
          >
            <span className="text-sm" style={{ fontWeight: 500, fontSize: "0.8rem" }}>
              {selectedItem?.label ?? selectedImage}
            </span>
            <button
              className="btn btn-sm"
              style={{ fontSize: "0.65rem", padding: "0.1rem 0.3rem" }}
              onClick={() => setSelectedImage(null)}
            >
              Close
            </button>
          </div>
          <span
            data-testid="screenshot-preview-meta"
            data-meta-filename={selectedItem?.fileName ?? selectedImage}
            data-meta-sha={selectedItem?.checksumSha256 ?? ""}
            data-meta-path={selectedItem?.storagePath ?? ""}
            style={{ display: "none" }}
          />
          <img
            src={imageData[selectedImage]}
            alt={selectedItem?.label ?? selectedImage}
            data-testid="screenshot-preview-image"
            data-preview-filename={selectedItem?.fileName ?? selectedImage}
            data-preview-source={selectedItem?.source ?? ""}
            data-preview-src={imageData[selectedImage]}
            style={{
              maxWidth: "100%",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
            }}
          />
        </div>
      )}
    </div>
  );
}

function PreviewDiagnostics({
  verificationState,
  verificationSummary,
  hasSupabase,
  batchRevisionId,
  batchJobId,
  batchDate,
  manifest,
}: {
  verificationState: string;
  verificationSummary: string;
  hasSupabase: boolean;
  batchRevisionId: string | null;
  batchJobId: string | null;
  batchDate: string | null;
  manifest: ReviewManifest | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetails = (hasSupabase && (batchRevisionId || batchJobId)) || manifest != null;

  return (
    <div style={{ marginTop: "0.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <p
          className="text-mono"
          data-testid="screenshot-verification"
          data-verification-state={verificationState}
          style={{
            fontSize: "0.6rem",
            color:
              verificationState === "matched" ? "var(--color-success)" : "var(--color-text-muted)",
            margin: 0,
          }}
        >
          {verificationState === "matched"
            ? "Verified"
            : verificationState === "mismatch"
              ? "Mismatch detected"
              : "No manifest"}
        </p>
        {hasDetails && (
          <button
            className="btn btn-sm"
            data-testid="preview-details-toggle"
            style={{ fontSize: "0.6rem", padding: "0.05rem 0.35rem", lineHeight: 1.4 }}
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            {detailsOpen ? "Hide details" : "Details"}
          </button>
        )}
      </div>

      {detailsOpen && (
        <div
          data-testid="preview-diagnostics-detail"
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem",
            background: "var(--color-bg)",
            borderRadius: "4px",
          }}
        >
          {hasSupabase && (batchRevisionId || batchJobId) && (
            <p
              className="text-mono"
              data-testid="screenshot-provenance"
              style={{ fontSize: "0.6rem", color: "var(--color-text-muted)", marginBottom: "0.35rem" }}
            >
              {batchRevisionId && <>rev {batchRevisionId.slice(0, 8)}</>}
              {batchJobId && (
                <>
                  {batchRevisionId ? " · " : ""}job {batchJobId.slice(0, 8)}
                </>
              )}
              {batchDate && (
                <>
                  {" "}
                  ·{" "}
                  {new Date(batchDate).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </>
              )}
            </p>
          )}

          {manifest && (
            <p
              className="text-mono"
              data-testid="screenshot-manifest-path"
              style={{ fontSize: "0.6rem", color: "var(--color-text-muted)", marginBottom: "0.35rem" }}
            >
              manifest {manifest.manifest_path}
              {manifest.review_probe_path ? ` · probe ${manifest.review_probe_path}` : ""}
              {manifest.runtime_config_probe_path ? ` · runtime ${manifest.runtime_config_probe_path}` : ""}
              {manifest.site_config_snapshot_path ? ` · config ${manifest.site_config_snapshot_path}` : ""}
              {manifest.site_source_summary_path ? ` · source ${manifest.site_source_summary_path}` : ""}
              {manifest.site_identity_scan_path ? ` · scan ${manifest.site_identity_scan_path}` : ""}
              {manifest.served_title ? ` · title ${manifest.served_title}` : ""}
              {manifest.served_url ? ` · ${manifest.served_url}` : ""}
            </p>
          )}

          <p
            className="text-mono"
            style={{
              fontSize: "0.6rem",
              color:
                verificationState === "matched" ? "var(--color-success)" : "var(--color-text-muted)",
              marginBottom: "0.35rem",
            }}
          >
            {verificationSummary}
          </p>

          {manifest?.content_verification && (
            <p
              className="text-mono"
              data-testid="screenshot-content-verification"
              data-content-verification-state={manifest.content_verification.status}
              style={{
                fontSize: "0.6rem",
                color:
                  manifest.content_verification.status === "matched"
                    ? "var(--color-success)"
                    : "var(--color-text-muted)",
                marginBottom: "0.35rem",
                whiteSpace: "pre-wrap",
              }}
            >
              content {manifest.content_verification.status}
              {manifest.review_identity_status
                ? ` · identity ${manifest.review_identity_status}${manifest.mismatch_stage ? `:${manifest.mismatch_stage}` : ""}`
                : ""}
              {manifest.content_verification.expected_business_name
                ? ` · expected ${manifest.content_verification.expected_business_name}`
                : ""}
              {manifest.content_verification.observed_home_title
                ? ` · home title ${manifest.content_verification.observed_home_title}`
                : ""}
              {manifest.content_verification.observed_home_h1
                ? ` · home h1 ${manifest.content_verification.observed_home_h1}`
                : ""}
              {manifest.content_verification.mismatches.length > 0
                ? ` · ${manifest.content_verification.mismatches.join(" | ")}`
                : ""}
            </p>
          )}

          {manifest?.runtime_config_status && (
            <p
              className="text-mono"
              data-testid="screenshot-runtime-config"
              data-runtime-config-state={manifest.runtime_config_status}
              style={{
                fontSize: "0.6rem",
                color:
                  manifest.runtime_config_status === "matched"
                    ? "var(--color-success)"
                    : "var(--color-text-muted)",
                marginBottom: "0.35rem",
                whiteSpace: "pre-wrap",
              }}
            >
              runtime {manifest.runtime_config_status}
              {manifest.expected_business_name ? ` · expected ${manifest.expected_business_name}` : ""}
              {manifest.runtime_business_name ? ` · business ${manifest.runtime_business_name}` : ""}
              {manifest.runtime_config_path ? ` · path ${manifest.runtime_config_path}` : ""}
              {manifest.runtime_cwd ? ` · cwd ${manifest.runtime_cwd}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseIndicator({ phase }: { phase: "intake" | "build" | "deploy" | "done" }) {
  const phases = ["intake", "build", "deploy", "done"] as const;

  return (
    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
      {phases.map((currentPhase) => (
        <div
          key={currentPhase}
          style={{
            padding: "0.1rem 0.5rem",
            borderRadius: "999px",
            fontSize: "0.7rem",
            fontWeight: 500,
            background:
              currentPhase === phase ? "var(--color-primary)" : "var(--color-border)",
            color: currentPhase === phase ? "#fff" : "var(--color-text-muted)",
          }}
        >
          {currentPhase}
        </div>
      ))}
    </div>
  );
}

function ArtifactStatusRow({ slug, status }: { slug: string; status: string }) {
  const [artifacts, setArtifacts] = useState<ArtifactStatus | null>(null);

  useEffect(() => {
    getArtifactStatusAction(slug).then(setArtifacts);
  }, [slug, status]);

  if (!artifacts) return null;

  const items = [
    { label: "client-request.json", ok: artifacts.hasClientRequest },
    { label: "Generated workspace", ok: artifacts.hasWorkspace },
    { label: "Site build", ok: artifacts.hasSiteBuild },
    {
      label: `Screenshots${artifacts.screenshotCount > 0 ? ` (${artifacts.screenshotCount})` : ""}`,
      ok: artifacts.hasScreenshots,
    },
  ];

  if (!items.some((item) => item.ok)) return null;

  return (
    <div
      data-testid="artifact-status"
      style={{
        padding: "0.75rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
        display: "flex",
        gap: "1rem",
        flexWrap: "wrap",
      }}
    >
      <span
        className="text-sm"
        style={{
          color: "var(--color-text-muted)",
          fontWeight: 500,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          flexBasis: "100%",
          marginBottom: "-0.25rem",
        }}
      >
        Artifacts
      </span>
      {items.map((item) => (
        <span
          key={item.label}
          className="text-sm"
          style={{
            color: item.ok ? "var(--color-success)" : "var(--color-text-muted)",
            opacity: item.ok ? 1 : 0.5,
          }}
        >
          {item.ok ? "[ok]" : "[--]"} {item.label}
        </span>
      ))}
    </div>
  );
}
