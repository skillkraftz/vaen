"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApprovalRequest } from "@/lib/types";
import {
  archiveProjectAction,
  duplicateProjectAction,
  purgeProjectAction,
  restoreProjectAction,
} from "./actions";

export function ProjectLifecyclePanel({
  projectId,
  slug,
  archived,
  purgeApproval,
}: {
  projectId: string;
  slug: string;
  archived: boolean;
  purgeApproval: ApprovalRequest | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [purgeSlug, setPurgeSlug] = useState("");
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [variantLabel, setVariantLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      if (result.approval_required) {
        setNotice(`Purge request submitted${result.request_id ? ` (${result.request_id})` : ""}.`);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  function duplicate() {
    setError(null);
    startTransition(async () => {
      const result = await duplicateProjectAction(projectId, variantLabel);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.projectId) {
        router.push(`/dashboard/projects/${result.projectId}`);
        router.refresh();
      }
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
            onClick={() => setDuplicateOpen((value) => !value)}
            data-testid="project-duplicate-toggle"
          >
            {duplicateOpen ? "Cancel Duplicate" : "Duplicate Project"}
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

        {duplicateOpen && (
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
            <p className="text-sm text-muted">
              Create a new variant linked to the same client. The duplicate starts from the current request revision and resets export, build, review, and deploy state.
            </p>
            <label className="form-label" htmlFor="variantLabel">
              Variant Label
            </label>
            <input
              id="variantLabel"
              className="form-input"
              value={variantLabel}
              onChange={(e) => setVariantLabel(e.target.value)}
              placeholder="Package 1"
              data-testid="project-duplicate-label"
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={isPending}
              onClick={duplicate}
              data-testid="project-duplicate-confirm"
            >
              {isPending ? "Duplicating..." : "Create Variant"}
            </button>
          </div>
        )}

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

        {(notice || purgeApproval) && (
          <div
            className="card"
            style={{ padding: "0.75rem", background: "var(--color-surface-subtle)" }}
            data-testid="project-purge-approval-banner"
          >
            <p className="text-sm" style={{ color: "var(--color-warning)" }}>
              {notice ?? `Purge approval request is ${purgeApproval?.status}.`}
            </p>
            {purgeApproval?.resolution_note && (
              <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>
                {purgeApproval.resolution_note}
              </p>
            )}
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
