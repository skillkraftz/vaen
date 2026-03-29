import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildPendingProspectEnrichmentRecord,
  buildProspectEnrichmentRecord,
  inferMissingPieces,
  selectPreferredProspectEnrichment,
} from "./prospect-enrichment";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("prospect enrichment schema", () => {
  it("adds prospect enrichment persistence", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000021_create_prospect_enrichments.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.prospect_enrichments");
    expect(source).toContain("business_summary text");
    expect(source).toContain("recommended_package text");
    expect(source).toContain("opportunity_summary text");
    expect(source).toContain("missing_pieces jsonb");
    expect(source).toContain("offer_positioning text");
    expect(source).toContain("precreated_copy jsonb");
  });

  it("adds generation status fields for async-capable enrichment sources", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000022_add_prospect_enrichment_generation_fields.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("add column if not exists status text");
    expect(source).toContain("add column if not exists source_job_id uuid");
    expect(source).toContain("add column if not exists error_message text");
  });

  it("adds ProspectEnrichment type", () => {
    const typesPath = join(__dirname, "types.ts");
    const source = readFileSync(typesPath, "utf-8");
    expect(source).toContain("export interface ProspectEnrichment");
  });
});

describe("prospect enrichment helpers", () => {
  it("flags clear missing pieces from sparse prospect and site analysis data", () => {
    const missing = inferMissingPieces({
      prospect: {
        contact_name: null,
        contact_email: null,
        contact_phone: null,
      },
      analysis: {
        meta_description: null,
        primary_h1: null,
        structured_output: {},
      },
    });

    expect(missing).toContain("Decision-maker or primary contact name is missing.");
    expect(missing).toContain("No clear email capture path is visible yet.");
    expect(missing).toContain("No obvious phone-first conversion path is visible yet.");
    expect(missing).toContain("Homepage headline/value proposition needs clarification.");
  });

  it("builds reusable sales enrichment from raw prospect context", () => {
    const enrichment = buildProspectEnrichmentRecord({
      prospect: {
        id: "pros-1",
        user_id: "user-1",
        company_name: "Acme Painting",
        website_url: "https://acme.test",
        contact_name: "Alex",
        contact_email: "alex@acme.test",
        contact_phone: null,
        notes: null,
        status: "ready_for_outreach",
        source: null,
        campaign: null,
        outreach_summary: "The site needs a clearer value proposition.",
        outreach_status: "ready",
        metadata: {},
        converted_client_id: null,
        converted_project_id: null,
        created_at: "",
        updated_at: "",
      },
      analysis: {
        id: "analysis-1",
        prospect_id: "pros-1",
        status: "completed",
        analysis_source: "server_fetch",
        site_title: "Acme Painting",
        meta_description: "Exterior painting specialists",
        primary_h1: "Refresh your home exterior",
        content_excerpt: "Exterior painting specialists with dated calls to action.",
        structured_output: {},
        raw_html_excerpt: null,
        error_message: null,
        created_at: "",
      },
      project: null,
      quote: null,
    });

    expect(enrichment.source).toBe("heuristic_v1");
    expect(enrichment.business_summary).toContain("Acme Painting");
    expect(enrichment.recommended_package).toBe("service-core");
    expect(enrichment.opportunity_summary).toContain("headline");
    expect(enrichment.offer_positioning).toContain("Recommended starting package");
    expect(enrichment.precreated_copy).toMatchObject({
      recommended_package: "service-core",
    });
    expect(enrichment.status).toBe("completed");
    expect(enrichment.source_job_id).toBeNull();
    expect(enrichment.metadata).toMatchObject({
      generation_status: "completed",
      generator_version: "heuristic_v1",
      requested_source: "heuristic_v1",
    });
  });

  it("builds pending worker-ready enrichment records without polluting completed outputs", () => {
    const enrichment = buildPendingProspectEnrichmentRecord({
      prospectId: "pros-1",
      source: "worker_job",
      analysisId: "analysis-1",
      projectId: "proj-1",
      quoteId: "quote-1",
      sourceJobId: "job-1",
      note: "Queued for worker execution",
    });

    expect(enrichment.source).toBe("worker_job");
    expect(enrichment.status).toBe("pending");
    expect(enrichment.source_job_id).toBe("job-1");
    expect(enrichment.business_summary).toBeNull();
    expect(enrichment.metadata).toMatchObject({
      analysis_id: "analysis-1",
      project_id: "proj-1",
      quote_id: "quote-1",
      generation_status: "pending",
      requested_source: "worker_job",
    });
  });

  it("prefers the latest completed enrichment over newer pending attempts", () => {
    const preferred = selectPreferredProspectEnrichment([
      {
        id: "pending-1",
        prospect_id: "pros-1",
        source: "worker_job",
        status: "pending",
        source_job_id: "job-1",
        business_summary: null,
        recommended_package: null,
        opportunity_summary: null,
        missing_pieces: [],
        offer_positioning: null,
        precreated_copy: {},
        error_message: null,
        metadata: {},
        created_at: "2026-03-29T10:00:00Z",
        updated_at: "2026-03-29T10:00:00Z",
      },
      {
        id: "completed-1",
        prospect_id: "pros-1",
        source: "heuristic_v1",
        status: "completed",
        source_job_id: null,
        business_summary: "Completed summary",
        recommended_package: "service-core",
        opportunity_summary: "Completed opportunity",
        missing_pieces: [],
        offer_positioning: "Completed positioning",
        precreated_copy: {},
        error_message: null,
        metadata: {},
        created_at: "2026-03-29T09:00:00Z",
        updated_at: "2026-03-29T09:00:00Z",
      },
    ]);

    expect(preferred?.id).toBe("completed-1");
  });
});

describe("prospect enrichment integration", () => {
  it("exposes a generate enrichment action and reuses enrichment in outreach packages", () => {
    const actionsPath = join(__dirname, "../app/dashboard/prospects/actions.ts");
    const outreachPath = join(__dirname, "prospect-outreach.ts");
    const actionsSource = readFileSync(actionsPath, "utf-8");
    const outreachSource = readFileSync(outreachPath, "utf-8");

    expect(actionsSource).toContain("export async function generateProspectEnrichmentAction");
    expect(actionsSource).toContain('from("prospect_enrichments")');
    expect(actionsSource).toContain("buildProspectEnrichmentRecord");
    expect(actionsSource).toContain("buildPendingProspectEnrichmentRecord");
    expect(actionsSource).toContain('source: ProspectEnrichmentSource = "heuristic_v1"');
    expect(actionsSource).toContain('source === "heuristic_v1"');
    expect(actionsSource).toContain("selectPreferredProspectEnrichment");
    expect(actionsSource).toContain("loadLatestProspectEnrichment");
    expect(outreachSource).toContain("enrichment?: ProspectEnrichment | null");
    expect(outreachSource).toContain("params.enrichment?.business_summary");
    expect(outreachSource).toContain("params.enrichment?.offer_positioning");
  });
});
