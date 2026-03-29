import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("module management schema", () => {
  it("adds selected_modules to projects", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000006_add_selected_modules.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("add column selected_modules");
    expect(source).toContain("Operator-confirmed module selections");
  });
});

describe("module actions and UI", () => {
  it("exports list/update module actions", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function listModulesForTemplateAction");
    expect(source).toContain("export async function updateModulesAction");
    expect(source).toContain('event_type: "modules_updated"');
    expect(source).toContain("selected_modules: normalizedModules");
    expect(source).toContain("last_exported_revision_id: null");
    expect(source).toContain("last_generated_revision_id: null");
    expect(source).toContain("last_reviewed_revision_id: null");
  });

  it("replaces the read-only recommendation block with the module manager", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("ModuleManager");
    expect(source).toContain("selectedModules={selectedModules}");
    expect(source).toContain("templateId={templateId}");
  });

  it("renders stable module manager test ids", () => {
    const moduleManagerPath = join(__dirname, "../app/dashboard/projects/[id]/module-manager.tsx");
    const source = readFileSync(moduleManagerPath, "utf-8");
    expect(source).toContain('data-testid="module-manager"');
    expect(source).toContain('data-testid={`module-card-${module.id}`}');
    expect(source).toContain('data-testid={`module-toggle-${module.id}`}');
  });
});

describe("module pipeline authority", () => {
  it("worker prefers selected_modules over recommendations", () => {
    const workerPath = join(REPO_ROOT, "apps/worker/src/run-job.ts");
    const source = readFileSync(workerPath, "utf-8");
    expect(source).toContain('selected_modules');
    expect(source).toContain("selectedModules.length > 0");
    expect(source).toContain("? selectedModules.map((m) => m.id)");
    expect(source).toContain(': rec?.modules?.map((m) => m.id) ?? ["maps-embed"]');
  });

  it("generator resolves operator moduleConfig before derived config", () => {
    const generatorPath = join(REPO_ROOT, "packages/generator/src/resolve-config.ts");
    const source = readFileSync(generatorPath, "utf-8");
    expect(source).toContain("operatorModuleConfig");
    expect(source).toContain('{ ...(operatorModuleConfig[id] ?? {}) }');
    expect(source).toContain("&& !config.address");
    expect(source).toContain("&& !config.testimonials");
  });
});
