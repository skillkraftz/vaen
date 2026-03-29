import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  analyzeProspectWebsite,
  extractProspectWebsiteSignals,
  normalizeWebsiteUrl,
} from "./prospect-analysis";
import {
  buildOutreachEmailDraft,
  buildOutreachPackageRecord,
  PROSPECT_AUTOMATION_LEVELS,
} from "./prospect-outreach";

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

  it("adds prospect outreach packages", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000010_add_prospect_outreach_packages.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.prospect_outreach_packages");
    expect(source).toContain("email_subject");
    expect(source).toContain("email_body");
    expect(source).toContain("package_data jsonb");
  });

  it("adds Prospect and ProspectSiteAnalysis types", () => {
    const typesPath = join(__dirname, "types.ts");
    const source = readFileSync(typesPath, "utf-8");
    expect(source).toContain("export interface Campaign");
    expect(source).toContain("export interface Prospect");
    expect(source).toContain("export interface ProspectSiteAnalysis");
    expect(source).toContain("export type ProspectAutomationLevel");
    expect(source).toContain("export interface ProspectOutreachPackage");
    expect(source).toContain("export interface OutreachSend");
    expect(source).toContain("campaign_id?: string | null");
    expect(source).toContain('status: "new" | "researching" | "analyzed" | "ready_for_outreach" | "converted" | "disqualified"');
    expect(source).toContain('outreach_status?: "draft" | "ready" | "sent" | "followup_due" | "replied" | "do_not_contact"');
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

describe("prospect outreach helpers", () => {
  it("defines explicit automation levels", () => {
    expect(PROSPECT_AUTOMATION_LEVELS.map((level) => level.id)).toEqual([
      "convert_only",
      "process_intake",
      "export_to_generator",
      "generate_site",
      "review_site",
    ]);
  });

  it("builds resend-ready email drafts", () => {
    const draft = buildOutreachEmailDraft({
      prospect: {
        company_name: "Acme Painting",
        website_url: "https://acme.test",
      },
      analysis: {
        primary_h1: "Refresh your home exterior",
        content_excerpt: "Exterior painting specialists with a dated call to action.",
      },
      recommendedPackage: "service-core",
      pricingSummary: "$1,500 setup / $99 mo",
      screenshotCount: 2,
    });

    expect(draft.subject).toContain("Acme Painting");
    expect(draft.body).toContain("service-core");
    expect(draft.body).toContain("2 review screenshots");
  });

  it("builds outreach packages with quote and screenshot hooks", () => {
    const record = buildOutreachPackageRecord({
      prospect: {
        id: "pros-1",
        user_id: "user-1",
        company_name: "Acme Painting",
        website_url: "https://acme.test",
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        notes: null,
        status: "ready_for_outreach",
        source: null,
        campaign: null,
        outreach_summary: null,
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
        meta_description: null,
        primary_h1: "Refresh your home exterior",
        content_excerpt: "Exterior painting specialists",
        structured_output: {},
        raw_html_excerpt: null,
        error_message: null,
        created_at: "",
      },
      project: null,
      quote: null,
      screenshotCount: 1,
      screenshotPaths: ["review-screenshots/path/homepage.png"],
      latestJobStatus: "completed",
      automationLevel: "review_site",
    });

    expect(record.status).toBe("ready");
    expect(record.packageData.screenshots).toEqual({
      count: 1,
      paths: ["review-screenshots/path/homepage.png"],
      available: true,
    });
    expect(record.emailSubject).toContain("Acme Painting");
  });
});

describe("prospect actions and ui", () => {
  it("exports create, analyze, convert, automation, outreach package, and send actions", () => {
    const actionsPath = join(__dirname, "../app/dashboard/prospects/actions.ts");
    const campaignActionsPath = join(__dirname, "../app/dashboard/campaigns/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const campaignSource = readFileSync(campaignActionsPath, "utf-8");
    expect(source).toContain("export async function createProspectAction");
    expect(source).toContain("export async function analyzeProspectAction");
    expect(source).toContain("export async function convertProspectAction");
    expect(source).toContain("export async function continueProspectAutomationAction");
    expect(source).toContain("export async function generateOutreachPackageAction");
    expect(source).toContain("export async function prepareProspectEmailDraftAction");
    expect(source).toContain("export async function sendProspectOutreachAction");
    expect(source).toContain("analyzeProspectWebsite");
    expect(source).toContain("createRevisionAndSetCurrent");
    expect(source).toContain("processIntakeAction");
    expect(source).toContain("generateSiteAction");
    expect(source).toContain("runReviewAction");
    expect(source).toContain("sendEmailViaResend");
    expect(campaignSource).toContain("export async function createCampaignAction");
    expect(campaignSource).toContain("export async function assignProspectsToCampaignAction");
    expect(campaignSource).toContain("export async function importProspectsAction");
    expect(campaignSource).toContain("export async function batchGenerateCampaignPackagesAction");
    expect(campaignSource).toContain("export async function batchSendCampaignOutreachAction");
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
    expect(convertFn).toContain('event_type: "prospect_converted"');
    expect(convertFn).toContain("runProspectAutomationLevel");
  });

  it("supports explicit automation levels and stops cleanly at async job boundaries", () => {
    const actionsPath = join(__dirname, "../app/dashboard/prospects/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain('params.level === "convert_only"');
    expect(source).toContain('params.level === "process_intake"');
    expect(source).toContain('params.level === "export_to_generator"');
    expect(source).toContain('params.level === "generate_site"');
    expect(source).toContain("Generate job dispatched. Review automation is waiting for site generation to complete.");
  });

  it("uses the outreach package as the send source of truth and records send history", () => {
    const actionsPath = join(__dirname, "../app/dashboard/prospects/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const sendFn = source.slice(
      source.indexOf("export async function sendProspectOutreachAction"),
    );
    expect(sendFn).toContain('from("prospect_outreach_packages")');
    expect(sendFn).toContain('from("outreach_sends")');
    expect(sendFn).toContain("campaign_id: p.campaign_id ?? null");
    expect(sendFn).toContain("getProspectSendReadiness");
    expect(sendFn).toContain("getOutreachConfigReadiness");
    expect(sendFn).toContain("isDuplicateSendBlocked");
    expect(sendFn).toContain('status: "blocked"');
    expect(sendFn).toContain('status: "sent"');
    expect(sendFn).toContain('outreach_status: "sent"');
    expect(sendFn).toContain("computeNextFollowUpDate");
  });

  it("adds a dedicated prospects area in the dashboard", () => {
    const dashboardPath = join(__dirname, "../app/dashboard/page.tsx");
    const layoutPath = join(__dirname, "../app/dashboard/layout.tsx");
    const campaignsPagePath = join(__dirname, "../app/dashboard/campaigns/page.tsx");
    const campaignsDetailPath = join(__dirname, "../app/dashboard/campaigns/[id]/page.tsx");
    const campaignsListUiPath = join(__dirname, "../app/dashboard/campaigns/campaign-list-manager.tsx");
    const campaignsDetailUiPath = join(__dirname, "../app/dashboard/campaigns/[id]/campaign-detail-manager.tsx");
    const outreachSettingsPath = join(__dirname, "../app/dashboard/settings/outreach/page.tsx");
    const prospectsPath = join(__dirname, "../app/dashboard/prospects/page.tsx");
    const prospectsListUiPath = join(__dirname, "../app/dashboard/prospects/prospect-list-manager.tsx");
    const importPagePath = join(__dirname, "../app/dashboard/prospects/import/page.tsx");
    const newProspectPath = join(__dirname, "../app/dashboard/prospects/new/page.tsx");
    const source = readFileSync(dashboardPath, "utf-8");
    const layoutSource = readFileSync(layoutPath, "utf-8");
    const campaignsPageSource = readFileSync(campaignsPagePath, "utf-8");
    const campaignsDetailSource = readFileSync(campaignsDetailPath, "utf-8");
    const campaignsListUiSource = readFileSync(campaignsListUiPath, "utf-8");
    const campaignsDetailUiSource = readFileSync(campaignsDetailUiPath, "utf-8");
    const outreachSettingsSource = readFileSync(outreachSettingsPath, "utf-8");
    const prospectsSource = readFileSync(prospectsPath, "utf-8");
    const prospectsListUiSource = readFileSync(prospectsListUiPath, "utf-8");
    const importPageSource = readFileSync(importPagePath, "utf-8");
    const newProspectSource = readFileSync(newProspectPath, "utf-8");
    expect(layoutSource).toContain("/dashboard/prospects");
    expect(layoutSource).toContain("/dashboard/campaigns");
    expect(layoutSource).toContain("/dashboard/settings/outreach");
    expect(campaignsPageSource).toContain("CampaignListManager");
    expect(campaignsListUiSource).toContain('data-testid="campaign-list-page"');
    expect(campaignsDetailSource).toContain("CampaignDetailManager");
    expect(campaignsDetailUiSource).toContain('data-testid="campaign-detail-page"');
    expect(outreachSettingsSource).toContain('data-testid="outreach-settings-page"');
    expect(outreachSettingsSource).toContain('data-testid="outreach-readiness-badge"');
    expect(source).toContain("dashboard-prospect-section");
    expect(prospectsSource).toContain("ProspectListManager");
    expect(prospectsListUiSource).toContain('data-testid="prospect-list-page"');
    expect(prospectsListUiSource).toContain('data-testid="new-prospect-link"');
    expect(importPageSource).toContain("ProspectImportForm");
    expect(newProspectSource).toContain("ProspectForm");
  });

  it("renders prospect detail actions, readiness, outreach package, and send history panels", () => {
    const detailPath = join(__dirname, "../app/dashboard/prospects/[id]/page.tsx");
    const actionsUiPath = join(__dirname, "../app/dashboard/prospects/prospect-detail-actions.tsx");
    const campaignDetailUiPath = join(__dirname, "../app/dashboard/campaigns/[id]/campaign-detail-manager.tsx");
    const listUiPath = join(__dirname, "../app/dashboard/prospects/prospect-list-manager.tsx");
    const importUiPath = join(__dirname, "../app/dashboard/prospects/import/prospect-import-form.tsx");
    const detailSource = readFileSync(detailPath, "utf-8");
    const actionsSource = readFileSync(actionsUiPath, "utf-8");
    const campaignDetailUiSource = readFileSync(campaignDetailUiPath, "utf-8");
    const listUiSource = readFileSync(listUiPath, "utf-8");
    const importUiSource = readFileSync(importUiPath, "utf-8");
    expect(detailSource).toContain('data-testid="prospect-detail-page"');
    expect(detailSource).toContain('data-testid="prospect-analysis-panel"');
    expect(detailSource).toContain('data-testid="prospect-readiness-panel"');
    expect(detailSource).toContain('data-testid="prospect-outreach-package"');
    expect(detailSource).toContain('data-testid="prospect-send-history"');
    expect(detailSource).toContain('data-testid="prospect-email-subject"');
    expect(detailSource).toContain('data-testid="prospect-email-body"');
    expect(detailSource).toContain("/dashboard/settings/outreach");
    expect(actionsSource).toContain('data-testid="prospect-actions"');
    expect(actionsSource).toContain('data-testid="prospect-analyze-button"');
    expect(actionsSource).toContain('data-testid="prospect-convert-button"');
    expect(actionsSource).toContain('data-testid="prospect-automation-level"');
    expect(actionsSource).toContain('data-testid="prospect-continue-automation-button"');
    expect(actionsSource).toContain('data-testid="prospect-generate-package-button"');
    expect(actionsSource).toContain('data-testid="prospect-preview-email-button"');
    expect(actionsSource).toContain('data-testid="prospect-send-confirm"');
    expect(actionsSource).toContain('data-testid="prospect-send-button"');
    expect(listUiSource).toContain('data-testid="prospect-bulk-campaign-select"');
    expect(listUiSource).toContain('data-testid="prospect-bulk-assign-button"');
    expect(listUiSource).toContain('data-testid="prospect-import-link"');
    expect(importUiSource).toContain('data-testid="prospect-import-page"');
    expect(importUiSource).toContain('data-testid="prospect-import-preview"');
    expect(importUiSource).toContain('data-testid="prospect-import-submit"');
    expect(campaignDetailUiSource).toContain('data-testid="campaign-batch-actions"');
    expect(campaignDetailUiSource).toContain('data-testid="campaign-batch-send-button"');
    expect(campaignDetailUiSource).toContain('data-testid="campaign-batch-send-phrase"');
    expect(campaignDetailUiSource).toContain('data-testid="campaign-prospect-list"');
  });
});
