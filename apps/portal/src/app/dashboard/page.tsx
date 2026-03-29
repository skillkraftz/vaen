import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Project, Client } from "@/lib/types";
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ archived?: string }>;
}) {
  const supabase = await createClient();
  const params = searchParams ? await searchParams : undefined;
  const showArchived = params?.archived === "1";
  const { data: projects } = await supabase
    .from("projects")
    .select("*, client:clients(id, name)")
    .order("created_at", { ascending: false });

  const items = (projects ?? []) as Array<Project & { client?: Pick<Client, "id" | "name"> | null }>;
  const activeItems = items.filter((project) => project.archived_at == null);
  const archivedItems = items.filter((project) => project.archived_at != null);

  return (
    <>
      <div className="section-header" data-testid="dashboard-header">
        <h1>Projects</h1>
        <Link href="/dashboard/new" className="btn btn-primary" data-testid="new-intake-link">
          + New Intake
        </Link>
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
            <Link
              key={project.id}
              href={`/dashboard/projects/${project.id}`}
              className="card-link"
              data-testid={`project-card-${project.slug}`}
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
                  <span className={`badge ${statusBadge(project.status)}`}>
                    {formatStatusLabel(project.status)}
                  </span>
                  <span className="text-sm text-muted">
                    {formatDate(project.created_at)}
                  </span>
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
          ))}
        </div>
      )}

      {archivedItems.length > 0 && (
        <div className="section" style={{ marginTop: "1.5rem" }}>
          <div className="section-header" style={{ marginBottom: "0.75rem" }}>
            <h2 style={{ fontSize: "1rem" }}>Archived Projects</h2>
            <Link
              href={showArchived ? "/dashboard" : "/dashboard?archived=1"}
              className="btn btn-sm"
              data-testid="archived-projects-toggle"
            >
              {showArchived ? "Hide Archived" : `Show Archived (${archivedItems.length})`}
            </Link>
          </div>

          {showArchived && (
            <div className="flex flex-col gap-1" data-testid="archived-project-list">
              {archivedItems.map((project) => (
                <Link
                  key={project.id}
                  href={`/dashboard/projects/${project.id}`}
                  className="card-link"
                  data-testid={`project-card-${project.slug}`}
                  style={{ opacity: 0.8 }}
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
                      <span className="badge">Archived</span>
                      <span className="text-sm text-muted">
                        {formatDate(project.created_at)}
                      </span>
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
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
