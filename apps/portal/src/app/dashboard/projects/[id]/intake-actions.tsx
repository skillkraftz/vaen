"use client";

import { useState, useTransition, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  processIntakeAction,
  approveIntakeAction,
  requestRevisionAction,
  markCustomQuoteAction,
  exportToGeneratorAction,
  generateSiteAction,
  runReviewAction,
  getArtifactStatusAction,
  getProjectJobsAction,
  getJobStatusAction,
  getScreenshotAction,
  reprocessIntakeAction,
  reExportAction,
  resetToDraftAction,
  getProjectDiagnosticsAction,
  exportPromptAction,
  importFinalRequestAction,
  getRequestSourceAction,
  getScreenshotsForProjectAction,
  getScreenshotUrlAction,
} from "./actions";
import type { ProjectDiagnostics } from "./actions";
import type { JobRecord } from "@/lib/types";
import { formatStatusLabel } from "@/lib/workflow-steps";

// ── Types ─────────────────────────────────────────────────────────────

interface WorkflowPanelProps {
  projectId: string;
  slug: string;
  status: string;
  lastReviewedRevisionId: string | null;
}

interface ArtifactStatus {
  hasClientRequest: boolean;
  hasWorkspace: boolean;
  hasSiteBuild: boolean;
  hasScreenshots: boolean;
  screenshotCount: number;
  screenshotNames: string[];
}

// ── Workflow state logic ──────────────────────────────────────────────

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
  )
    return "intake";
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
  )
    return "build";
  if (["deploy_ready", "deploying", "deploy_failed"].includes(status))
    return "deploy";
  return "done";
}

// ── Main workflow panel ───────────────────────────────────────────────

export function WorkflowPanel({ projectId, slug, status, lastReviewedRevisionId }: WorkflowPanelProps) {
  const phase = statusPhase(status);
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const prevActiveRef = useRef(false);

  // Poll for job updates when there are active jobs
  const refreshJobs = useCallback(async () => {
    const result = await getProjectJobsAction(projectId);
    setJobs(result);
    return result;
  }, [projectId]);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs, status]);

  // Poll while any job is pending or running
  const hasActiveJob = jobs.some(
    (j) => j.status === "pending" || j.status === "running",
  );

  // Detect job completion: was active → now not active → refresh page
  useEffect(() => {
    if (prevActiveRef.current && !hasActiveJob) {
      // A job just finished — refresh the server component to get new status
      router.refresh();
    }
    prevActiveRef.current = hasActiveJob;
  }, [hasActiveJob, router]);

  useEffect(() => {
    if (!hasActiveJob) return;
    const interval = setInterval(refreshJobs, 3000);
    return () => clearInterval(interval);
  }, [hasActiveJob, refreshJobs]);

  // Action availability
  const canProcess =
    status === "intake_received" || status === "intake_needs_revision";
  const canApprove = status === "intake_draft_ready";
  const canRevise =
    status === "intake_draft_ready" || status === "custom_quote_required";
  const canQuote = status === "intake_draft_ready";
  const canExport = status === "intake_approved";
  const canGenerate =
    [
      "intake_parsed",
      "awaiting_review",
      "template_selected",
      "workspace_generated",
      "build_failed",
      "review_ready",
    ].includes(status) && !hasActiveJob;
  const canReview =
    ["workspace_generated", "build_failed", "review_ready"].includes(status) &&
    !hasActiveJob;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Status header */}
      <div
        style={{
          padding: "1rem 1.25rem",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <span
            className="text-sm"
            style={{ color: "var(--color-text-muted)", marginRight: "0.5rem" }}
          >
            Status:
          </span>
          <strong>{formatStatusLabel(status)}</strong>
        </div>
        <PhaseIndicator phase={phase} />
      </div>

      {/* Active jobs */}
      {jobs.length > 0 && <JobStatusPanel jobs={jobs} slug={slug} />}

      {/* Intake actions */}
      {phase === "intake" && (
        <ActionSection label="Intake">
          {canProcess && <ProcessBtn projectId={projectId} />}
          {canApprove && <ApproveBtn projectId={projectId} />}
          {canRevise && <RevisionBtn projectId={projectId} />}
          {canQuote && <CustomQuoteBtn projectId={projectId} />}
          {canExport && <ExportBtn projectId={projectId} />}
          {!canProcess && !canApprove && !canRevise && !canExport && (
            <span className="text-sm text-muted">
              No intake actions available in this state.
            </span>
          )}
        </ActionSection>
      )}

      {/* Build/automation actions */}
      {(phase === "build" || canGenerate) && (
        <ActionSection label="Build & Review">
          {canExport && <ExportBtn projectId={projectId} />}
          {canGenerate && (
            <GenerateBtn projectId={projectId} onDispatched={refreshJobs} />
          )}
          {canReview && (
            <ReviewBtn projectId={projectId} onDispatched={refreshJobs} />
          )}
          {!canGenerate && !canReview && !canExport && !hasActiveJob && (
            <span className="text-sm text-muted">
              No build actions available in this state.
            </span>
          )}
          {hasActiveJob && (
            <span className="text-sm text-muted">
              Job running — waiting for worker...
            </span>
          )}
        </ActionSection>
      )}

      {/* AI Handoff — available once exported */}
      {(phase === "build" || status === "intake_approved" || status === "intake_parsed") && (
        <ActionSection label="AI Handoff">
          <ExportPromptBtn projectId={projectId} />
          <ImportFinalRequestPanel projectId={projectId} />
          <RequestSourceIndicator projectId={projectId} />
        </ActionSection>
      )}

      {/* Artifact status */}
      <ArtifactStatusRow slug={slug} />

      {/* Screenshot viewer */}
      <ScreenshotViewer slug={slug} projectId={projectId} lastReviewedRevisionId={lastReviewedRevisionId} />

      {/* Recovery (always visible) */}
      <ActionSection label="Recovery">
        <ReprocessBtn projectId={projectId} />
        <ReExportBtn projectId={projectId} />
        <ResetToDraftBtn projectId={projectId} />
        {canGenerate && (
          <GenerateBtn projectId={projectId} onDispatched={refreshJobs} />
        )}
        {canReview && (
          <ReviewBtn projectId={projectId} onDispatched={refreshJobs} />
        )}
      </ActionSection>

      {/* Diagnostics */}
      <DiagnosticsPanel projectId={projectId} slug={slug} />

      {/* Deploy placeholder */}
      {(phase === "deploy" || phase === "done") && (
        <ActionSection label="Deploy">
          <span className="text-sm text-muted">
            Deployment actions coming in Phase 3.
          </span>
        </ActionSection>
      )}
    </div>
  );
}

