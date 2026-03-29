"use client";

import { useEffect, useState, useTransition } from "react";
import {
  processIntakeAction,
  approveIntakeAction,
  requestRevisionAction,
  markCustomQuoteAction,
  exportToGeneratorAction,
  generateSiteAction,
  runReviewAction,
  reprocessIntakeAction,
  reExportAction,
  resetToDraftAction,
  exportPromptAction,
  importFinalRequestAction,
  getRequestSourceAction,
} from "./actions";

export function ActionSection({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
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

export function ProcessBtn({ projectId }: { projectId: string }) {
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
      label="Create Website Plan"
      pendingLabel="Creating plan..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      primary
    />
  );
}

export function ApproveBtn({ projectId }: { projectId: string }) {
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
      label="Approve Plan"
      pendingLabel="Approving..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      primary
    />
  );
}

export function RevisionBtn({ projectId }: { projectId: string }) {
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
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <textarea
        className="form-input"
        rows={2}
        placeholder="What needs to be changed?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ fontSize: "0.85rem" }}
      />
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button className="btn btn-sm" onClick={handleSubmit} disabled={isPending || !reason.trim()}>
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
      {error && <span className="text-sm" style={{ color: "var(--color-error)" }}>{error}</span>}
    </div>
  );
}

export function CustomQuoteBtn({ projectId }: { projectId: string }) {
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
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <textarea
        className="form-input"
        rows={2}
        placeholder="Why does this need a custom quote?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ fontSize: "0.85rem" }}
      />
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <button className="btn btn-sm" onClick={handleSubmit} disabled={isPending || !reason.trim()}>
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
      {error && <span className="text-sm" style={{ color: "var(--color-error)" }}>{error}</span>}
    </div>
  );
}

export function ExportBtn({ projectId }: { projectId: string }) {
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
      label="Prepare Content"
      pendingLabel="Preparing..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      success={result ? `Exported to ${result}` : null}
      primary
    />
  );
}

export function GenerateBtn({
  projectId,
  onDispatched,
  testId,
}: {
  projectId: string;
  onDispatched: () => void;
  testId?: string;
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
      label="Build Website"
      pendingLabel="Starting build..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      success={result}
      primary
      testId={testId}
    />
  );
}

export function ReviewBtn({
  projectId,
  onDispatched,
  testId,
}: {
  projectId: string;
  onDispatched: () => void;
  testId?: string;
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
      label="Create Preview"
      pendingLabel="Starting preview..."
      isPending={isPending}
      onClick={handleClick}
      error={error}
      success={result}
      primary
      testId={testId}
    />
  );
}

export function ExportPromptBtn({ projectId }: { projectId: string }) {
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
          data-testid="btn-export-prompt"
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

export function ImportFinalRequestPanel({ projectId }: { projectId: string }) {
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
        <button className="btn btn-sm" onClick={() => setShowForm(true)} data-testid="btn-import-final-request">
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
      {error && <p className="text-sm" style={{ color: "var(--color-error)" }}>{error}</p>}
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
            {validationErrors.map((validationError, index) => (
              <li key={index}>{validationError}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function RequestSourceIndicator({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<{
    source: "revision" | "legacy_draft" | "none";
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
    legacy_draft: {
      text: "Generation will use: Legacy draft fallback (no active version yet)",
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

export function ReprocessBtn({ projectId }: { projectId: string }) {
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

export function ReExportBtn({ projectId }: { projectId: string }) {
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

export function ResetToDraftBtn({ projectId }: { projectId: string }) {
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

function ActionButton({
  label,
  pendingLabel,
  isPending,
  onClick,
  error,
  success,
  primary,
  testId,
}: {
  label: string;
  pendingLabel: string;
  isPending: boolean;
  onClick: () => void;
  error: string | null;
  success?: string | null;
  primary?: boolean;
  testId?: string;
}) {
  const resolvedTestId =
    testId ?? `btn-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;

  return (
    <div>
      <button
        className={`btn btn-sm${primary ? " btn-primary" : ""}`}
        onClick={onClick}
        disabled={isPending}
        data-testid={resolvedTestId}
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
