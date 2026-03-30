"use client";

import { useState, useTransition, useEffect } from "react";
import {
  updateProjectAction,
  updateDraftRequestAction,
  patchDraftFieldAction,
  deleteAssetAction,
  getAssetUrlAction,
  uploadAssetsAction,
  attachAssetToRevisionAction,
  detachAssetFromRevisionAction,
  listRevisionAssetsAction,
} from "./actions";

// ── Utilities ─────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function deepSet(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 1) return { ...obj, [path[0]]: value };
  const [head, ...rest] = path;
  const child = (obj[head] ?? {}) as Record<string, unknown>;
  return { ...obj, [head]: deepSet(child, rest, value) };
}

// ── Service normalization ─────────────────────────────────────────────

interface ServiceItem {
  name: string;
  description?: string;
  price?: string;
}

function servicesToText(services: ServiceItem[]): string {
  return services
    .map((s) => (s.description ? `${s.name} \u2014 ${s.description}` : s.name))
    .join("\n");
}

function textToServices(text: string): ServiceItem[] {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^[-*\u2022]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .map((line) => {
      const emDash = line.match(/^(.+?)\s*(?:\u2014|--)\s+(.+)$/);
      if (emDash) return { name: emDash[1].trim(), description: emDash[2].trim() };
      const colon = line.match(/^([^:]{2,60}):\s+(.+)$/);
      if (colon) return { name: colon[1].trim(), description: colon[2].trim() };
      return { name: line };
    });
}

// ── Save-status type ──────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

// ── Field: textarea ───────────────────────────────────────────────────

