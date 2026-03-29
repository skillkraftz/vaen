import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseProspectImportText,
  previewProspectImportRows,
  summarizeCampaignMetrics,
} from "./prospect-campaigns";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("campaign schema", () => {
  it("adds campaigns and prospect linkage additively", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000012_create_campaigns.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.campaigns");
    expect(source).toContain("user_id uuid not null references auth.users(id)");
    expect(source).toContain("add column if not exists campaign_id uuid references public.campaigns");
    expect(source).toContain("alter table public.outreach_sends");
    expect(source).toContain("Users can view own campaigns");
  });

  it("adds a follow-up repair migration for broken text user_id rollouts", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000013_repair_campaign_user_id.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("alter column user_id type uuid using user_id::uuid");
    expect(source).toContain("drop constraint if exists campaigns_user_id_fkey");
    expect(source).toContain("user_id = auth.uid()");
  });

  it("adds Campaign type and campaign linkage fields", () => {
    const typesPath = join(__dirname, "types.ts");
    const source = readFileSync(typesPath, "utf-8");
    expect(source).toContain("export interface Campaign");
    expect(source).toContain('status: "draft" | "active" | "paused" | "completed" | "archived"');
    expect(source).toContain("campaign_id?: string | null");
  });
});

describe("prospect import helpers", () => {
  it("parses CSV-like text with the expected headers", () => {
    const rows = parseProspectImportText(
      [
        "company_name,website_url,contact_name,contact_email,contact_phone,notes,source,campaign",
        'Acme Painting,acme.test,Alex,alex@acme.test,(555) 111-2222,"High-end residential",manual,Spring Wave',
      ].join("\n"),
    );

    expect(rows).toEqual([
      {
        rowNumber: 2,
        company_name: "Acme Painting",
        website_url: "acme.test",
        contact_name: "Alex",
        contact_email: "alex@acme.test",
        contact_phone: "(555) 111-2222",
        notes: "High-end residential",
        source: "manual",
        campaign: "Spring Wave",
      },
    ]);
  });

  it("marks existing and repeated website urls as duplicates", () => {
    const preview = previewProspectImportRows({
      rawText: [
        "company_name,website_url",
        "Acme Painting,acme.test",
        "Acme Painting Copy,acme.test",
        "Bright Co,bright.test",
      ].join("\n"),
      existingProspects: [{ website_url: "https://bright.test" }],
    });

    expect(preview.summary.total).toBe(3);
    expect(preview.summary.valid).toBe(1);
    expect(preview.summary.duplicates).toBe(2);
    expect(preview.rows[1].duplicate_reason).toContain("Duplicate website URL within this import.");
    expect(preview.rows[2].duplicate_reason).toContain("Prospect with this website already exists.");
  });

  it("summarizes campaign metrics from prospect states", () => {
    const metrics = summarizeCampaignMetrics({
      prospects: [
        {
          id: "p1",
          user_id: "u1",
          company_name: "A",
          website_url: "https://a.test",
          contact_name: null,
          contact_email: null,
          contact_phone: null,
          notes: null,
          status: "ready_for_outreach",
          source: null,
          campaign: null,
          outreach_summary: null,
          outreach_status: "ready",
          metadata: {},
          converted_client_id: null,
          converted_project_id: null,
          created_at: "",
          updated_at: "",
        },
        {
          id: "p2",
          user_id: "u1",
          company_name: "B",
          website_url: "https://b.test",
          contact_name: null,
          contact_email: null,
          contact_phone: null,
          notes: null,
          status: "converted",
          source: null,
          campaign: null,
          outreach_summary: null,
          outreach_status: "sent",
          metadata: {},
          converted_client_id: null,
          converted_project_id: null,
          created_at: "",
          updated_at: "",
        },
      ],
    });

    expect(metrics).toEqual({
      prospectCount: 2,
      readyForOutreach: 1,
      converted: 1,
      outreachReady: 1,
      sent: 1,
      packageCount: 0,
    });
  });
});
