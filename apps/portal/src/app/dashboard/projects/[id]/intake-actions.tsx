"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
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
} from "./actions";
import type { JobRecord } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────

interface WorkflowPanelProps {
  projectId: string;
  slug: string;
  status: string;
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

const STATUS_LABELS: Record<string, string> = {
  intake_received: "Intake received",
  intake_processing: "Processing",
  intake_draft_ready: "Draft ready",
  intake_needs_revision: "Needs revision",
  intake_approved: "Approved",
  custom_quote_required: "Custom quote",
  intake_parsed: "Exported",
  awaiting_review: "Awaiting review",
  template_selected: "Template selected",
  workspace_generated: "Generated",
  build_in_progress: "Building",
  build_failed: "Build failed",
  review_ready: "Review ready",
  deploy_ready: "Deploy ready",
  deploying: "Deploying",
  deploy_failed: "Deploy failed",
  deployed: "Deployed",
  managed: "Managed",
};

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

export function WorkflowPanel({ projectId, slug, status }: WorkflowPanelProps) {
  const phase = statusPhase(status);
  const [jobs, setJobs] = useState<JobRecord[]>([]);

  // Poll for job updates when there are active jobs
  const refreshJobs = useCallback(async () => {
    const result = await getProjectJobsAction(projectId);
    setJobs(result);
  }, [projectId]);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs, status]);

  // Poll while any job is pending or running
  const hasActiveJob = jobs.some(
    (j) => j.status === "pending" || j.status === "running",
  );

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
          <strong>{STATUS_LABELS[status] ?? status.replace(/_/g, " ")}</strong>
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

      {/* Artifact status */}
      <ArtifactStatusRow slug={slug} />

      {/* Screenshot viewer */}
      <ScreenshotViewer slug={slug} />

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
      {job.result && (
        <p
          style={{
            color: job.result.success
              ? "var(--color-success)"
              : "var(--color-error)",
            marginBottom: "0.35rem",
          }}
        >
          {job.result.message}
        </p>
      )}

      {/* Error detail */}
      {job.result?.error && (
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
          {job.result.error}
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

function ScreenshotViewer({ slug }: { slug: string }) {
  const [artifacts, setArtifacts] = useState<ArtifactStatus | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageData, setImageData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    getArtifactStatusAction(slug).then(setArtifacts);
  }, [slug]);

  if (!artifacts?.hasScreenshots) return null;

  async function loadImage(filename: string) {
    if (imageData[filename]) {
      setSelectedImage(filename);
      return;
    }
    setLoading(filename);
    const result = await getScreenshotAction(slug, filename);
    if (result.dataUrl) {
      setImageData((prev) => ({ ...prev, [filename]: result.dataUrl! }));
      setSelectedImage(filename);
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
        Screenshots ({artifacts.screenshotCount})
      </span>

      {/* Thumbnail buttons */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {artifacts.screenshotNames.map((name) => (
          <button
            key={name}
            className="btn btn-sm"
            style={{
              fontSize: "0.7rem",
              padding: "0.2rem 0.5rem",
              background:
                selectedImage === name
                  ? "var(--color-primary)"
                  : undefined,
              color:
                selectedImage === name ? "#fff" : undefined,
            }}
            onClick={() => loadImage(name)}
            disabled={loading === name}
          >
            {loading === name ? "Loading..." : name.replace(/\.png$/, "")}
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
              {selectedImage}
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
