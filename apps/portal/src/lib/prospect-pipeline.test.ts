import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  analyzeProspectWebsite,
  extractProspectWebsiteSignals,
  normalizeWebsiteUrl,
} from "./prospect-analysis";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("prospect schema", () => {
  it("adds prospects and prospect_site_analyses tables", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000009_create_prospects.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.prospects");
    expect(source).toContain("create table if not exists public.prospect_site_analyses");
    expect(source).toContain("ready_for_outreach");
    expect(source).toContain("converted_client_id");
    expect(source).toContain("converted_project_id");
    expect(source).toContain("source_prospect_id");
  });

  it("adds Prospect and ProspectSiteAnalysis types", () => {
    const typesPath = join(__dirname, "types.ts");
    const source = readFileSync(typesPath, "utf-8");
    expect(source).toContain("export interface Prospect");
    expect(source).toContain("export interface ProspectSiteAnalysis");
    expect(source).toContain('status: "new" | "researching" | "analyzed" | "ready_for_outreach" | "converted" | "disqualified"');
  });
});

describe("prospect analysis helpers", () => {
  it("normalizes website urls", () => {
    expect(normalizeWebsiteUrl("example.com")).toBe("https://example.com");
    expect(normalizeWebsiteUrl("https://vaen.space")).toBe("https://vaen.space");
  });

  it("extracts title, meta description, and h1 from html", () => {
    const signals = extractProspectWebsiteSignals(`
      <html>
        <head>
          <title>Acme Painting</title>
          <meta name="description" content="Exterior painting specialists">
        </head>
        <body>
          <h1>Refresh your home exterior</h1>
          <p>Call us at (555) 222-1111 or hello@acme.test.</p>
        </body>
      </html>
    `);

    expect(signals.title).toBe("Acme Painting");
    expect(signals.metaDescription).toBe("Exterior painting specialists");
    expect(signals.primaryH1).toBe("Refresh your home exterior");
    expect(signals.structuredOutput.emails).toEqual(["hello@acme.test"]);
  });

  it("returns a clear error when no website url is provided", async () => {
    const result = await analyzeProspectWebsite("");
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain("Website URL is required");
  });
});

describe("prospect actions and ui", () => {
  it("exports create, analyze, and convert actions", () => {
    const actionsPath = join(__dirname, "../app/dashboard/prospects/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function createProspectAction");
    expect(source).toContain("export async function analyzeProspectAction");
    expect(source).toContain("export async function convertProspectAction");
    expect(source).toContain("analyzeProspectWebsite");
    expect(source).toContain("createRevisionAndSetCurrent");
    expect(source).toContain("processIntake");
  });

  it("conversion reuses client/project models and records source_prospect_id", () => {
    const actionsPath = join(__dirname, "../app/dashboard/prospects/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const convertFn = source.slice(
      source.indexOf("export async function convertProspectAction"),
    );
    expect(convertFn).toContain('from("clients")');
    expect(convertFn).toContain('from("projects")');
    expect(convertFn).toContain("source_prospect_id: p.id");
    expect(convertFn).toContain('status: "intake_received"');
    expect(convertFn).toContain('status: "intake_draft_ready"');
    expect(convertFn).toContain('event_type: "prospect_converted"');
  });

  it("adds a dedicated prospects area in the dashboard", () => {
    const dashboardPath = join(__dirname, "../app/dashboard/page.tsx");
    const layoutPath = join(__dirname, "../app/dashboard/layout.tsx");
    const prospectsPath = join(__dirname, "../app/dashboard/prospects/page.tsx");
    const newProspectPath = join(__dirname, "../app/dashboard/prospects/new/page.tsx");
    const source = readFileSync(dashboardPath, "utf-8");
    const layoutSource = readFileSync(layoutPath, "utf-8");
    const prospectsSource = readFileSync(prospectsPath, "utf-8");
    const newProspectSource = readFileSync(newProspectPath, "utf-8");
    expect(layoutSource).toContain("/dashboard/prospects");
    expect(source).toContain("dashboard-prospect-section");
    expect(prospectsSource).toContain('data-testid="prospect-list-page"');
    expect(prospectsSource).toContain('data-testid="new-prospect-link"');
    expect(newProspectSource).toContain("ProspectForm");
  });

  it("renders prospect detail actions and analysis panel", () => {
    const detailPath = join(__dirname, "../app/dashboard/prospects/[id]/page.tsx");
    const actionsUiPath = join(__dirname, "../app/dashboard/prospects/prospect-detail-actions.tsx");
    const detailSource = readFileSync(detailPath, "utf-8");
    const actionsSource = readFileSync(actionsUiPath, "utf-8");
    expect(detailSource).toContain('data-testid="prospect-detail-page"');
    expect(detailSource).toContain('data-testid="prospect-analysis-panel"');
    expect(actionsSource).toContain('data-testid="prospect-actions"');
    expect(actionsSource).toContain('data-testid="prospect-analyze-button"');
    expect(actionsSource).toContain('data-testid="prospect-convert-button"');
  });
});
