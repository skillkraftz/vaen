import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type {
  Project,
  Asset,
  ProjectEvent,
  MissingInfoItem,
  IntakeRecommendations,
} from "@/lib/types";
import { detectMissingInfo } from "@/lib/intake-processor";
import { WorkflowPanel } from "./intake-actions";
import { WorkflowStepIndicator } from "./workflow-steps";
import { RevisionList } from "./revision-list";
import {
  BuildInputsEditor,
  SummaryEditor,
  FileManager,
  FileUploader,
  RevisionAssetManager,
  DraftRequestEditor,
} from "./project-editor";
import { formatStatusLabel } from "@/lib/workflow-steps";

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
    workspace_generated: "badge-green",
    build_in_progress: "badge-yellow",
    build_failed: "badge-red",
    review_ready: "badge-green",
    deploy_ready: "badge-green",
    deployed: "badge-green",
  };
  return map[status] ?? "";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function severityBadge(severity: string): string {
  switch (severity) {
    case "required":
      return "badge-red";
    case "recommended":
      return "badge-yellow";
    default:
      return "";
  }
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (!project) notFound();

  const p = project as Project;

  const { data: assets } = await supabase
    .from("assets")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

  const { data: events } = await supabase
    .from("project_events")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  const assetList = (assets ?? []) as Asset[];
  const eventList = (events ?? []) as ProjectEvent[];
  // Compute missing info live from current project + assets (not stale DB cache)
  const missingInfo = detectMissingInfo(p, assetList);
  const recommendations = p.recommendations as IntakeRecommendations | null;

  // Load request data from active revision (single source of truth)
  let requestData: Record<string, unknown> | null = null;
  if (p.current_revision_id) {
    const { data: rev } = await supabase
      .from("project_request_revisions")
      .select("request_data")
      .eq("id", p.current_revision_id)
      .single();
    requestData = (rev?.request_data as Record<string, unknown>) ?? null;
  }
  // Legacy fallback for pre-migration projects
  if (!requestData) {
    requestData = (p.draft_request ?? null) as Record<string, unknown> | null;
  }

  const uploadedAssets = assetList.filter(
    (a) => (a as { asset_type?: string }).asset_type !== "review_screenshot",
  );
  const hasDraft = !!p.client_summary;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="section-header">
        <div>
          <Link href="/dashboard" className="text-sm text-muted">
            &larr; Projects
          </Link>
          <h1 style={{ marginTop: "0.25rem" }}>{p.name}</h1>
        </div>
        <span className={`badge ${statusBadge(p.status)}`}>
          {formatStatusLabel(p.status)}
        </span>
      </div>

      {/* ── Workflow Step Indicator ────────────────────────────────── */}
      <div className="section">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <WorkflowStepIndicator status={p.status} />
        </div>
      </div>

      {/* ── Workflow Panel (always visible) ─────────────────────────── */}
      <div className="section">
        <WorkflowPanel projectId={id} slug={p.slug} status={p.status} lastReviewedRevisionId={p.last_reviewed_revision_id} />
      </div>

      {/* ── Version Tracking ─────────────────────────────────────── */}
      <div className="section">
        <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
          Version Tracking
        </h2>
        <div className="card" style={{ padding: "0.75rem 1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
            <div>
              <strong>Active Version:</strong>{" "}
              {p.current_revision_id
                ? <span className="text-mono" style={{ fontSize: "0.8rem" }}>{p.current_revision_id.slice(0, 8)}</span>
                : <span className="text-muted">None yet</span>}
            </div>
            <div>
              <strong>Last Exported:</strong>{" "}
              {p.last_exported_revision_id
                ? (p.last_exported_revision_id === p.current_revision_id
                    ? <span style={{ color: "var(--color-success)" }}>Up to date</span>
                    : <span style={{ color: "var(--color-warning, #b45309)" }}>Stale — re-export needed</span>)
                : <span className="text-muted">Not yet exported</span>}
            </div>
            <div>
              <strong>Last Generated:</strong>{" "}
              {p.last_generated_revision_id
                ? (p.last_generated_revision_id === p.current_revision_id
                    ? <span style={{ color: "var(--color-success)" }}>Up to date</span>
                    : <span style={{ color: "var(--color-warning, #b45309)" }}>Stale — re-generate needed</span>)
                : <span className="text-muted">Not yet generated</span>}
            </div>
            <div>
              <strong>Last Reviewed:</strong>{" "}
              {p.last_reviewed_revision_id
                ? (p.last_reviewed_revision_id === p.current_revision_id
                    ? <span style={{ color: "var(--color-success)" }}>Up to date</span>
                    : <span style={{ color: "var(--color-warning, #b45309)" }}>Stale — screenshots may not match</span>)
                : <span className="text-muted">Not yet reviewed</span>}
            </div>
          </div>
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <RevisionList projectId={id} project={p} />
        </div>
      </div>

      {/* ── Missing info ───────────────────────────────────────────── */}
      {missingInfo.length > 0 && (
        <div className="section">
          <h2
            className="mb-1"
            style={{ fontSize: "1rem", fontWeight: 600 }}
          >
            Missing Information ({missingInfo.length})
          </h2>
          <div className="card">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              {missingInfo.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem 0",
                    borderBottom:
                      i < missingInfo.length - 1
                        ? "1px solid var(--color-border)"
                        : "none",
                  }}
                >
                  <span
                    className={`badge ${severityBadge(item.severity)}`}
                  >
                    {item.severity}
                  </span>
                  <div>
                    <strong style={{ fontSize: "0.875rem" }}>
                      {item.label}
                    </strong>
                    {item.hint && (
                      <p
                        className="text-sm text-muted"
                        style={{ marginTop: "0.15rem" }}
                      >
                        {item.hint}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Project Details ──────────────────────────────────────────── */}
      <div className="section">
        <h2
          className="mb-1"
          style={{ fontSize: "1rem", fontWeight: 600 }}
        >
          Project Details
        </h2>
        <BuildInputsEditor
          projectId={id}
          project={p}
          draftRequest={requestData}
        />
      </div>

      {/* ── Recommendations ────────────────────────────────────────── */}
      {recommendations && (
        <div className="section">
          <h2
            className="mb-1"
            style={{ fontSize: "1rem", fontWeight: 600 }}
          >
            Recommendations
          </h2>
          <div className="card">
            <table className="info-table">
              <tbody>
                <tr>
                  <th>Template</th>
                  <td>
                    <span className="text-mono">
                      {recommendations.template.id}
                    </span>
                    <span
                      className="text-sm text-muted"
                      style={{ marginLeft: "0.5rem" }}
                    >
                      {recommendations.template.reason}
                    </span>
                  </td>
                </tr>
                {recommendations.modules.map((mod, i) => (
                  <tr key={i}>
                    <th>{i === 0 ? "Modules" : ""}</th>
                    <td>
                      <span className="text-mono">{mod.id}</span>
                      <span
                        className="text-sm text-muted"
                        style={{ marginLeft: "0.5rem" }}
                      >
                        {mod.reason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recommendations.notes && (
              <div
                style={{
                  marginTop: "0.75rem",
                  paddingTop: "0.75rem",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <p className="text-sm text-muted">
                  {recommendations.notes}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Client Summary (editable) ──────────────────────────────── */}
      {hasDraft && (
        <div className="section">
          <h2
            className="mb-1"
            style={{ fontSize: "1rem", fontWeight: 600 }}
          >
            Client Summary
          </h2>
          <SummaryEditor
            projectId={id}
            summary={p.client_summary ?? ""}
          />
        </div>
      )}

      {/* ── Request Data JSON (power user) ─────────────────────────── */}
      {requestData && (
        <div className="section">
          <h2
            className="mb-1"
            style={{ fontSize: "1rem", fontWeight: 600 }}
          >
            Request Data (JSON)
          </h2>
          <DraftRequestEditor projectId={id} draftRequest={requestData} />
        </div>
      )}

      {/* ── Files & Images ───────────────────────────────────────── */}
      <div className="section">
        <h2
          className="mb-1"
          style={{ fontSize: "1rem", fontWeight: 600 }}
        >
          Files & Images
        </h2>
        <div className="card" style={{ padding: "0.75rem 1rem", marginBottom: "0.75rem" }}>
          <FileUploader projectId={id} />
        </div>
        {uploadedAssets.length === 0 ? (
          <p className="text-sm text-muted">No files uploaded yet.</p>
        ) : (
          <FileManager assets={uploadedAssets} projectId={id} />
        )}
      </div>

      {/* ── Images for This Version ──────────────────────────────── */}
      {uploadedAssets.some((a) => a.category === "image") && (
        <div className="section">
          <h2
            className="mb-1"
            style={{ fontSize: "1rem", fontWeight: 600 }}
          >
            Images for This Version
          </h2>
          <div className="card" style={{ padding: "0.75rem 1rem" }}>
            <RevisionAssetManager
              currentRevisionId={p.current_revision_id}
              assets={uploadedAssets}
            />
          </div>
        </div>
      )}

      {/* ── Activity log ───────────────────────────────────────────── */}
      <div className="section">
        <h2
          className="mb-1"
          style={{ fontSize: "1rem", fontWeight: 600 }}
        >
          Activity
        </h2>
        {eventList.length === 0 ? (
          <p className="text-sm text-muted">No events recorded.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {eventList.map((event) => (
              <div
                key={event.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "0.5rem 0",
                  borderBottom: "1px solid var(--color-border)",
                  fontSize: "0.85rem",
                }}
              >
                <span>
                  <strong>
                    {event.event_type.replace(/_/g, " ")}
                  </strong>
                  {event.to_status && (
                    <span className="text-muted">
                      {" "}
                      &rarr; {formatStatusLabel(event.to_status)}
                    </span>
                  )}
                </span>
                <span className="text-muted">
                  {fmtDate(event.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
