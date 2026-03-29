import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Project, Client, Prospect } from "@/lib/types";
import { DashboardProjectList } from "./dashboard-project-list";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ archived?: string }>;
}) {
  const supabase = await createClient();
  const params = searchParams ? await searchParams : undefined;
  const showArchived = params?.archived === "1";
  const [{ data: projects }, { data: prospects }] = await Promise.all([
    supabase
      .from("projects")
      .select("*, client:clients(id, name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("prospects")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const items = (projects ?? []) as Array<Project & { client?: Pick<Client, "id" | "name"> | null }>;
  const recentProspects = (prospects ?? []) as Prospect[];
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

      <DashboardProjectList
        activeItems={activeItems}
        archivedItems={archivedItems}
        showArchived={showArchived}
      />

      <div className="section" data-testid="dashboard-prospect-section" style={{ marginTop: "1.5rem" }}>
        <div className="section-header" style={{ marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1rem" }}>Prospects</h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link href="/dashboard/prospects" className="btn btn-sm" data-testid="prospect-list-link">
              View All
            </Link>
            <Link href="/dashboard/prospects/new" className="btn btn-sm" data-testid="new-prospect-link">
              + New Prospect
            </Link>
          </div>
        </div>
        <div className="card">
          {recentProspects.length === 0 ? (
            <p className="text-sm text-muted">No prospects yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {recentProspects.map((prospect) => (
                <Link
                  key={prospect.id}
                  href={`/dashboard/prospects/${prospect.id}`}
                  className="card-link"
                  data-testid={`dashboard-prospect-${prospect.id}`}
                  style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--color-border)" }}
                >
                  <strong>{prospect.company_name}</strong>
                  <p className="text-sm text-muted">{prospect.website_url}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {archivedItems.length > 0 && !showArchived && (
        <div className="section" style={{ marginTop: "1.5rem" }}>
          <div className="section-header" style={{ marginBottom: "0.75rem" }}>
            <h2 style={{ fontSize: "1rem" }}>Archived Projects</h2>
            <Link
              href="/dashboard?archived=1"
              className="btn btn-sm"
              data-testid="archived-projects-toggle"
            >
              {`Show Archived (${archivedItems.length})`}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
