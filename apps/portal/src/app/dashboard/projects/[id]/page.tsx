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
import { CollapsibleSection } from "./collapsible-section";
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
      <div className="section-header" data-testid="project-header">
        <div>
          <Link href="/dashboard" className="text-sm text-muted">
            &larr; Projects
          </Link>
          <h1 style={{ marginTop: "0.25rem", marginBottom: "0.15rem" }} data-testid="project-name">{p.name}</h1>
          {(p.business_type || p.contact_name) && (
            <p className="text-sm text-muted" style={{ fontSize: "0.8rem" }}>
              {[p.business_type, p.contact_name].filter(Boolean).join(" \u00b7 ")}
            </p>
          )}
        </div>
        <span className={`badge ${statusBadge(p.status)}`} data-testid="project-status-badge">
          {formatStatusLabel(p.status)}
        </span>
      </div>

      {/* ── Progress Indicator ────────────────────────────────────── */}
      <div style={{ marginBottom: "1.5rem" }}>
        <WorkflowStepIndicator status={p.status} />
      </div>

      {/* ── Workflow Panel ────────────────────────────────────────── */}
      {/* Contains: NextStep banner, actions, preview, advanced tools */}
      <div className="section">
        <WorkflowPanel projectId={id} slug={p.slug} status={p.status} lastReviewedRevisionId={p.last_reviewed_revision_id} />
      </div>

      {/* ── Website Plan ────────────────────────────────────────── */}
      {(hasDraft || recommendations || missingInfo.length > 0) && (
        <>
          <div className="section-label" style={{ marginTop: "0.5rem" }}>Website Plan</div>

          {/* Missing info */}
          {missingInfo.length > 0 && (
            <div className="section">
              <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
                Missing Information ({missingInfo.length})
              </h2>
              <div className="card">
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {missingInfo.map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "0.5rem 0",
                        borderBottom: i < missingInfo.length - 1 ? "1px solid var(--color-border)" : "none",
                      }}
                    >
                      <span className={`badge ${severityBadge(item.severity)}`}>
                        {item.severity}
                      </span>
                      <div>
                        <strong style={{ fontSize: "0.875rem" }}>{item.label}</strong>
                        {item.hint && (
                          <p className="text-sm text-muted" style={{ marginTop: "0.15rem" }}>
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

          {/* Summary */}
          {hasDraft && (
            <div className="section">
              <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
                Summary
              </h2>
              <SummaryEditor projectId={id} summary={p.client_summary ?? ""} />
            </div>
          )}

          {/* Recommendations */}
          {recommendations && (
            <div className="section">
              <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
                Recommendations
              </h2>
              <div className="card">
                <table className="info-table">
                  <tbody>
                    <tr>
                      <th>Template</th>
                      <td>
                        <span className="text-mono">{recommendations.template.id}</span>
                        <span className="text-sm text-muted" style={{ marginLeft: "0.5rem" }}>
                          {recommendations.template.reason}
                        </span>
                      </td>
                    </tr>
                    {recommendations.modules.map((mod, i) => (
                      <tr key={i}>
                        <th>{i === 0 ? "Modules" : ""}</th>
                        <td>
                          <span className="text-mono">{mod.id}</span>
                          <span className="text-sm text-muted" style={{ marginLeft: "0.5rem" }}>
                            {mod.reason}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {recommendations.notes && (
                  <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
                    <p className="text-sm text-muted">{recommendations.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Business Details ───────────────────────────────────────── */}
      <div className="section">
        <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
          Business Details
        </h2>
        <BuildInputsEditor projectId={id} project={p} draftRequest={requestData} />
      </div>

      {/* ── Files & Images ──────────────────────────────────────────── */}
      <div className="section">
        <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
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

      {uploadedAssets.some((a) => a.category === "image") && (
        <div className="section">
          <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
            Images for This Version
          </h2>
          <div className="card" style={{ padding: "0.75rem 1rem" }}>
            <RevisionAssetManager currentRevisionId={p.current_revision_id} assets={uploadedAssets} />
          </div>
        </div>
      )}

      {/* ── History & Diagnostics (collapsible) ──────────────────── */}
      <div className="section">
        <CollapsibleSection title="History & Diagnostics" testId="history-diagnostics-section">
          {/* Version Tracking */}
          <div data-testid="version-tracking" style={{ marginBottom: "1.5rem" }}>
            <h3 className="mb-1" style={{ fontSize: "0.95rem", fontWeight: 600 }}>
              Version Tracking
            </h3>
            <div className="card" style={{ padding: "0.75rem 1rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
                <div>
                  <strong>Active Version:</strong>{" "}
                  {p.current_revision_id
                    ? <span className="text-mono" style={{ fontSize: "0.8rem" }}>{p.current_revision_id.slice(0, 8)}</span>
                    : <span className="text-muted">None yet</span>}
                </div>
                <div>
                  <strong>Content Prepared:</strong>{" "}
                  {p.last_exported_revision_id
                    ? (p.last_exported_revision_id === p.current_revision_id
                        ? <span style={{ color: "var(--color-success)" }}>Up to date</span>
                        : <span style={{ color: "var(--color-warning, #b45309)" }}>Outdated</span>)
                    : <span className="text-muted">Not yet</span>}
                </div>
                <div>
                  <strong>Website Built:</strong>{" "}
                  {p.last_generated_revision_id
                    ? (p.last_generated_revision_id === p.current_revision_id
                        ? <span style={{ color: "var(--color-success)" }}>Up to date</span>
                        : <span style={{ color: "var(--color-warning, #b45309)" }}>Outdated — rebuild needed</span>)
                    : <span className="text-muted">Not yet</span>}
                </div>
                <div>
                  <strong>Preview Created:</strong>{" "}
                  {p.last_reviewed_revision_id
                    ? (p.last_reviewed_revision_id === p.current_revision_id
                        ? <span style={{ color: "var(--color-success)" }}>Up to date</span>
                        : <span style={{ color: "var(--color-warning, #b45309)" }}>Outdated — screenshots may not match</span>)
                    : <span className="text-muted">Not yet</span>}
                </div>
              </div>
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <RevisionList projectId={id} project={p} />
            </div>
          </div>

          {/* Request Data */}
          {requestData && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 className="mb-1" style={{ fontSize: "0.95rem", fontWeight: 600 }}>
                Request Data (JSON)
              </h3>
              <DraftRequestEditor projectId={id} draftRequest={requestData} />
            </div>
          )}

          {/* Activity Log */}
          <div data-testid="activity-log">
            <h3 className="mb-1" style={{ fontSize: "0.95rem", fontWeight: 600 }}>
              Activity Log
            </h3>
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
                      <strong>{event.event_type.replace(/_/g, " ")}</strong>
                      {event.to_status && (
                        <span className="text-muted">
                          {" "}&rarr; {formatStatusLabel(event.to_status)}
                        </span>
                      )}
                    </span>
                    <span className="text-muted">{fmtDate(event.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleSection>
      </div>
    </>
  );
}