// ── Job status panel ──────────────────────────────────────────────────

function JobStatusPanel({ jobs, slug }: { jobs: JobRecord[]; slug: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Show at most 5 recent jobs
  const visible = jobs.slice(0, 5);

  return (
    <div
      style={{
        padding: "0.75rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
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
          display: "block",
          marginBottom: "0.5rem",
        }}
      >
        Jobs
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {visible.map((job) => (
          <div key={job.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
              }}
              onClick={() =>
                setExpandedId(expandedId === job.id ? null : job.id)
              }
            >
              <JobStatusBadge status={job.status} />
              <span className="text-sm" style={{ fontWeight: 500 }}>
                {job.job_type}
              </span>
              <span
                className="text-sm text-muted"
                style={{ marginLeft: "auto", fontSize: "0.75rem" }}
              >
                {formatJobTime(job)}
              </span>
              <span
                className="text-sm text-muted"
                style={{ fontSize: "0.7rem" }}
              >
                {expandedId === job.id ? "▾" : "▸"}
              </span>
            </div>

            {/* Expanded: show result + logs */}
            {expandedId === job.id && (
              <JobDetails job={job} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function JobStatusBadge({ status }: { status: JobRecord["status"] }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: "var(--color-border)", color: "var(--color-text-muted)", label: "pending" },
    running: { bg: "#fef3c7", color: "#92400e", label: "running" },
    completed: { bg: "#d1fae5", color: "#065f46", label: "done" },
    failed: { bg: "#fce4ec", color: "#b71c1c", label: "failed" },
  };
  const s = styles[status] ?? styles.pending;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.05rem 0.4rem",
        borderRadius: "999px",
        fontSize: "0.65rem",
        fontWeight: 600,
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

function formatJobTime(job: JobRecord): string {
  if (job.status === "running" && job.started_at) {
    const sec = Math.round(
      (Date.now() - new Date(job.started_at).getTime()) / 1000,
    );
    return `${sec}s`;
  }
  if (job.completed_at && job.started_at) {
    const sec = Math.round(
      (new Date(job.completed_at).getTime() -
        new Date(job.started_at).getTime()) /
        1000,
    );
    return `${sec}s`;
  }
  return "";
}

function JobDetails({ job }: { job: JobRecord }) {
  const [showLogs, setShowLogs] = useState(false);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const result = job.result as any;
  const payload = job.payload as any;
  const execution = payload?.execution as any;
  const validation = result?.validation as any;

  return (
    <div
      style={{
        marginTop: "0.35rem",
        marginLeft: "1.5rem",
        padding: "0.5rem",
        background: "var(--color-bg-secondary, #f8f9fa)",
        borderRadius: "4px",
        fontSize: "0.8rem",
      }}
    >
      {/* Result message */}
      {result && (
        <p
          style={{
            color: (result.success as boolean)
              ? "var(--color-success)"
              : "var(--color-error)",
            marginBottom: "0.35rem",
          }}
        >
          {result.message as string}
        </p>
      )}

      {/* Execution details */}
      {execution && (
        <div
          style={{
            fontSize: "0.7rem",
            marginBottom: "0.35rem",
            padding: "0.35rem",
            background: "#f0f0f0",
            borderRadius: "3px",
            fontFamily: "monospace",
          }}
        >
          {execution.command && (
            <div>cmd: {execution.command as string}</div>
          )}
          {execution.site_path && (
            <div>site: {execution.site_path as string}</div>
          )}
          {execution.site_age && (
            <div>age: {execution.site_age as string}</div>
          )}
          {execution.generation_job_id && (
            <div>gen job: {(execution.generation_job_id as string).slice(0, 8)}...</div>
          )}
          {result?.files_written != null && (
            <div>
              files: {result.files_written as number} written
              {(result.files_removed as number) > 0 && `, ${result.files_removed} removed`}
            </div>
          )}
        </div>
      )}

      {/* Validation results */}
      {validation && (
        <div
          style={{
            fontSize: "0.7rem",
            marginBottom: "0.35rem",
            padding: "0.35rem",
            background: validation.valid ? "#d1fae5" : "#fce4ec",
            borderRadius: "3px",
          }}
        >
          <strong>Validation: {validation.valid ? "PASS" : "FAIL"}</strong>
          {validation.checks && (
            <div style={{ marginTop: "0.2rem" }}>
              {Object.entries(validation.checks).map(([check, passed]) => (
                <span
                  key={check}
                  style={{
                    display: "inline-block",
                    marginRight: "0.5rem",
                    color: passed ? "#065f46" : "#b71c1c",
                  }}
                >
                  {passed ? "\u2713" : "\u2717"} {check.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}
          {validation.errors && validation.errors.length > 0 && (
            <div style={{ marginTop: "0.2rem", color: "#b71c1c" }}>
              {(validation.errors as string[]).map((e: string, i: number) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error detail */}
      {result?.error && (
        <pre
          style={{
            fontSize: "0.7rem",
            color: "var(--color-error)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: "120px",
            overflow: "auto",
            marginBottom: "0.35rem",
          }}
        >
          {result.error as string}
        </pre>
      )}

      {/* Log toggle */}
      {(job.stdout || job.stderr) && (
        <div>
          <button
            className="btn btn-sm"
            style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
            onClick={() => setShowLogs(!showLogs)}
          >
            {showLogs ? "Hide logs" : "Show logs"}
          </button>
          {showLogs && (
            <pre
              style={{
                marginTop: "0.35rem",
                fontSize: "0.65rem",
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                maxHeight: "300px",
                overflow: "auto",
                background: "#1e1e1e",
                color: "#d4d4d4",
                padding: "0.5rem",
                borderRadius: "4px",
              }}
            >
              {job.stdout && (
                <>
                  <span style={{ color: "#6a9955" }}>── stdout ──</span>
                  {"\n"}
                  {job.stdout}
                </>
              )}
              {job.stderr && (
                <>
                  {"\n"}
                  <span style={{ color: "#f44747" }}>── stderr ──</span>
                  {"\n"}
                  {job.stderr}
                </>
              )}
            </pre>
          )}
        </div>
      )}

      {/* Job ID for debugging */}
      <p
        className="text-mono"
        style={{
          fontSize: "0.6rem",
          color: "var(--color-text-muted)",
          marginTop: "0.25rem",
        }}
      >
        {job.id}
      </p>
    </div>
  );
}

// ── Screenshot viewer ─────────────────────────────────────────────────

function ScreenshotViewer({ slug, projectId, lastReviewedRevisionId }: { slug: string; projectId: string; lastReviewedRevisionId: string | null }) {
  const [artifacts, setArtifacts] = useState<ArtifactStatus | null>(null);
  const [supabaseScreenshots, setSupabaseScreenshots] = useState<
    Array<{ id: string; file_name: string; storage_path: string; source_job_id: string | null; request_revision_id: string | null; created_at: string }>
  >([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageData, setImageData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    // Load both local and Supabase screenshots
    getArtifactStatusAction(slug).then(setArtifacts);
    // Filter by reviewed revision if available — shows only screenshots
    // from the last review of the correct version
    getScreenshotsForProjectAction(projectId, lastReviewedRevisionId).then(({ screenshots }) => {
      setSupabaseScreenshots(screenshots);
    });
  }, [slug, projectId, lastReviewedRevisionId]);

  const hasSupabase = supabaseScreenshots.length > 0;
  const hasLocal = artifacts?.hasScreenshots;

  if (!hasSupabase && !hasLocal) return null;

  // Prefer Supabase screenshots; fall back to local
  const screenshotItems = hasSupabase
    ? supabaseScreenshots.map((s) => ({
        key: s.id,
        label: s.file_name.replace(/\.png$/, ""),
        source: "supabase" as const,
        storagePath: s.storage_path,
        jobId: s.source_job_id,
        date: s.created_at,
      }))
    : (artifacts?.screenshotNames ?? []).map((name) => ({
        key: name,
        label: name.replace(/\.png$/, ""),
        source: "local" as const,
        storagePath: null,
        jobId: null,
        date: null,
      }));

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
      // Local filesystem fallback
      const filename = key; // key is the filename for local
      const result = await getScreenshotAction(slug, filename);
      if (result.dataUrl) {
        setImageData((prev) => ({ ...prev, [key]: result.dataUrl! }));
        setSelectedImage(key);
      }
    }
    setLoading(null);
  }

  return (
    <div
      style={{
        padding: "0.75rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
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
          display: "block",
          marginBottom: "0.5rem",
        }}
      >
        Latest Screenshots ({screenshotItems.length})
        {hasSupabase && (
          <span style={{ fontWeight: 400, textTransform: "none", marginLeft: "0.5rem" }}>
            from Supabase
          </span>
        )}
      </span>

      {/* Thumbnail buttons */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {screenshotItems.map((item) => (
          <button
            key={item.key}
            className="btn btn-sm"
            style={{
              fontSize: "0.7rem",
              padding: "0.2rem 0.5rem",
              background:
                selectedImage === item.key
                  ? "var(--color-primary)"
                  : undefined,
              color:
                selectedImage === item.key ? "#fff" : undefined,
            }}
            onClick={() => loadImage(item.key, item.source, item.storagePath)}
            disabled={loading === item.key}
          >
            {loading === item.key ? "Loading..." : item.label}
          </button>
        ))}
      </div>

      {/* Selected image */}
      {selectedImage && imageData[selectedImage] && (
        <div style={{ marginTop: "0.75rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.35rem",
            }}
          >
            <span className="text-sm text-mono" style={{ fontSize: "0.7rem" }}>
              {screenshotItems.find((i) => i.key === selectedImage)?.label ?? selectedImage}
            </span>
            <button
              className="btn btn-sm"
              style={{ fontSize: "0.65rem", padding: "0.1rem 0.3rem" }}
              onClick={() => setSelectedImage(null)}
            >
              Close
            </button>
          </div>
          <img
            src={imageData[selectedImage]}
            alt={selectedImage}
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

// ── Phase indicator ───────────────────────────────────────────────────

function PhaseIndicator({
  phase,
}: {
  phase: "intake" | "build" | "deploy" | "done";
}) {
  const phases = ["intake", "build", "deploy", "done"] as const;
  return (
    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
      {phases.map((p) => (
        <div
          key={p}
          style={{
            padding: "0.1rem 0.5rem",
            borderRadius: "999px",
            fontSize: "0.7rem",
            fontWeight: 500,
            background:
              p === phase ? "var(--color-primary)" : "var(--color-border)",
            color: p === phase ? "#fff" : "var(--color-text-muted)",
          }}
        >
          {p}
        </div>
      ))}
    </div>
  );
}

// ── Action section wrapper ────────────────────────────────────────────

function ActionSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "1rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <p
        className="text-sm"
        style={{
          color: "var(--color-text-muted)",
          marginBottom: "0.5rem",
          fontWeight: 500,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </p>
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Artifact status row ───────────────────────────────────────────────

function ArtifactStatusRow({ slug }: { slug: string }) {
  const [artifacts, setArtifacts] = useState<ArtifactStatus | null>(null);

  useEffect(() => {
    getArtifactStatusAction(slug).then(setArtifacts);
  }, [slug]);

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

  if (!items.some((i) => i.ok)) return null;

  return (
    <div
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
            color: item.ok
              ? "var(--color-success)"
              : "var(--color-text-muted)",
            opacity: item.ok ? 1 : 0.5,
          }}
        >
          {item.ok ? "[ok]" : "[--]"} {item.label}
        </span>
      ))}
    </div>
  );
}

// ── Individual action buttons ─────────────────────────────────────────

function ProcessBtn({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await processIntakeAction(projectId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <ActionButton
      label="Process Intake"
      pendingLabel="Processing..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      primary
    />
  );
}

function ApproveBtn({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await approveIntakeAction(projectId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <ActionButton
      label="Approve"
      pendingLabel="Approving..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      primary
    />
  );
}

function RevisionBtn({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");

  function handleSubmit() {
    if (!reason.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await requestRevisionAction(projectId, reason.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setShowForm(false);
        setReason("");
      }
    });
  }

  if (!showForm) {
    return (
      <button className="btn btn-sm" onClick={() => setShowForm(true)}>
        Request Revision
      </button>
    );
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}
    >
      <textarea
        className="form-input"
        rows={2}
        placeholder="What needs to be changed?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ fontSize: "0.85rem" }}
      />
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button
          className="btn btn-sm"
          onClick={handleSubmit}
          disabled={isPending || !reason.trim()}
        >
          {isPending ? "Submitting..." : "Submit"}
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            setShowForm(false);
            setReason("");
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <span className="text-sm" style={{ color: "var(--color-error)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

function CustomQuoteBtn({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");

  function handleSubmit() {
    if (!reason.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await markCustomQuoteAction(projectId, reason.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setShowForm(false);
        setReason("");
      }
    });
  }

  if (!showForm) {
    return (
      <button className="btn btn-sm" onClick={() => setShowForm(true)}>
        Custom Quote
      </button>
    );
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}
    >
      <textarea
        className="form-input"
        rows={2}
        placeholder="Why does this need a custom quote?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ fontSize: "0.85rem" }}
      />
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button
          className="btn btn-sm"
          onClick={handleSubmit}
          disabled={isPending || !reason.trim()}
        >
          {isPending ? "Submitting..." : "Flag"}
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            setShowForm(false);
            setReason("");
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <span className="text-sm" style={{ color: "var(--color-error)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

function ExportBtn({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await exportToGeneratorAction(projectId);
      if (res.error) setError(res.error);
      else if (res.path) setResult(res.path);
    });
  }

  return (
    <ActionButton
      label="Export"
      pendingLabel="Exporting..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      success={result ? `Exported to ${result}` : null}
      primary
    />
  );
}

function GenerateBtn({
  projectId,
  onDispatched,
}: {
  projectId: string;
  onDispatched: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await generateSiteAction(projectId);
      if (res.error) setError(res.error);
      else if (res.jobId) {
        setResult("Job dispatched to worker");
        onDispatched();
      }
    });
  }

  return (
    <ActionButton
      label="Generate Site"
      pendingLabel="Dispatching..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      success={result}
      primary
    />
  );
}

function ReviewBtn({
  projectId,
  onDispatched,
}: {
  projectId: string;
  onDispatched: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await runReviewAction(projectId);
      if (res.error) setError(res.error);
      else if (res.jobId) {
        setResult("Job dispatched to worker");
        onDispatched();
      }
    });
  }

  return (
    <ActionButton
      label="Build & Review"
      pendingLabel="Dispatching..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      success={result}
      primary
    />
  );
}

// ── AI Handoff components ─────────────────────────────────────────────

function ExportPromptBtn({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [promptContent, setPromptContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleClick() {
    setError(null);
    setPromptContent(null);
    startTransition(async () => {
      const res = await exportPromptAction(projectId);
      if (res.error) setError(res.error);
      else if (res.content) setPromptContent(res.content);
    });
  }

  async function handleCopy() {
    if (!promptContent) return;
    await navigator.clipboard.writeText(promptContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ flexBasis: "100%" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          className="btn btn-sm btn-primary"
          onClick={handleClick}
          disabled={isPending}
        >
          {isPending ? "Generating..." : "Export prompt.txt"}
        </button>
        {promptContent && (
          <button
            className="btn btn-sm"
            onClick={handleCopy}
            style={copied ? { background: "#d1fae5", borderColor: "#065f46" } : undefined}
          >
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
        )}
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.35rem" }}>
          {error}
        </p>
      )}
      {promptContent && (
        <pre
          style={{
            marginTop: "0.5rem",
            fontSize: "0.7rem",
            lineHeight: 1.4,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "300px",
            overflow: "auto",
            background: "#1e1e1e",
            color: "#d4d4d4",
            padding: "0.75rem",
            borderRadius: "4px",
          }}
        >
          {promptContent}
        </pre>
      )}
    </div>
  );
}

function ImportFinalRequestPanel({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [jsonInput, setJsonInput] = useState("");

  function handleImport() {
    if (!jsonInput.trim()) return;
    setError(null);
    setValidationErrors([]);
    setSuccess(false);
    startTransition(async () => {
      const res = await importFinalRequestAction(projectId, jsonInput.trim());
      if (res.error) {
        setError(res.error);
      } else if (res.validationErrors && res.validationErrors.length > 0) {
        setValidationErrors(res.validationErrors);
      } else {
        setSuccess(true);
        setJsonInput("");
        setShowForm(false);
      }
    });
  }

  if (!showForm) {
    return (
      <div>
        <button className="btn btn-sm" onClick={() => setShowForm(true)}>
          Import Final Request
        </button>
        {success && (
          <p className="text-sm" style={{ color: "var(--color-success)", marginTop: "0.35rem" }}>
            Final request imported successfully.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        Paste the AI-improved client-request.json below:
      </p>
      <textarea
        className="form-input"
        rows={8}
        placeholder='{"version": "1.0.0", "business": { ... }, ...}'
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
        style={{ fontSize: "0.8rem", fontFamily: "monospace" }}
      />
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button
          className="btn btn-sm btn-primary"
          onClick={handleImport}
          disabled={isPending || !jsonInput.trim()}
        >
          {isPending ? "Validating..." : "Import"}
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            setShowForm(false);
            setJsonInput("");
            setError(null);
            setValidationErrors([]);
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--color-error)" }}>
          {error}
        </p>
      )}
      {validationErrors.length > 0 && (
        <div
          style={{
            padding: "0.5rem",
            background: "#fce4ec",
            borderRadius: "4px",
            fontSize: "0.8rem",
          }}
        >
          <strong style={{ color: "#b71c1c" }}>Validation failed:</strong>
          <ul style={{ margin: "0.25rem 0 0 1rem", color: "#b71c1c" }}>
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RequestSourceIndicator({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<{
    source: "revision" | "draft" | "none";
    hasRevision: boolean;
    hasDraft: boolean;
  } | null>(null);

  useEffect(() => {
    getRequestSourceAction(projectId).then(setInfo);
  }, [projectId]);

  if (!info) return null;

  const labels: Record<string, { text: string; color: string; bg: string }> = {
    revision: {
      text: "Generation will use: Active version",
      color: "#065f46",
      bg: "#d1fae5",
    },
    draft: {
      text: "Generation will use: Draft request (no version yet)",
      color: "#92400e",
      bg: "#fef3c7",
    },
    none: {
      text: "No request available — process intake first",
      color: "#b71c1c",
      bg: "#fce4ec",
    },
  };

  const style = labels[info.source];

  return (
    <div
      style={{
        flexBasis: "100%",
        padding: "0.35rem 0.5rem",
        borderRadius: "4px",
        background: style.bg,
        color: style.color,
        fontSize: "0.8rem",
        fontWeight: 500,
      }}
    >
      {style.text}
    </div>
  );
}

// ── Recovery buttons ──────────────────────────────────────────────────

function ReprocessBtn({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await reprocessIntakeAction(projectId);
      if (result.error) setError(result.error);
      else setSuccess("Intake re-processed. Draft, summary, and recommendations updated.");
    });
  }

  return (
    <ActionButton
      label="Re-process Intake"
      pendingLabel="Processing..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      success={success}
    />
  );
}

function ReExportBtn({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await reExportAction(projectId);
      if (result.error) setError(result.error);
      else setSuccess(`Exported to ${result.path}`);
    });
  }

  return (
    <ActionButton
      label="Re-export to Disk"
      pendingLabel="Exporting..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      success={success}
    />
  );
}

function ResetToDraftBtn({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  function handleClick() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setError(null);
    setConfirm(false);
    startTransition(async () => {
      const result = await resetToDraftAction(projectId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div>
      <button
        className="btn btn-sm"
        onClick={handleClick}
        disabled={isPending}
        style={confirm ? { background: "#fef3c7", borderColor: "#f59e0b" } : undefined}
      >
        {isPending ? "Resetting..." : confirm ? "Click again to confirm reset" : "Reset to Draft"}
      </button>
      {error && (
        <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.35rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Diagnostics panel ────────────────────────────────────────────────

function DiagnosticsPanel({ projectId, slug }: { projectId: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState<ProjectDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!open) {
      setOpen(true);
      setLoading(true);
      const result = await getProjectDiagnosticsAction(projectId, slug);
      setDiag(result);
      setLoading(false);
    } else {
      setOpen(false);
    }
  }

  async function refresh() {
    setLoading(true);
    const result = await getProjectDiagnosticsAction(projectId, slug);
    setDiag(result);
    setLoading(false);
  }

  return (
    <div style={{ borderBottom: "1px solid var(--color-border)" }}>
      <div
        style={{
          padding: "0.75rem 1.25rem",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
        onClick={load}
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
          Diagnostics {open ? "▾" : "▸"}
        </span>
        {open && (
          <button
            className="btn btn-sm"
            style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem" }}
            onClick={(e) => { e.stopPropagation(); refresh(); }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        )}
      </div>

      {open && diag && (
        <div
          style={{
            padding: "0 1.25rem 1rem",
            fontSize: "0.8rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          {/* Request source */}
          <DiagSection title="Request Source">
            <p
              className="text-sm"
              style={{
                fontWeight: 600,
                color: diag.requestSource === "final" ? "#065f46"
                  : diag.requestSource === "draft" ? "#92400e"
                  : "#b71c1c",
              }}
            >
              {diag.requestSource === "final" && "Using: Final (AI-improved) request"}
              {diag.requestSource === "draft" && "Using: Draft request"}
              {diag.requestSource === "none" && "No request available"}
            </p>
            {diag.hasFinalRequest && (
              <p className="text-sm" style={{ color: "#065f46" }}>[ok] Final request imported</p>
            )}
          </DiagSection>

          {/* Draft status */}
          <DiagSection title="Draft Request">
            <DiagRow label="Exists" ok={diag.draft.exists} />
            <DiagRow label="version" ok={diag.draft.hasVersion} />
            <DiagRow label="business" ok={diag.draft.hasBusiness} />
            <DiagRow label="contact" ok={diag.draft.hasContact} />
            <DiagRow label={`services (${diag.draft.servicesCount})`} ok={diag.draft.hasServices} />
            <p className="text-mono" style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
              Keys: {diag.draft.topLevelKeys.join(", ") || "none"}
            </p>
          </DiagSection>

          {/* File status */}
          <DiagSection title="Files on Disk">
            <DiagRow label="client-request.json (exported)" ok={diag.files.hasExportedRequest} />
            <DiagRow label="prompt.txt" ok={diag.files.hasPromptTxt} />
            <DiagRow label="Generated workspace" ok={diag.files.hasWorkspace} />
            <DiagRow label="Site build (.next)" ok={diag.files.hasBuild} />
            <DiagRow label={`Screenshots (${diag.files.screenshotCount})`} ok={diag.files.hasScreenshots} />
            {diag.screenshotsStale && diag.files.hasScreenshots && (
              <p className="text-sm" style={{ color: "#b45309", fontWeight: 500 }}>
                Screenshots are STALE — site was regenerated after last review
              </p>
            )}
          </DiagSection>

          {/* Jobs */}
          <DiagSection title="Last Jobs">
            {diag.jobs.lastGenerate ? (
              <p className="text-sm">
                Generate: <JobStatusBadge status={diag.jobs.lastGenerate.status as JobRecord["status"]} />
                <span className="text-mono" style={{ fontSize: "0.65rem", marginLeft: "0.35rem" }}>
                  {diag.jobs.lastGenerate.id.slice(0, 8)}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted">No generate jobs</p>
            )}
            {diag.jobs.lastReview ? (
              <p className="text-sm">
                Review: <JobStatusBadge status={diag.jobs.lastReview.status as JobRecord["status"]} />
                <span className="text-mono" style={{ fontSize: "0.65rem", marginLeft: "0.35rem" }}>
                  {diag.jobs.lastReview.id.slice(0, 8)}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted">No review jobs</p>
            )}
          </DiagSection>

          {/* Timestamps */}
          <DiagSection title="Timestamps">
            <p className="text-sm">
              Last processed: {diag.timestamps.lastProcessedAt
                ? new Date(diag.timestamps.lastProcessedAt).toLocaleString()
                : "never"}
            </p>
            <p className="text-sm">
              Last exported: {diag.timestamps.lastExportedAt
                ? new Date(diag.timestamps.lastExportedAt).toLocaleString()
                : "never"}
            </p>
            <p className="text-sm">
              Last generated: {diag.timestamps.lastGeneratedAt
                ? new Date(diag.timestamps.lastGeneratedAt).toLocaleString()
                : "never"}
            </p>
            <p className="text-sm">
              Last reviewed: {diag.timestamps.lastReviewedAt
                ? new Date(diag.timestamps.lastReviewedAt).toLocaleString()
                : "never"}
            </p>
          </DiagSection>

          {/* Revisions */}
          {diag.revisions && (
            <DiagSection title={`Revisions (${diag.revisions.count})`}>
              <p className="text-sm">
                Current source: {diag.revisions.currentSource ?? "none"}
              </p>
              <DiagRow label="Export up-to-date" ok={!diag.revisions.exportStale} />
              <DiagRow label="Generation up-to-date" ok={!diag.revisions.generateStale} />
              <DiagRow label="Review up-to-date" ok={!diag.revisions.reviewStale} />
            </DiagSection>
          )}

          {/* Live missing info */}
          <DiagSection title={`Live Missing Info (${diag.liveMissingInfo.length})`}>
            {diag.liveMissingInfo.length === 0 ? (
              <p className="text-sm text-muted">All clear</p>
            ) : (
              diag.liveMissingInfo.map((item, i) => (
                <p key={i} className="text-sm">
                  <span style={{
                    color: item.severity === "required" ? "var(--color-error)"
                      : item.severity === "recommended" ? "#b45309"
                      : "var(--color-text-muted)",
                    fontWeight: 500,
                  }}>
                    [{item.severity}]
                  </span>
                  {" "}{item.label}
                  {item.hint && <span className="text-muted"> — {item.hint}</span>}
                </p>
              ))
            )}
          </DiagSection>
        </div>
      )}

      {open && loading && !diag && (
        <div style={{ padding: "0 1.25rem 1rem" }}>
          <span className="text-sm text-muted">Loading diagnostics...</span>
        </div>
      )}
    </div>
  );
}

function DiagSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: "0.75rem", marginBottom: "0.25rem" }}>
        {title}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", paddingLeft: "0.5rem" }}>
        {children}
      </div>
    </div>
  );
}

function DiagRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <p className="text-sm" style={{ color: ok ? "var(--color-success)" : "var(--color-text-muted)" }}>
      {ok ? "[ok]" : "[--]"} {label}
    </p>
  );
}

// ── Reusable action button ────────────────────────────────────────────

function ActionButton({
  label,
  pendingLabel,
  isPending,
  onClick,
  error,
  success,
  primary,
}: {
  label: string;
  pendingLabel: string;
  isPending: boolean;
  onClick: () => void;
  error: string | null;
  success?: string | null;
  primary?: boolean;
}) {
  return (
    <div>
      <button
        className={`btn btn-sm${primary ? " btn-primary" : ""}`}
        onClick={onClick}
        disabled={isPending}
      >
        {isPending ? pendingLabel : label}
      </button>
      {error && (
        <p
          className="text-sm"
          style={{
            color: "var(--color-error)",
            marginTop: "0.35rem",
            maxWidth: "300px",
          }}
        >
          {error}
        </p>
      )}
      {success && (
        <p
          className="text-sm"
          style={{
            color: "var(--color-success)",
            marginTop: "0.35rem",
            fontSize: "0.75rem",
            maxWidth: "400px",
          }}
        >
          {success}
        </p>
      )}
    </div>
  );
}
