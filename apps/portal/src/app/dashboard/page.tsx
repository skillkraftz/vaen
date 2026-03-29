import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Project, Client } from "@/lib/types";
import { DashboardProjectList } from "./dashboard-project-list";

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

      <DashboardProjectList
        activeItems={activeItems}
        archivedItems={archivedItems}
        showArchived={showArchived}
      />

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
