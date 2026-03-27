/**
 * Pure revision helpers — no I/O, no DB, fully testable.
 *
 * These operate on the revision data model where each edit creates an
 * immutable revision record, and the project points to the active one.
 */

import type { Project, RequestRevision } from "./types";

// ── Revision source types ────────────────────────────────────────────

export type RevisionSource = "intake_processor" | "user_edit" | "ai_import" | "manual";

/** Human-readable labels for revision sources */
const SOURCE_LABELS: Record<RevisionSource, string> = {
  intake_processor: "Auto-processed from intake",
  user_edit: "Manual edit",
  ai_import: "AI-improved import",
  manual: "Manual entry",
};

export function revisionSourceLabel(source: RevisionSource): string {
  return SOURCE_LABELS[source] ?? source;
}

// ── Staleness detection ──────────────────────────────────────────────

export interface StalenessResult {
  exportStale: boolean;
  generateStale: boolean;
  reviewStale: boolean;
}

/**
 * Detect which downstream artifacts are stale relative to the current revision.
 * A pointer is stale if it exists but differs from current_revision_id,
 * or if current_revision_id is set but the pointer is null.
 */
export function isRevisionStale(project: Project): StalenessResult {
  const current = project.current_revision_id;

  return {
    exportStale: current != null && project.last_exported_revision_id !== current,
    generateStale: current != null && project.last_generated_revision_id !== current,
    reviewStale: current != null && project.last_reviewed_revision_id !== current,
  };
}

// ── Active request resolution ────────────────────────────────────────

/**
 * Resolve the request data from the project's current revision.
 * Returns null if no current revision is set or the revision is not found.
 */
export function getActiveRequestData(
  project: Project,
  revisions: RequestRevision[],
): Record<string, unknown> | null {
  if (!project.current_revision_id) return null;
  const rev = revisions.find((r) => r.id === project.current_revision_id);
  return rev?.request_data ?? null;
}

// ── Revision data construction ───────────────────────────────────────

/**
 * Build a revision data shape (without id/project_id — those come from the DB).
 * Used to construct the object before inserting into Supabase.
 */
export function createRevisionData(
  source: RevisionSource,
  requestData: Record<string, unknown>,
  parentRevisionId?: string | null,
  summary?: string | null,
): Omit<RequestRevision, "id" | "project_id" | "created_at"> {
  return {
    source,
    request_data: requestData,
    parent_revision_id: parentRevisionId ?? null,
    summary: summary ?? null,
  };
}

// ── Revision comparison ──────────────────────────────────────────────

/**
 * Find which pointer a specific revision ID matches (if any).
 * Returns the roles this revision serves on the project.
 */
export function revisionRoles(
  project: Project,
  revisionId: string,
): Array<"current" | "exported" | "generated" | "reviewed"> {
  const roles: Array<"current" | "exported" | "generated" | "reviewed"> = [];
  if (project.current_revision_id === revisionId) roles.push("current");
  if (project.last_exported_revision_id === revisionId) roles.push("exported");
  if (project.last_generated_revision_id === revisionId) roles.push("generated");
  if (project.last_reviewed_revision_id === revisionId) roles.push("reviewed");
  return roles;
}
