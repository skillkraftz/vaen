import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("project archive schema", () => {
  it("adds archive columns to projects", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000003_add_project_archive.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("add column archived_at");
    expect(source).toContain("add column archived_by");
  });

  it("adds project delete policy", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000004_project_delete_policy.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("Users can delete own projects");
    expect(source).toContain("on public.projects for delete");
  });
});

describe("dashboard archive behavior", () => {
  it("hides archived projects from the default active list", () => {
    const pagePath = join(__dirname, "../app/dashboard/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("project.archived_at == null");
    expect(source).toContain("archived-projects-toggle");
  });

  it("can show archived projects separately", () => {
    const pagePath = join(__dirname, "../app/dashboard/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("archived-project-list");
    expect(source).toContain("Show Archived");
    expect(source).toContain("Hide Archived");
  });
});

describe("project archive and purge actions", () => {
  it("exports archive, restore, and purge actions", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function archiveProjectAction");
    expect(source).toContain("export async function restoreProjectAction");
    expect(source).toContain("export async function purgeProjectAction");
  });

  it("archive and restore keep workflow status unchanged", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const archiveFn = source.slice(
      source.indexOf("export async function archiveProjectAction"),
      source.indexOf("export async function restoreProjectAction"),
    );
    const restoreFn = source.slice(
      source.indexOf("export async function restoreProjectAction"),
      source.indexOf("export async function purgeProjectAction"),
    );
    expect(archiveFn).toContain("from_status: project.status");
    expect(archiveFn).toContain("to_status: project.status");
    expect(restoreFn).toContain("from_status: project.status");
    expect(restoreFn).toContain("to_status: project.status");
  });

  it("purge requires exact slug confirmation", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const purgeFn = source.slice(source.indexOf("export async function purgeProjectAction"));
    expect(purgeFn).toContain("confirmSlug.trim() !== p.slug");
    expect(purgeFn).toContain("Slug confirmation does not match");
  });

  it("purge cleans storage and generated filesystem artifacts before deleting the project", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const helperPath = join(__dirname, "../app/dashboard/projects/[id]/project-lifecycle-helpers.ts");
    const actionSource = readFileSync(actionsPath, "utf-8");
    const helperSource = readFileSync(helperPath, "utf-8");
    const purgeFn = actionSource.slice(sourceIndex(actionSource, "export async function purgeProjectAction"));
    expect(purgeFn).toContain("purgeProjectStorageAssets");
    expect(purgeFn).toContain("purgeGeneratedProjectDir");
    expect(purgeFn).toContain('.from("projects")');
    expect(purgeFn).toContain(".delete()");
    expect(helperSource).toContain('from("review-screenshots").remove');
    expect(helperSource).toContain('from("intake-assets").remove');
    expect(helperSource).toContain('rm(getGeneratedProjectDir(slug)');
  });
});

describe("project operations UI", () => {
  it("shows archive/restore and guarded purge controls", () => {
    const panelPath = join(__dirname, "../app/dashboard/projects/[id]/project-lifecycle-panel.tsx");
    const source = readFileSync(panelPath, "utf-8");
    expect(source).toContain("Archive Project");
    expect(source).toContain("Restore Project");
    expect(source).toContain("Purge Project");
    expect(source).toContain('data-testid="project-purge-slug"');
    expect(source).toContain('data-testid="project-purge-confirm"');
  });
});

function sourceIndex(source: string, needle: string) {
  const index = source.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  return index;
}