function FieldTextarea({
  label,
  hint,
  initialValue,
  rows,
  mono,
  onSave,
}: {
  label: string;
  hint?: string;
  initialValue: string;
  rows?: number;
  mono?: boolean;
  onSave: (value: string) => Promise<{ error?: string }>;
}) {
  const [text, setText] = useState(initialValue);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [isPending, startTransition] = useTransition();

  const dirty = text !== initialValue;

  function save() {
    setStatus("saving");
    startTransition(async () => {
      const result = await onSave(text);
      setStatus(result.error ? "error" : "saved");
    });
  }

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div className="responsive-actions" style={{ alignItems: "baseline", marginBottom: "0.35rem" }}>
        <label
          style={{
            fontSize: "0.8rem",
            fontWeight: 500,
            color: "var(--color-text-muted)",
          }}
        >
          {label}
        </label>
        {hint && (
          <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
            {hint}
          </span>
        )}
      </div>
      <textarea
        className={`form-input${mono ? " text-mono" : ""}`}
        style={{ fontSize: mono ? "0.8rem" : "0.875rem", lineHeight: 1.5 }}
        rows={rows ?? 4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus("idle");
        }}
      />
      {(dirty || status === "saved" || status === "error") && (
        <div className="responsive-actions" style={{ marginTop: "0.35rem" }}>
          {dirty && (
            <button
              className="btn btn-sm btn-primary"
              onClick={save}
              disabled={isPending}
            >
              {isPending ? "Saving..." : "Save"}
            </button>
          )}
          {status === "saved" && !dirty && (
            <span className="text-sm" style={{ color: "var(--color-success)" }}>
              Saved
            </span>
          )}
          {status === "error" && (
            <span className="text-sm" style={{ color: "var(--color-error)" }}>
              Save failed
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Field: inline input ───────────────────────────────────────────────

function FieldInput({
  label,
  initialValue,
  onSave,
}: {
  label: string;
  initialValue: string;
  onSave: (value: string) => Promise<{ error?: string }>;
}) {
  const [text, setText] = useState(initialValue);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [isPending, startTransition] = useTransition();

  const dirty = text !== initialValue;

  function save() {
    setStatus("saving");
    startTransition(async () => {
      const result = await onSave(text);
      setStatus(result.error ? "error" : "saved");
    });
  }

  return (
    <div className="responsive-field-row">
      <label className="responsive-field-row-label">
        {label}
      </label>
      <input
        className="form-input"
        style={{ flex: 1 }}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus("idle");
        }}
        onKeyDown={(e) => e.key === "Enter" && dirty && save()}
      />
      {dirty && (
        <button
          className="btn btn-sm btn-primary"
          onClick={save}
          disabled={isPending}
          style={{ flexShrink: 0 }}
        >
          {isPending ? "..." : "Save"}
        </button>
      )}
      {status === "saved" && !dirty && (
        <span
          className="text-sm"
          style={{ color: "var(--color-success)", flexShrink: 0 }}
        >
          Saved
        </span>
      )}
    </div>
  );
}

// ── Build Inputs Editor ───────────────────────────────────────────────

export function BuildInputsEditor({
  projectId,
  project,
  draftRequest,
}: {
  projectId: string;
  project: {
    id: string;
    slug: string;
    business_type: string | null;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  draftRequest: Record<string, unknown> | null;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(
    draftRequest ?? {},
  );

  async function saveProjectField(
    field: string,
    value: string,
  ): Promise<{ error?: string }> {
    return updateProjectAction(projectId, { [field]: value || null });
  }

  async function saveDraftField(
    path: string[],
    value: unknown,
  ): Promise<{ error?: string }> {
    // Server-side merge: send only the path + value, server loads current DB state and merges
    const result = await patchDraftFieldAction(projectId, path, value);
    if (!result.error && result.merged) {
      // Update local state with the full merged object from the server
      setDraft(result.merged);
    }
    return result;
  }

  const content = (draft.content ?? {}) as Record<string, unknown>;
  const intake = (draft._intake ?? {}) as Record<string, unknown>;
  const preferences = (draft.preferences ?? {}) as Record<string, unknown>;
  const services = Array.isArray(draft.services)
    ? (draft.services as ServiceItem[])
    : [];

  const hasDraft = draftRequest !== null;

  return (
    <>
      {/* Basics */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <FieldInput
            label="Business Type"
            initialValue={project.business_type ?? ""}
            onSave={(v) => saveProjectField("business_type", v)}
          />
          <FieldInput
            label="Contact"
            initialValue={project.contact_name ?? ""}
            onSave={(v) => saveProjectField("contact_name", v)}
          />
          <FieldInput
            label="Email"
            initialValue={project.contact_email ?? ""}
            onSave={(v) => saveProjectField("contact_email", v)}
          />
          <FieldInput
            label="Phone"
            initialValue={project.contact_phone ?? ""}
            onSave={(v) => saveProjectField("contact_phone", v)}
          />
        </div>
        <div
          style={{
            marginTop: "0.75rem",
            paddingTop: "0.5rem",
            borderTop: "1px solid var(--color-border)",
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <span className="text-sm text-muted">
            Slug: <span className="text-mono">{project.slug}</span>
          </span>
          <span className="text-sm text-muted">
            Created: {fmtDate(project.created_at)}
          </span>
          <span className="text-sm text-muted">
            Updated: {fmtDate(project.updated_at)}
          </span>
        </div>
      </div>

      {/* Build textareas */}
      <div className="card">
        <FieldTextarea
          label="Notes / Transcript"
          hint="Raw intake notes, call transcripts, client messages"
          initialValue={project.notes ?? ""}
          rows={8}
          onSave={(v) => saveProjectField("notes", v)}
        />

        {hasDraft && (
          <>
            <div
              style={{
                borderTop: "1px solid var(--color-border)",
                margin: "0.5rem 0 1.5rem",
              }}
            />

            <FieldTextarea
              label="Services"
              hint="One per line. Name \u2014 Description format supported."
              initialValue={servicesToText(services)}
              rows={6}
              onSave={(v) => saveDraftField(["services"], textToServices(v))}
            />

            <FieldTextarea
              label="About / Business Summary"
              hint="Maps to content.about in client-request.json"
              initialValue={(content.about as string) ?? ""}
              rows={4}
              onSave={(v) =>
                saveDraftField(["content", "about"], v || undefined)
              }
            />

            <FieldTextarea
              label="Branding & Style Direction"
              hint="Colors, fonts, mood, competitor references"
              initialValue={(intake.branding as string) ?? ""}
              rows={3}
              onSave={(v) =>
                saveDraftField(["_intake", "branding"], v || undefined)
              }
            />

            <FieldInput
              label="Primary Brand Color"
              initialValue={String(((preferences.branding as Record<string, unknown> | undefined)?.primaryColor as string) ?? "")}
              onSave={(v) =>
                saveDraftField(["preferences", "branding", "primaryColor"], v || undefined)
              }
            />

            <FieldInput
              label="Secondary Brand Color"
              initialValue={String(((preferences.branding as Record<string, unknown> | undefined)?.secondaryColor as string) ?? "")}
              onSave={(v) =>
                saveDraftField(["preferences", "branding", "secondaryColor"], v || undefined)
              }
            />

            <FieldInput
              label="Accent Color"
              initialValue={String(((preferences.branding as Record<string, unknown> | undefined)?.accentColor as string) ?? "")}
              onSave={(v) =>
                saveDraftField(["preferences", "branding", "accentColor"], v || undefined)
              }
            />

            <FieldInput
              label="Google Font Family"
              initialValue={String(((preferences.branding as Record<string, unknown> | undefined)?.googleFontFamily as string) ?? "")}
              onSave={(v) =>
                saveDraftField(["preferences", "branding", "googleFontFamily"], v || undefined)
              }
            />

            <FieldTextarea
              label="Target Customer"
              hint="Who is this site for?"
              initialValue={(intake.targetCustomer as string) ?? ""}
              rows={3}
              onSave={(v) =>
                saveDraftField(["_intake", "targetCustomer"], v || undefined)
              }
            />

            <FieldTextarea
              label="Goals & CTA"
              hint="What should the site accomplish? Primary call to action?"
              initialValue={(intake.goals as string) ?? ""}
              rows={3}
              onSave={(v) =>
                saveDraftField(["_intake", "goals"], v || undefined)
              }
            />

            <FieldTextarea
              label="Service Area / Locations"
              hint="Geographic coverage, cities, regions"
              initialValue={(intake.serviceArea as string) ?? ""}
              rows={3}
              onSave={(v) =>
                saveDraftField(["_intake", "serviceArea"], v || undefined)
              }
            />

            <FieldTextarea
              label="AI / Build Notes"
              hint="Instructions for generator or AI review"
              initialValue={(preferences.notes as string) ?? ""}
              rows={3}
              onSave={(v) =>
                saveDraftField(["preferences", "notes"], v || undefined)
              }
            />
          </>
        )}
      </div>
    </>
  );
}

// ── Summary Editor ────────────────────────────────────────────────────

export function SummaryEditor({
  projectId,
  summary,
}: {
  projectId: string;
  summary: string;
}) {
  const [text, setText] = useState(summary);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [isPending, startTransition] = useTransition();

  const dirty = text !== summary;

  function save() {
    setStatus("saving");
    startTransition(async () => {
      const result = await updateProjectAction(projectId, {
        client_summary: text || null,
      });
      setStatus(result.error ? "error" : "saved");
    });
  }

  return (
    <div className="card">
      <textarea
        className="form-input"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          lineHeight: 1.6,
          minHeight: "200px",
        }}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus("idle");
        }}
      />
      {(dirty || status === "saved" || status === "error") && (
        <div className="responsive-actions" style={{ marginTop: "0.35rem" }}>
          {dirty && (
            <button
              className="btn btn-sm btn-primary"
              onClick={save}
              disabled={isPending}
            >
              {isPending ? "Saving..." : "Save Summary"}
            </button>
          )}
          {status === "saved" && !dirty && (
            <span className="text-sm" style={{ color: "var(--color-success)" }}>
              Saved
            </span>
          )}
          {status === "error" && (
            <span className="text-sm" style={{ color: "var(--color-error)" }}>
              Save failed
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── File management ───────────────────────────────────────────────────

function categoryIcon(category: string): string {
  switch (category) {
    case "image":
      return "[img]";
    case "audio":
      return "[audio]";
    case "document":
      return "[doc]";
    default:
      return "[file]";
  }
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileManager({
  assets,
  projectId,
}: {
  assets: Array<{
    id: string;
    file_name: string;
    file_type: string;
    file_size: number | null;
    storage_path: string;
    category: string;
    created_at: string;
  }>;
  projectId: string;
}) {
  return (
    <div className="card">
      <div className="scroll-shell">
        <table className="info-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th style={{ width: "100px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <FileRow key={asset.id} asset={asset} projectId={projectId} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FileRow({
  asset,
  projectId,
}: {
  asset: {
    id: string;
    file_name: string;
    file_type: string;
    file_size: number | null;
    storage_path: string;
    category: string;
    created_at: string;
  };
  projectId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [deleted, setDeleted] = useState(false);

  function handleView() {
    startTransition(async () => {
      const result = await getAssetUrlAction(asset.id, asset.storage_path);
      if (result.url) {
        window.open(result.url, "_blank");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Delete ${asset.file_name}?`)) return;
    startTransition(async () => {
      const result = await deleteAssetAction(
        asset.id,
        projectId,
        asset.storage_path,
      );
      if (!result.error) setDeleted(true);
    });
  }

  if (deleted) return null;

  return (
    <tr>
      <td>
        <span style={{ marginRight: "0.5rem", opacity: 0.5 }}>
          {categoryIcon(asset.category)}
        </span>
        <span className="text-mono" style={{ fontSize: "0.8rem" }}>
          {asset.file_name}
        </span>
      </td>
      <td className="text-sm text-muted">{asset.category}</td>
      <td className="text-sm text-muted">{formatSize(asset.file_size)}</td>
      <td className="text-sm text-muted">{fmtDate(asset.created_at)}</td>
      <td>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          <button
            className="btn btn-sm"
            style={{ padding: "0.1rem 0.4rem", fontSize: "0.7rem" }}
            onClick={handleView}
            disabled={isPending}
          >
            view
          </button>
          <button
            className="btn btn-sm"
            style={{
              padding: "0.1rem 0.4rem",
              fontSize: "0.7rem",
              color: "var(--color-error)",
            }}
            onClick={handleDelete}
            disabled={isPending}
          >
            remove
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── File uploader (add files to existing project) ────────────────────

export function FileUploader({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const files = formData.getAll("files") as File[];
    if (files.length === 0 || !files[0]?.size) return;

    startTransition(async () => {
      const res = await uploadAssetsAction(projectId, formData);
      if (res.error) {
        setResult(`Error: ${res.error}`);
      } else {
        setResult(`Uploaded ${res.uploaded} file(s)`);
        (e.target as HTMLFormElement).reset();
        setTimeout(() => window.location.reload(), 500);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <input
        type="file"
        name="files"
        multiple
        accept="image/*,audio/*,.pdf,.txt,.doc,.docx"
        style={{ fontSize: "0.8rem" }}
      />
      <button className="btn btn-sm" type="submit" disabled={isPending}>
        {isPending ? "Uploading..." : "Add Files"}
      </button>
      {result && <span className="text-sm text-muted">{result}</span>}
    </form>
  );
}

// ── Revision asset attachment ────────────────────────────────────────

export function RevisionAssetManager({
  currentRevisionId,
  assets,
}: {
  currentRevisionId: string | null;
  assets: Array<{
    id: string;
    file_name: string;
    category: string;
  }>;
}) {
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Load attached assets on mount
  useEffect(() => {
    if (!currentRevisionId) return;
    listRevisionAssetsAction(currentRevisionId).then(({ assets: revAssets }) => {
      setAttachedIds(new Set(revAssets.map((a) => a.asset_id)));
      setLoaded(true);
    });
  }, [currentRevisionId]);

  if (!currentRevisionId) {
    return <p className="text-sm text-muted">No active version selected.</p>;
  }

  const imageAssets = assets.filter((a) => a.category === "image");
  if (imageAssets.length === 0) {
    return <p className="text-sm text-muted">No images uploaded. Add files above first.</p>;
  }

  function toggleAttachment(assetId: string) {
    const isAttached = attachedIds.has(assetId);
    startTransition(async () => {
      if (isAttached) {
        await detachAssetFromRevisionAction(currentRevisionId!, assetId);
        setAttachedIds((prev) => { const next = new Set(prev); next.delete(assetId); return next; });
      } else {
        await attachAssetToRevisionAction(currentRevisionId!, assetId, "gallery");
        setAttachedIds((prev) => new Set(prev).add(assetId));
      }
    });
  }

  return (
    <div>
      <p className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
        Check which images to include when generating this version.
        {!loaded && " Loading..."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {imageAssets.map((asset) => {
          const isAttached = attachedIds.has(asset.id);
          return (
            <label
              key={asset.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.35rem 0.5rem",
                borderRadius: "4px",
                background: isAttached ? "var(--color-bg-accent, #f0f9ff)" : undefined,
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              <input
                type="checkbox"
                checked={isAttached}
                onChange={() => toggleAttachment(asset.id)}
                disabled={isPending}
              />
              <span style={{ opacity: 0.5 }}>{categoryIcon(asset.category)}</span>
              <span>{asset.file_name}</span>
              <span className="text-sm text-muted" style={{ marginLeft: "auto" }}>
                {isAttached ? "Attached" : ""}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Draft request JSON editor ─────────────────────────────────────────

export function DraftRequestEditor({
  projectId,
  draftRequest,
}: {
  projectId: string;
  draftRequest: Record<string, unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(JSON.stringify(draftRequest, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setError("Invalid JSON");
      return;
    }
    // Client-side pre-validation: warn if required fields are missing
    const requiredKeys = ["version", "business", "contact"];
    const missing = requiredKeys.filter((k) => !(k in parsed));
    if (missing.length > 0) {
      setError(
        `Missing required fields: ${missing.join(", ")}. These are needed for generation. The server will attempt to restore defaults, but you should include them.`,
      );
      // Don't block save — the server-side merge will fill in defaults
    }
    startTransition(async () => {
      const result = await updateDraftRequestAction(projectId, parsed);
      if (result.error) {
        setError(result.error);
      } else {
        setEditing(false);
        setError(null);
      }
    });
  }

  if (editing) {
    return (
      <div className="card">
        <textarea
          className="form-input text-mono"
          style={{ fontSize: "0.8rem", lineHeight: 1.5, minHeight: "300px" }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {error && (
          <p
            className="text-sm"
            style={{ color: "var(--color-error)", marginTop: "0.35rem" }}
          >
            {error}
          </p>
        )}
        <div
          style={{
            display: "flex",
            gap: "0.35rem",
            marginTop: "0.5rem",
          }}
        >
          <button
            className="btn btn-sm btn-primary"
            onClick={save}
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save JSON"}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              setDraft(JSON.stringify(draftRequest, null, 2));
              setError(null);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: "0.5rem",
        }}
      >
        <button
          className="btn btn-sm"
          style={{ padding: "0.1rem 0.4rem", fontSize: "0.7rem" }}
          onClick={() => setEditing(true)}
        >
          edit JSON
        </button>
      </div>
      <pre
        className="mobile-code-block"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.8rem",
          lineHeight: 1.5,
          maxHeight: "400px",
        }}
      >
        {JSON.stringify(draftRequest, null, 2)}
      </pre>
    </div>
  );
}
