import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Prospect } from "@/lib/types";

function statusLabel(status: Prospect["status"]) {
  return status.replaceAll("_", " ");
}

export default async function ProspectsPage() {
  const supabase = await createClient();
  const { data: prospects } = await supabase
    .from("prospects")
    .select("*")
    .order("created_at", { ascending: false });

  const items = (prospects ?? []) as Prospect[];

  return (
    <div className="section" data-testid="prospect-list-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Prospects</h1>
          <p className="text-sm text-muted">
            Track outreach targets, analyze their current websites, and convert them into real clients and projects.
          </p>
        </div>
        <Link href="/dashboard/prospects/new" className="btn btn-primary" data-testid="new-prospect-link">
          + New Prospect
        </Link>
      </div>

      <div className="card" data-testid="prospect-list">
        {items.length === 0 ? (
          <p className="text-sm text-muted">No prospects yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {items.map((prospect) => (
              <Link
                key={prospect.id}
                href={`/dashboard/prospects/${prospect.id}`}
                className="card-link"
                data-testid={`prospect-card-${prospect.id}`}
                style={{ padding: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "0.75rem" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                  <div>
                    <strong>{prospect.company_name}</strong>
                    <p className="text-sm text-muted">{prospect.website_url}</p>
                    {prospect.outreach_summary && (
                      <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                        {prospect.outreach_summary}
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className="badge">{statusLabel(prospect.status)}</span>
                    <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>
                      {new Date(prospect.created_at).toLocaleDateString("en-US")}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
