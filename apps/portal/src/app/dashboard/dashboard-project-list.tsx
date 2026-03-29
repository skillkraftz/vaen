"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Client, Project } from "@/lib/types";
import { formatStatusLabel } from "@/lib/workflow-steps";
import {
  archiveProjectAction,
  bulkArchiveProjectsAction,
  bulkPurgeProjectsAction,
  bulkRestoreProjectsAction,
  duplicateProjectAction,
  restoreProjectAction,
} from "./projects/[id]/actions";

type DashboardProject = Project & { client?: Pick<Client, "id" | "name"> | null };

function statusBadge(status: string) {
  const map: Record<string, string> = {
    intake_received: "badge-blue",
    intake_processing: "badge-yellow",
    intake_draft_ready: "badge-yellow",
    intake_needs_revision: "badge-red",
    intake_approved: "badge-green",
    custom_quote_required: "badge-yellow",
    intake_parsed: "badge-blue",
    awaiting_review: "badge-yellow",
    template_selected: "badge-yellow",
    workspace_generated: "badge-green",
    build_in_progress: "badge-yellow",
    build_failed: "badge-red",
    review_ready: "badge-green",
    deploy_ready: "badge-green",
    deployed: "badge-green",
  };
  return map[status] ?? "";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ProjectCardActions({
  project,
  onRefresh,
  onPurgeRequest,
}: {
  project: DashboardProject;
  onRefresh: () => void;
  onPurgeRequest: (projects: DashboardProject[]) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function archiveToggle() {
    startTransition(async () => {
      const result = project.archived_at
        ? await restoreProjectAction(project.id)
        : await archiveProjectAction(project.id);
      if (!result.error) onRefresh();
    });
  }

  function duplicate() {
    startTransition(async () => {
      const result = await duplicateProjectAction(project.id, null);
      if (result.projectId) {
        router.push(`/dashboard/projects/${result.projectId}`);
        router.refresh();
      }
    });
  }

  return (
    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn btn-sm"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          archiveToggle();
        }}
        disabled={isPending}
        data-testid={project.archived_at ? `dashboard-project-restore-${project.slug}` : `dashboard-project-archive-${project.slug}`}
      >
        {project.archived_at ? "Unarchive" : "Archive"}
      </button>
      <button
        type="button"
        className="btn btn-sm"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          duplicate();
        }}
        disabled={isPending}
        data-testid={`dashboard-project-duplicate-${project.slug}`}
      >
        Duplicate
      </button>
      <button
        type="button"
        className="btn btn-sm"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPurgeRequest([project]);
        }}
        data-testid={`dashboard-project-purge-${project.slug}`}
      >
        Purge
      </button>
    </div>
  );
}

