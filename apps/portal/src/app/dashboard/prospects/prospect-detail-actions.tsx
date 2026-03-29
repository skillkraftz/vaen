"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { analyzeProspectAction, convertProspectAction } from "./actions";
import type { Prospect } from "@/lib/types";

export function ProspectDetailActions({
  prospect,
}: {
  prospect: Prospect;
}) {
  const router = useRouter();
  const [autoProcess, setAutoProcess] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function analyze() {
    setError(null);
    startTransition(async () => {
      const result = await analyzeProspectAction(prospect.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function convert() {
    setError(null);
    startTransition(async () => {
      const result = await convertProspectAction(prospect.id, { autoProcess });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.projectId) {
        router.push(`/dashboard/projects/${result.projectId}`);
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="card" data-testid="prospect-actions">
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={analyze}
          disabled={isPending}
          data-testid="prospect-analyze-button"
        >
          {isPending ? "Working..." : "Analyze Website"}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={convert}
          disabled={isPending || prospect.status === "converted"}
          data-testid="prospect-convert-button"
        >
          {isPending ? "Converting..." : "Create Client + Project"}
        </button>
      </div>
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.75rem" }}>
        <input
          type="checkbox"
          checked={autoProcess}
          onChange={(e) => setAutoProcess(e.target.checked)}
        />
        Auto-process intake after conversion
      </label>
      {error && (
        <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.75rem" }}>{error}</p>
      )}
    </div>
  );
}
