"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { IntakeRecommendations, SelectedModule } from "@/lib/types";
import {
  listModulesForTemplateAction,
  updateModulesAction,
} from "./actions";

type ModuleCatalogItem = {
  id: string;
  name: string;
  description: string;
  status: "active" | "draft" | "deprecated";
  configSchema: {
    required: string[];
    optional: string[];
  };
};

const DEFERRED_CONFIG_MODULES = new Set([
  "booking-lite",
  "google-reviews-live",
]);

function recommendationReason(
  recommendations: IntakeRecommendations | null,
  moduleId: string,
) {
  return recommendations?.modules.find((module) => module.id === moduleId)?.reason ?? null;
}

export function ModuleManager({
  projectId,
  templateId,
  selectedModules,
  recommendations,
}: {
  projectId: string;
  templateId: string;
  selectedModules: SelectedModule[];
  recommendations: IntakeRecommendations | null;
}) {
  const [catalog, setCatalog] = useState<ModuleCatalogItem[]>([]);
  const [modules, setModules] = useState<SelectedModule[]>(selectedModules);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setModules(selectedModules);
  }, [selectedModules]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listModulesForTemplateAction(templateId);
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        return;
      }
      setCatalog(result.modules);
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const activeIds = useMemo(() => new Set(modules.map((module) => module.id)), [modules]);

  function toggleModule(module: ModuleCatalogItem) {
    if (DEFERRED_CONFIG_MODULES.has(module.id)) return;

    const nextModules = activeIds.has(module.id)
      ? modules.filter((entry) => entry.id !== module.id)
      : [...modules, { id: module.id }];

    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await updateModulesAction(projectId, nextModules);
      if (result.error) {
        setError(result.error);
        return;
      }
      setModules(nextModules);
      setSuccess(`Module selection updated. Rebuild the project to apply ${module.name}.`);
    });
  }

  return (
    <div className="card" data-testid="module-manager">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Modules
          </h2>
          <p className="text-sm text-muted">
            Template: <span className="text-mono">{templateId}</span>. Module changes create a new revision and mark export/build/review as stale.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {catalog.map((module) => {
            const active = activeIds.has(module.id);
            const deferred = DEFERRED_CONFIG_MODULES.has(module.id);
            const reason = recommendationReason(recommendations, module.id);
            return (
              <div
                key={module.id}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  padding: "0.85rem",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  alignItems: "flex-start",
                }}
                data-testid={`module-card-${module.id}`}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{module.name}</strong>
                    <span className="text-mono text-sm text-muted">{module.id}</span>
                    <span className="badge">{module.status}</span>
                    {active && <span className="badge badge-green">selected</span>}
                  </div>
                  <p className="text-sm text-muted">{module.description}</p>
                  {reason && (
                    <p className="text-sm text-muted">
                      AI recommendation: {reason}
                    </p>
                  )}
                  {deferred && (
                    <p className="text-sm text-muted">
                      Config-heavy module setup is deferred in this phase.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => toggleModule(module)}
                  disabled={isPending || deferred}
                  data-testid={`module-toggle-${module.id}`}
                >
                  {active ? "Remove" : deferred ? "Deferred" : "Add"}
                </button>
              </div>
            );
          })}
        </div>

        {recommendations && (
          <div style={{ paddingTop: "0.5rem", borderTop: "1px solid var(--color-border)" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.35rem" }}>
              AI Recommendations
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <p className="text-sm text-muted">
                Template: <span className="text-mono">{recommendations.template.id}</span> — {recommendations.template.reason}
              </p>
              {recommendations.modules.map((module) => (
                <p key={module.id} className="text-sm text-muted">
                  <span className="text-mono">{module.id}</span> — {module.reason}
                </p>
              ))}
              {recommendations.notes && (
                <p className="text-sm text-muted">{recommendations.notes}</p>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm" style={{ color: "var(--color-error)" }}>
            {error}
          </p>
        )}
        {success && !error && (
          <p className="text-sm" style={{ color: "var(--color-success)" }}>
            {success}
          </p>
        )}
      </div>
    </div>
  );
}
