"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveProjectAction,
  purgeProjectAction,
  restoreProjectAction,
} from "./actions";

export function ProjectLifecyclePanel({
  projectId,
  slug,
  archived,
}: {
  projectId: string;
  slug: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [purgeSlug, setPurgeSlug] = useState("");
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function archive() {
    setError(null);
    startTransition(async () => {
      const result = archived
        ? await restoreProjectAction(projectId)
        : await archiveProjectAction(projectId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function purge() {
    setError(null);
    startTransition(async () => {
      const result = await purgeProjectAction(projectId, purgeSlug);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="card" data-testid="project-lifecycle-panel">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Project Operations
          </h2>
          <p className="text-sm text-muted">
            Archive hides the project from the default dashboard list. Purge permanently removes the project and its artifacts.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={archive}
            disabled={isPending}
            data-testid={archived ? "project-restore-button" : "project-archive-button"}
          >
            {isPending ? "Saving..." : archived ? "Restore Project" : "Archive Project"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setPurgeOpen((value) => !value)}
            data-testid="project-purge-toggle"
          >
            {purgeOpen ? "Cancel Purge" : "Purge Project"}
          </button>
        </div>

        {purgeOpen && (
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <p className="text-sm" style={{ color: "var(--color-error)" }}>
              Type the project slug to permanently delete this project, its storage objects, and generated filesystem artifacts.
            </p>
            <label className="form-label" htmlFor="purgeSlug">
              Confirm Slug
            </label>
            <input
              id="purgeSlug"
              className="form-input text-mono"
              value={purgeSlug}
              onChange={(e) => setPurgeSlug(e.target.value)}
              placeholder={slug}
              data-testid="project-purge-slug"
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={isPending || purgeSlug !== slug}
              onClick={purge}
              data-testid="project-purge-confirm"
            >
              {isPending ? "Purging..." : "Confirm Purge"}
            </button>
          </div>
        )}

        {error && (
          <p className="text-sm" style={{ color: "var(--color-error)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
