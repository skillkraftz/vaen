"use client";

import { useState } from "react";
import type { JobRecord } from "@/lib/types";

export function JobStatusPanel({ jobs }: { jobs: JobRecord[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const visible = jobs.slice(0, 5);

  return (
    <div
      data-testid="job-status-panel"
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
          <div key={job.id} data-testid={`job-row-${job.job_type}`} data-job-status={job.status}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
              }}
              onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
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
              <span className="text-sm text-muted" style={{ fontSize: "0.7rem" }}>
                {expandedId === job.id ? "▾" : "▸"}
              </span>
            </div>

            {expandedId === job.id && <JobDetails job={job} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function JobStatusBadge({ status }: { status: JobRecord["status"] }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: "var(--color-border)", color: "var(--color-text-muted)", label: "pending" },
    running: { bg: "#fef3c7", color: "#92400e", label: "running" },
    completed: { bg: "#d1fae5", color: "#065f46", label: "done" },
    failed: { bg: "#fce4ec", color: "#b71c1c", label: "failed" },
  };
  const resolved = styles[status] ?? styles.pending;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.05rem 0.4rem",
        borderRadius: "999px",
        fontSize: "0.65rem",
        fontWeight: 600,
        background: resolved.bg,
        color: resolved.color,
      }}
    >
      {resolved.label}
    </span>
  );
}

function formatJobTime(job: JobRecord): string {
  if (job.status === "running" && job.started_at) {
    const sec = Math.round((Date.now() - new Date(job.started_at).getTime()) / 1000);
    return `${sec}s`;
  }
  if (job.completed_at && job.started_at) {
    const sec = Math.round(
      (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000,
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
      {result && (
        <p
          style={{
            color: (result.success as boolean) ? "var(--color-success)" : "var(--color-error)",
            marginBottom: "0.35rem",
          }}
        >
          {result.message as string}
        </p>
      )}

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
          {execution.command && <div>cmd: {execution.command as string}</div>}
          {execution.site_path && <div>site: {execution.site_path as string}</div>}
          {execution.site_age && <div>age: {execution.site_age as string}</div>}
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
              {(validation.errors as string[]).map((error, index) => (
                <div key={index}>{error}</div>
              ))}
            </div>
          )}
        </div>
      )}

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