function PurgeDialog({
  projects,
  onClose,
  onComplete,
}: {
  projects: DashboardProject[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const expected = `DELETE ${projects.length} PROJECT${projects.length === 1 ? "" : "S"}`;

  function purge() {
    setError(null);
    startTransition(async () => {
      const result = await bulkPurgeProjectsAction(
        projects.map((project) => project.id),
        phrase,
      );

      if (result.error) {
        setError(result.error);
        return;
      }
      onComplete();
    });
  }

  return (
    <div
      data-testid="dashboard-purge-dialog"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        zIndex: 50,
      }}
    >
      <div className="card" style={{ maxWidth: "40rem", width: "100%" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Confirm permanent deletion
        </h2>
        <p className="text-sm text-muted">
          This will permanently remove the selected projects, their contracts, quotes, storage objects, and generated artifacts.
        </p>
        <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {projects.map((project) => (
            <div key={project.id} className="text-sm text-muted">
              {project.name} <span className="text-mono">({project.slug})</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <label className="form-label" htmlFor="dashboardPurgePhrase">
            Type <span className="text-mono">{expected}</span> to continue
          </label>
          <input
            id="dashboardPurgePhrase"
            className="form-input text-mono"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            data-testid="dashboard-purge-phrase"
          />
        </div>
        {error && (
          <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.75rem" }}>
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={purge}
            disabled={isPending || phrase !== expected}
            data-testid="dashboard-purge-confirm"
          >
            {isPending ? "Purging..." : `Delete ${projects.length} Project${projects.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  bulkMode,
  selected,
  onSelectToggle,
  onRefresh,
  onPurgeRequest,
}: {
  project: DashboardProject;
  bulkMode: boolean;
  selected: boolean;
  onSelectToggle: (checked: boolean) => void;
  onRefresh: () => void;
  onPurgeRequest: (projects: DashboardProject[]) => void;
}) {
  return (
    <div className="card" style={{ padding: "0.9rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", flex: 1 }}>
          {bulkMode && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelectToggle(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              data-testid={`project-select-${project.slug}`}
              style={{ marginTop: "0.3rem" }}
            />
          )}
          <Link
            href={`/dashboard/projects/${project.id}`}
            className="card-link"
            data-testid={`project-card-${project.slug}`}
            style={{ display: "block", flex: 1, padding: 0, border: "none", background: "none" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>{project.name}</strong>
                <span className="text-mono text-sm text-muted" style={{ marginLeft: "0.75rem" }}>
                  {project.slug}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span className={`badge ${project.archived_at ? "" : statusBadge(project.status)}`}>
                  {project.archived_at ? "Archived" : formatStatusLabel(project.status)}
                </span>
                <span className="text-sm text-muted">{formatDate(project.created_at)}</span>
              </div>
            </div>
            {project.business_type && (
              <p className="text-sm text-muted mt-1">{project.business_type}</p>
            )}
            {project.client?.name && (
              <p className="text-sm text-muted" style={{ marginTop: "0.2rem" }}>
                Client: {project.client.name}
              </p>
            )}
            {(project.variant_label || project.variant_of) && (
              <p className="text-sm text-muted" style={{ marginTop: "0.2rem" }}>
                Variant: {project.variant_label ?? "Base"}
              </p>
            )}
          </Link>
        </div>
        <ProjectCardActions project={project} onRefresh={onRefresh} onPurgeRequest={onPurgeRequest} />
      </div>
    </div>
  );
}

export function DashboardProjectList({
  activeItems,
  archivedItems,
  showArchived,
}: {
  activeItems: DashboardProject[];
  archivedItems: DashboardProject[];
  showArchived: boolean;
}) {
  const router = useRouter();
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [purgeTargets, setPurgeTargets] = useState<DashboardProject[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const allItems = useMemo(() => [...activeItems, ...archivedItems], [activeItems, archivedItems]);
  const selectedProjects = allItems.filter((project) => selectedIds.includes(project.id));

  function refresh() {
    router.refresh();
  }

  function toggleBulkMode() {
    setBulkMode((value) => !value);
    setSelectedIds([]);
    setError(null);
  }

  function setSelected(projectId: string, checked: boolean) {
    setSelectedIds((current) => checked
      ? [...new Set([...current, projectId])]
      : current.filter((id) => id !== projectId));
  }

  function runBulk(action: "archive" | "restore") {
    setError(null);
    startTransition(async () => {
      const result = action === "archive"
        ? await bulkArchiveProjectsAction(selectedIds)
        : await bulkRestoreProjectsAction(selectedIds);

      if (result.error) {
        setError(result.error);
        return;
      }
      setSelectedIds([]);
      router.refresh();
    });
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.75rem", alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={toggleBulkMode}
          data-testid="dashboard-bulk-mode-toggle"
        >
          {bulkMode ? "Done Selecting" : "Bulk Select"}
        </button>
        {bulkMode && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => runBulk("archive")}
              disabled={isPending || selectedIds.length === 0}
              data-testid="bulk-archive-button"
            >
              Archive Selected
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => runBulk("restore")}
              disabled={isPending || selectedIds.length === 0}
              data-testid="bulk-unarchive-button"
            >
              Unarchive Selected
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPurgeTargets(selectedProjects)}
              disabled={selectedIds.length === 0}
              data-testid="bulk-purge-button"
            >
              Purge Selected
            </button>
          </div>
        )}
      </div>

      {activeItems.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <p className="text-muted">No active projects.</p>
          <p className="text-sm text-muted mt-1">
            Create your first intake to get started.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1" data-testid="project-list">
          {activeItems.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              bulkMode={bulkMode}
              selected={selectedIds.includes(project.id)}
              onSelectToggle={(checked) => setSelected(project.id, checked)}
              onRefresh={refresh}
              onPurgeRequest={setPurgeTargets}
            />
          ))}
        </div>
      )}

      {archivedItems.length > 0 && showArchived && (
        <div className="section" style={{ marginTop: "1.5rem" }}>
          <div className="section-header" style={{ marginBottom: "0.75rem" }}>
            <h2 style={{ fontSize: "1rem" }}>Archived Projects</h2>
            <Link
              href="/dashboard"
              className="btn btn-sm"
              data-testid="archived-projects-toggle"
            >
              Hide Archived
            </Link>
          </div>
          <div className="flex flex-col gap-1" data-testid="archived-project-list">
            {archivedItems.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                bulkMode={bulkMode}
                selected={selectedIds.includes(project.id)}
                onSelectToggle={(checked) => setSelected(project.id, checked)}
                onRefresh={refresh}
                onPurgeRequest={setPurgeTargets}
              />
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.75rem" }}>
          {error}
        </p>
      )}

      {purgeTargets && purgeTargets.length > 0 && (
        <PurgeDialog
          projects={purgeTargets}
          onClose={() => setPurgeTargets(null)}
          onComplete={() => {
            setPurgeTargets(null);
            setSelectedIds([]);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
