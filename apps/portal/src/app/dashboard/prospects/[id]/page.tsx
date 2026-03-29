import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Prospect, ProspectSiteAnalysis, Client, Project } from "@/lib/types";
import { ProspectDetailActions } from "../prospect-detail-actions";

function formatProspectStatus(status: Prospect["status"]) {
  return status.replaceAll("_", " ");
}

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: prospect }, { data: analyses }] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", id).single(),
    supabase.from("prospect_site_analyses").select("*").eq("prospect_id", id).order("created_at", { ascending: false }),
  ]);

  if (!prospect) notFound();

  const p = prospect as Prospect;
  const analysisList = (analyses ?? []) as ProspectSiteAnalysis[];
  const latestAnalysis = analysisList[0] ?? null;

  const [{ data: client }, { data: project }] = await Promise.all([
    p.converted_client_id
      ? supabase.from("clients").select("id, name").eq("id", p.converted_client_id).single()
      : Promise.resolve({ data: null }),
    p.converted_project_id
      ? supabase.from("projects").select("id, name, slug").eq("id", p.converted_project_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const linkedClient = client as Pick<Client, "id" | "name"> | null;
  const linkedProject = project as Pick<Project, "id" | "name" | "slug"> | null;

  return (
    <>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link href="/dashboard/prospects" className="text-sm text-muted">
          &larr; Prospects
        </Link>
      </div>

      <div className="section" data-testid="prospect-detail-page">
        <div className="section-header" style={{ marginBottom: "0.75rem" }}>
          <div>
            <h1 style={{ marginBottom: "0.25rem" }}>{p.company_name}</h1>
            <p className="text-sm text-muted">{p.website_url}</p>
          </div>
          <span className="badge" data-testid="prospect-status-badge">
            {formatProspectStatus(p.status)}
          </span>
        </div>

        <ProspectDetailActions prospect={p} />
      </div>

      <div className="section">
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Prospect Details</h2>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <div><strong>Contact:</strong> {p.contact_name ?? "Unknown"}</div>
            <div><strong>Email:</strong> {p.contact_email ?? "Unknown"}</div>
            <div><strong>Phone:</strong> {p.contact_phone ?? "Unknown"}</div>
            <div><strong>Source:</strong> {p.source ?? "Manual"}</div>
            <div><strong>Campaign:</strong> {p.campaign ?? "None"}</div>
            <div><strong>Outreach Summary:</strong> {p.outreach_summary ?? "Not generated yet"}</div>
            <div><strong>Notes:</strong> {p.notes ?? "None"}</div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card" data-testid="prospect-analysis-panel">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Website Analysis</h2>
          {latestAnalysis ? (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <div><strong>Source:</strong> {latestAnalysis.analysis_source}</div>
              <div><strong>Status:</strong> {latestAnalysis.status}</div>
              <div><strong>Site Title:</strong> {latestAnalysis.site_title ?? "Unknown"}</div>
              <div><strong>Meta Description:</strong> {latestAnalysis.meta_description ?? "Unknown"}</div>
              <div><strong>Primary H1:</strong> {latestAnalysis.primary_h1 ?? "Unknown"}</div>
              <div><strong>Excerpt:</strong> {latestAnalysis.content_excerpt ?? "None"}</div>
              {latestAnalysis.error_message && (
                <div className="text-sm" style={{ color: "var(--color-error)" }}>
                  {latestAnalysis.error_message}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No analysis has been run yet.</p>
          )}
        </div>
      </div>

      <div className="section">
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Conversion Links</h2>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <div>
              <strong>Client:</strong>{" "}
              {linkedClient ? <Link href="/dashboard">{linkedClient.name}</Link> : "Not created yet"}
            </div>
            <div>
              <strong>Project:</strong>{" "}
              {linkedProject ? <Link href={`/dashboard/projects/${linkedProject.id}`}>{linkedProject.name}</Link> : "Not created yet"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
