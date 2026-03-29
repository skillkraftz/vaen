import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildInitialRequestSnapshot } from "../app/dashboard/new/client-intake-helpers";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("client system schema", () => {
  it("adds a clients table migration", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000001_create_clients.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table public.clients");
    expect(source).toContain("Users can view own clients");
    expect(source).toContain("Users can create clients");
  });

  it("adds nullable project client linkage", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000002_add_project_client_id.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("add column client_id");
    expect(source).toContain("references public.clients");
    expect(source).toContain("on delete set null");
  });

  it("adds Client type and project.client_id", () => {
    const typesPath = join(__dirname, "types.ts");
    const source = readFileSync(typesPath, "utf-8");
    expect(source).toContain("export interface Client");
    expect(source).toContain("client_id: string | null");
  });
});

describe("new intake flow with clients", () => {
  it("createIntake supports new and existing client modes", () => {
    const actionsPath = join(__dirname, "../app/dashboard/new/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain('formData.get("clientMode")');
    expect(source).toContain('clientMode === "existing"');
    expect(source).toContain('.from("clients")');
    expect(source).toContain("existingClientId");
  });

  it("createIntake links the project to a client and snapshots initial request data", () => {
    const actionsPath = join(__dirname, "../app/dashboard/new/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("client_id: clientId");
    expect(source).toContain("draft_request: initialSnapshot");
    expect(source).toContain("createRevisionAndSetCurrent");
    expect(source).toContain('"Initial project creation snapshot"');
  });

  it("new intake form includes client mode toggle while preserving audit form ids", () => {
    const formPath = join(__dirname, "../app/dashboard/new/new-intake-form.tsx");
    const source = readFileSync(formPath, "utf-8");
    expect(source).toContain("New Client");
    expect(source).toContain("Existing Client");
    expect(source).toContain('data-testid="new-intake-form"');
    expect(source).toContain('data-testid="create-intake-submit"');
    expect(source).toContain('id="name"');
    expect(source).toContain('id="slug"');
    expect(source).toContain('id="businessType"');
    expect(source).toContain('id="contactName"');
    expect(source).toContain('id="contactEmail"');
    expect(source).toContain('id="contactPhone"');
    expect(source).toContain('id="existingClientId"');
  });
});

describe("client relationship visibility", () => {
  it("dashboard shows client relationship", () => {
    const pagePath = join(__dirname, "../app/dashboard/page.tsx");
    const listPath = join(__dirname, "../app/dashboard/dashboard-project-list.tsx");
    const pageSource = readFileSync(pagePath, "utf-8");
    const listSource = readFileSync(listPath, "utf-8");
    expect(pageSource).toContain("client:clients");
    expect(listSource).toContain("Client:");
  });

  it("project detail shows client relationship", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("client:clients");
    expect(source).toContain("Client:");
  });
});

describe("initial request snapshot", () => {
  it("captures business and contact data into the initial revision snapshot", () => {
    const snapshot = buildInitialRequestSnapshot({
      name: "Audit Run Co",
      businessType: "Painting contractor",
      contactName: "Alex",
      contactEmail: "alex@example.com",
      contactPhone: "(555) 111-2222",
      notes: "High-touch residential repaint projects",
    });

    expect(snapshot.business).toEqual({
      name: "Audit Run Co",
      type: "Painting contractor",
    });
    expect(snapshot.contact).toEqual({
      name: "Alex",
      email: "alex@example.com",
      phone: "(555) 111-2222",
    });
    expect(snapshot._intake).toBeTruthy();
  });

  it("captures prospect-origin fields into the authoritative intake snapshot", () => {
    const snapshot = buildInitialRequestSnapshot({
      name: "Audit Run Co",
      businessType: "Painting contractor",
      contactName: "Alex",
      contactEmail: "alex@example.com",
      contactPhone: "(555) 111-2222",
      notes: "High-touch residential repaint projects",
      websiteUrl: "https://audit-run.example",
      source: "csv_import",
      campaign: "Spring Push",
      outreachSummary: "Outdated site and weak call to action",
      sourceProspectId: "prospect-123",
    });

    expect(snapshot.content).toEqual({
      about: "High-touch residential repaint projects",
    });
    expect(snapshot._intake).toEqual(
      expect.objectContaining({
        websiteUrl: "https://audit-run.example",
        source: "csv_import",
        campaign: "Spring Push",
        outreachSummary: "Outdated site and weak call to action",
        sourceProspectId: "prospect-123",
      }),
    );
  });
});
