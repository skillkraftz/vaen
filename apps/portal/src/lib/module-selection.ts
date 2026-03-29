import { getModule, getModulesForTemplate, type ModuleManifest } from "@vaen/module-registry";
import type { IntakeRecommendations, Project, SelectedModule } from "./types";

const AUTO_DERIVED_REQUIRED_CONFIG = new Set([
  "maps-embed",
  "manual-testimonials",
]);

export function seedSelectedModulesFromRecommendations(
  recommendations: IntakeRecommendations | null | undefined,
): SelectedModule[] {
  return (recommendations?.modules ?? []).map((module) => ({ id: module.id }));
}

export function getAuthoritativeSelectedModules(project: Pick<Project, "selected_modules" | "recommendations">): SelectedModule[] {
  if (Array.isArray(project.selected_modules) && project.selected_modules.length > 0) {
    return normalizeSelectedModules(project.selected_modules);
  }
  return seedSelectedModulesFromRecommendations(project.recommendations);
}

export function normalizeSelectedModules(modules: Array<SelectedModule | null | undefined>): SelectedModule[] {
  const seen = new Set<string>();
  const normalized: SelectedModule[] = [];

  for (const module of modules) {
    const id = module?.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(module?.config && Object.keys(module.config).length > 0
      ? { id, config: module.config }
      : { id });
  }

  return normalized;
}

export function syncDraftWithSelectedModules(
  draft: Record<string, unknown>,
  selectedModules: SelectedModule[],
): Record<string, unknown> {
  const preferences = { ...((draft.preferences as Record<string, unknown> | undefined) ?? {}) };
  preferences.modules = selectedModules.map((module) => module.id);

  const moduleConfig = selectedModules.reduce<Record<string, Record<string, unknown>>>((acc, module) => {
    if (module.config && Object.keys(module.config).length > 0) {
      acc[module.id] = module.config;
    }
    return acc;
  }, {});

  if (Object.keys(moduleConfig).length > 0) {
    preferences.moduleConfig = moduleConfig;
  } else {
    delete preferences.moduleConfig;
  }

  return { ...draft, preferences };
}

export function selectedModulesEqual(a: SelectedModule[], b: SelectedModule[]) {
  return JSON.stringify(normalizeSelectedModules(a)) === JSON.stringify(normalizeSelectedModules(b));
}

export function listCompatibleModules(templateId: string): ModuleManifest[] {
  return getModulesForTemplate(templateId);
}

export function validateSelectedModules(
  templateId: string,
  selectedModules: SelectedModule[],
): string | null {
  const compatibleIds = new Set(getModulesForTemplate(templateId).map((module) => module.id));

  for (const module of selectedModules) {
    const manifest = getModule(module.id);
    if (!manifest) return `Unknown module "${module.id}".`;
    if (!compatibleIds.has(module.id)) {
      return `Module "${module.id}" is not compatible with template "${templateId}".`;
    }

    if (manifest.status !== "active" && !moduleHasAllRequiredConfig(manifest, module)) {
      return `Module "${module.id}" is not ready for operator selection yet.`;
    }

    if (!moduleHasAllRequiredConfig(manifest, module) && !AUTO_DERIVED_REQUIRED_CONFIG.has(module.id)) {
      return `Module "${module.id}" is missing required configuration.`;
    }
  }

  return null;
}

function moduleHasAllRequiredConfig(manifest: ModuleManifest, module: SelectedModule) {
  const config = module.config ?? {};
  return manifest.configSchema.required.every((key) => {
    const value = config[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}
