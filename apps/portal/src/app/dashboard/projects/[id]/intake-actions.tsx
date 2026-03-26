"use client";

import { useState, useTransition } from "react";
import {
  processIntakeAction,
  approveIntakeAction,
  requestRevisionAction,
  markCustomQuoteAction,
  exportToGeneratorAction,
} from "./actions";

export function ProcessIntakeButton({ projectId }: { projectId: string }) {
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
    <div>
      <button
        className="btn btn-primary"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Processing..." : "Process Intake"}
      </button>
      {error && <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.5rem" }}>{error}</p>}
    </div>
  );
}

export function ApproveIntakeButton({ projectId }: { projectId: string }) {
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
    <div>
      <button
        className="btn btn-primary"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Approving..." : "Approve Intake"}
      </button>
      {error && <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.5rem" }}>{error}</p>}
    </div>
  );
}

export function RequestRevisionButton({ projectId }: { projectId: string }) {
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
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <textarea
        className="form-input"
        rows={2}
        placeholder="What needs to be changed?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="btn btn-sm" onClick={handleSubmit} disabled={isPending || !reason.trim()}>
          {isPending ? "Submitting..." : "Submit Revision"}
        </button>
        <button className="btn btn-sm" onClick={() => { setShowForm(false); setReason(""); }}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--color-error)" }}>{error}</p>}
    </div>
  );
}

export function CustomQuoteButton({ projectId }: { projectId: string }) {
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
        Needs Custom Quote
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <textarea
        className="form-input"
        rows={2}
        placeholder="Why does this need a custom quote?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="btn btn-sm" onClick={handleSubmit} disabled={isPending || !reason.trim()}>
          {isPending ? "Submitting..." : "Flag for Quote"}
        </button>
        <button className="btn btn-sm" onClick={() => { setShowForm(false); setReason(""); }}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--color-error)" }}>{error}</p>}
    </div>
  );
}

export function ExportToGeneratorButton({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setExportPath(null);
    startTransition(async () => {
      const res = await exportToGeneratorAction(projectId);
      if (res.error) {
        setError(res.error);
      } else if (res.path) {
        setExportPath(res.path);
      }
    });
  }

  return (
    <div>
      <button
        className="btn btn-primary"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Exporting..." : "Export to Generator"}
      </button>
      {error && <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.5rem" }}>{error}</p>}
      {exportPath && <p className="text-sm" style={{ color: "var(--color-success)", marginTop: "0.5rem" }}>Exported to {exportPath}</p>}
    </div>
  );
}
