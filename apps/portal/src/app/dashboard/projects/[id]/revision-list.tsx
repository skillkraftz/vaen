"use client";

import { useState, useTransition, useEffect } from "react";
import {
  listRevisionsAction,
  setActiveRevisionAction,
} from "./actions";
import type { RequestRevision, Project } from "@/lib/types";
import { revisionSourceLabel, revisionRoles, isRevisionStale } from "@/lib/revision-helpers";
import type { RevisionSource } from "@/lib/revision-helpers";

interface RevisionListProps {
  projectId: string;
  project: Project;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SOURCE_COLORS: Record<string, string> = {
  intake_processor: "badge-blue",
  user_edit: "badge-yellow",
  ai_import: "badge-green",
  manual: "",
};

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    current: "badge-green",
    exported: "badge-blue",
    generated: "badge-yellow",
    reviewed: "badge-yellow",
  };
  return (
    <span className={`badge ${colors[role] ?? ""}`} style={{ fontSize: "0.65rem" }}>
      {role}
    </span>
  );
}

export function RevisionList({ projectId, project }: RevisionListProps) {
  const [revisions, setRevisions] = useState<RequestRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    listRevisionsAction(projectId).then(({ revisions: revs, error: err }) => {
      setRevisions(revs);
      setError(err ?? null);
      setLoading(false);
    });
  }, [projectId]);

  const staleness = isRevisionStale(project);
  const hasStaleness = staleness.exportStale || staleness.generateStale || staleness.reviewStale;

  if (loading) return <p className="text-sm text-muted">Loading revisions...</p>;
  if (error) return <p className="text-sm text-muted">{error}</p>;
  if (revisions.length === 0) return <p className="text-sm text-muted">No revisions yet.</p>;

  const handleSetActive = (revisionId: string) => {
    startTransition(async () => {
      const result = await setActiveRevisionAction(projectId, revisionId);
      if (result.error) {
        setError(result.error);
      } else {
        window.location.reload();
      }
    });
  };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Header with staleness badges */}
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <strong style={{ fontSize: "0.875rem" }}>
            Revisions ({revisions.length})
          </strong>
          {hasStaleness && (
            <span style={{ display: "flex", gap: "0.25rem" }}>
              {staleness.exportStale && (
                <span className="badge badge-yellow" style={{ fontSize: "0.6rem" }}>EXPORT STALE</span>
              )}
              {staleness.generateStale && (
                <span className="badge badge-yellow" style={{ fontSize: "0.6rem" }}>GENERATE STALE</span>
              )}
              {staleness.reviewStale && (
                <span className="badge badge-yellow" style={{ fontSize: "0.6rem" }}>REVIEW STALE</span>
              )}
            </span>
          )}
        </div>
        <span className="text-sm text-muted">{expanded ? "\u25B2" : "\u25BC"}</span>
      </div>

      {/* Revision list */}
      {expanded && (
        <div style={{ maxHeight: "24rem", overflowY: "auto" }}>
          {revisions.map((rev) => {
            const roles = revisionRoles(project, rev.id);
            const isCurrent = roles.includes("current");

            return (
              <div
                key={rev.id}
                style={{
                  padding: "0.625rem 1rem",
                  borderBottom: "1px solid var(--color-border)",
                  background: isCurrent ? "var(--color-bg-accent, #f0f9ff)" : undefined,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span className={`badge ${SOURCE_COLORS[rev.source] ?? ""}`} style={{ fontSize: "0.65rem" }}>
                      {revisionSourceLabel(rev.source as RevisionSource)}
                    </span>
                    {roles.map((r) => (
                      <RoleBadge key={r} role={r} />
                    ))}
                    <span className="text-sm text-muted">{fmtDate(rev.created_at)}</span>
                  </div>
                  {rev.summary && (
                    <p className="text-sm text-muted" style={{ marginTop: "0.15rem" }}>
                      {rev.summary}
                    </p>
                  )}
                </div>
                {!isCurrent && (
                  <button
                    className="btn btn-sm"
                    onClick={() => handleSetActive(rev.id)}
                    disabled={isPending}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Set Active
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
