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
import { WorkflowPanel } from "./intake-actions";
import {
  BuildInputsEditor,
  SummaryEditor,
  FileManager,
  DraftRequestEditor,
} from "./project-editor";

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
  const missingInfo = (p.missing_info ?? []) as MissingInfoItem[];
  const recommendations = p.recommendations as IntakeRecommendations | null;
  const draftRequest = (p.draft_request ?? null) as Record<
    string,
    unknown
  > | null;
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
          {p.status.replace(/_/g, " ")}
        </span>
      </div>

      {/* ── Workflow Panel (always visible) ─────────────────────────── */}
      <div className="section">
        <WorkflowPanel projectId={id} slug={p.slug} status={p.status} />
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

      {/* ── Intake & Build Inputs ──────────────────────────────────── */}
      <div className="section">
        <h2
          className="mb-1"
          style={{ fontSize: "1rem", fontWeight: 600 }}
        >
          Intake & Build Inputs
        </h2>
        <BuildInputsEditor
          projectId={id}
          project={p}
          draftRequest={draftRequest}
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

      {/* ── Draft JSON (power user) ────────────────────────────────── */}
      {draftRequest && (
        <div className="section">
          <h2
            className="mb-1"
            style={{ fontSize: "1rem", fontWeight: 600 }}
          >
            Draft client-request.json
          </h2>
          <DraftRequestEditor projectId={id} draftRequest={draftRequest} />
        </div>
      )}

      {/* ── Files ──────────────────────────────────────────────────── */}
      <div className="section">
        <h2
          className="mb-1"
          style={{ fontSize: "1rem", fontWeight: 600 }}
        >
          Uploaded Files ({assetList.length})
        </h2>
        {assetList.length === 0 ? (
          <p className="text-sm text-muted">No files uploaded.</p>
        ) : (
          <FileManager assets={assetList} projectId={id} />
        )}
      </div>

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
                      &rarr; {event.to_status.replace(/_/g, " ")}
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
