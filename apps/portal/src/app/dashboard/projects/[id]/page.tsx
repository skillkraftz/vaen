import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Project, Asset, ProjectEvent, MissingInfoItem, IntakeRecommendations } from "@/lib/types";
import {
  ProcessIntakeButton,
  ApproveIntakeButton,
  RequestRevisionButton,
  CustomQuoteButton,
  ExportToGeneratorButton,
} from "./intake-actions";

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

  const canProcess = p.status === "intake_received" || p.status === "intake_needs_revision";
  const canApprove = p.status === "intake_draft_ready";
  const canRevise = p.status === "intake_draft_ready" || p.status === "custom_quote_required";
  const canQuote = p.status === "intake_draft_ready";
  const canExport = p.status === "intake_approved";
  const hasDraft = !!p.client_summary;

  return (
    <>
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

      {/* Actions bar */}
      {(canProcess || canApprove || canExport) && (
        <div className="section">
          <div className="card" style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            {canProcess && <ProcessIntakeButton projectId={id} />}
            {canApprove && <ApproveIntakeButton projectId={id} />}
            {canRevise && <RequestRevisionButton projectId={id} />}
            {canQuote && <CustomQuoteButton projectId={id} />}
            {canExport && <ExportToGeneratorButton projectId={id} />}
          </div>
        </div>
      )}

      {/* Revision-only actions (when only revise is available) */}
      {!canProcess && !canApprove && !canExport && canRevise && (
        <div className="section">
          <div className="card" style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <RequestRevisionButton projectId={id} />
          </div>
        </div>
      )}

      {/* Client Summary */}
      {hasDraft && (
        <div className="section">
          <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
            Client Summary
          </h2>
          <div className="card">
            <pre style={{
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-sans)",
              fontSize: "0.875rem",
              lineHeight: 1.6,
            }}>
              {p.client_summary}
            </pre>
          </div>
        </div>
      )}

      {/* Missing Info */}
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
                      <p className="text-sm text-muted" style={{ marginTop: "0.15rem" }}>{item.hint}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
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

      {/* Draft Request */}
      {p.draft_request && (
        <div className="section">
          <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
            Draft client-request.json
          </h2>
          <div className="card">
            <pre style={{
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              lineHeight: 1.5,
              maxHeight: "400px",
              overflow: "auto",
            }}>
              {JSON.stringify(p.draft_request, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Project info */}
      <div className="section">
        <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
          Details
        </h2>
        <div className="card">
          <table className="info-table">
            <tbody>
              <tr>
                <th>Slug</th>
                <td className="text-mono">{p.slug}</td>
              </tr>
              {p.business_type && (
                <tr>
                  <th>Business type</th>
                  <td>{p.business_type}</td>
                </tr>
              )}
              {p.contact_name && (
                <tr>
                  <th>Contact</th>
                  <td>{p.contact_name}</td>
                </tr>
              )}
              {p.contact_email && (
                <tr>
                  <th>Email</th>
                  <td>{p.contact_email}</td>
                </tr>
              )}
              {p.contact_phone && (
                <tr>
                  <th>Phone</th>
                  <td>{p.contact_phone}</td>
                </tr>
              )}
              <tr>
                <th>Created</th>
                <td>{formatDate(p.created_at)}</td>
              </tr>
              <tr>
                <th>Updated</th>
                <td>{formatDate(p.updated_at)}</td>
              </tr>
            </tbody>
          </table>

          {p.notes && (
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--color-border)" }}>
              <p className="text-sm text-muted mb-1">Notes</p>
              <p style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>{p.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Assets */}
      <div className="section">
        <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
          Uploaded Files ({assetList.length})
        </h2>
        {assetList.length === 0 ? (
          <p className="text-sm text-muted">No files uploaded.</p>
        ) : (
          <div className="card">
            <table className="info-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {assetList.map((asset) => (
                  <tr key={asset.id}>
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
                    <td className="text-sm text-muted">{formatDate(asset.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event log */}
      <div className="section">
        <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
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
                  <strong>{event.event_type.replace(/_/g, " ")}</strong>
                  {event.to_status && (
                    <span className="text-muted">
                      {" "}
                      &rarr; {event.to_status.replace(/_/g, " ")}
                    </span>
                  )}
                </span>
                <span className="text-muted">{formatDate(event.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
