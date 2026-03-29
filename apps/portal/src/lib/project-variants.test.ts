import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("project variants schema", () => {
  it("adds variant lineage columns to projects", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000005_add_project_variants.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("add column variant_of");
    expect(source).toContain("add column variant_label");
    expect(source).toContain("projects_variant_of_idx");
  });
});

describe("duplicate project action", () => {
  it("exports a duplicate action and allocates a safe variant identity", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-variant-helpers.ts");
    const actionSource = readFileSync(actionsPath, "utf-8");
    const helperSource = readFileSync(helperPath, "utf-8");

    expect(actionSource).toContain("export async function duplicateProjectAction");
    expect(actionSource).toContain("allocateVariantIdentity");
    expect(helperSource).toContain("normalizeVariantLabel");
    expect(helperSource).toContain('const baseSlug = `${source.slug}-${suffix}`');
    expect(helperSource).toContain('nextSlug = `${baseSlug}-${attempt}`');
  });

  it("duplicates the active request snapshot but resets downstream stale artifact pointers", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const duplicateFn = source.slice(
      source.indexOf("export async function duplicateProjectAction"),
      source.indexOf("export async function archiveProjectAction"),
    );

    expect(duplicateFn).toContain("loadCurrentDraft");
    expect(duplicateFn).toContain('status: "intake_draft_ready"');
    expect(duplicateFn).toContain("client_id: sourceProject.client_id");
    expect(duplicateFn).toContain("variant_of: identity.lineageRootId");
    expect(duplicateFn).toContain("draft_request: draft");
    expect(duplicateFn).toContain("final_request: null");
    expect(duplicateFn).toContain("last_exported_revision_id: null");
    expect(duplicateFn).toContain("last_generated_revision_id: null");
    expect(duplicateFn).toContain("last_reviewed_revision_id: null");
    expect(duplicateFn).toContain("createRevisionAndSetCurrent");
  });
});

describe("variant operator UI", () => {
  it("shows duplicate controls in the project lifecycle panel", () => {
    const panelPath = join(__dirname, "../app/dashboard/projects/[id]/project-lifecycle-panel.tsx");
    const source = readFileSync(panelPath, "utf-8");
    expect(source).toContain("Duplicate Project");
    expect(source).toContain('data-testid="project-duplicate-toggle"');
    expect(source).toContain('data-testid="project-duplicate-label"');
    expect(source).toContain('data-testid="project-duplicate-confirm"');
  });

  it("shows basic variant lineage in the project detail view", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("project-variant-lineage");
    expect(source).toContain("Variant Lineage");
    expect(source).toContain("variant-link-");
  });

  it("shows variant labels in the dashboard list", () => {
    const pagePath = join(__dirname, "../app/dashboard/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("Variant:");
    expect(source).toContain("project.variant_label ?? \"Base\"");
  });
});
