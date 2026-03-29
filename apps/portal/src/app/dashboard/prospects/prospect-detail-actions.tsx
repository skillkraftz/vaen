"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeProspectAction,
  continueProspectAutomationAction,
  convertProspectAction,
  generateOutreachPackageAction,
  pauseProspectSequenceAction,
  prepareProspectEmailDraftAction,
  resumeProspectSequenceAction,
  sendProspectOutreachAction,
} from "./actions";
import { PROSPECT_AUTOMATION_LEVELS } from "@/lib/prospect-outreach";
import { readProspectSequenceState } from "@/lib/campaign-sequences";
import type { Prospect, ProspectAutomationLevel } from "@/lib/types";

export function ProspectDetailActions({
  prospect,
}: {
  prospect: Prospect;
}) {
  const router = useRouter();
  const initialLevel = (() => {
    const fromMetadata = prospect.metadata?.automation_level;
    return typeof fromMetadata === "string"
      ? fromMetadata as ProspectAutomationLevel
      : "process_intake";
  })();
  const [automationLevel, setAutomationLevel] = useState<ProspectAutomationLevel>(initialLevel);
  const [confirmSend, setConfirmSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const sequenceState = readProspectSequenceState(prospect.metadata);
  const sequencePaused = sequenceState?.paused === true;

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
      const result = await convertProspectAction(prospect.id, { automationLevel });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function continueAutomation() {
    setError(null);
    startTransition(async () => {
      const result = await continueProspectAutomationAction(prospect.id, automationLevel);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function generateOutreachPackage() {
    setError(null);
    startTransition(async () => {
      const result = await generateOutreachPackageAction(prospect.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function previewEmailDraft() {
    setError(null);
    startTransition(async () => {
      const result = await prepareProspectEmailDraftAction(prospect.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function sendNow() {
    setError(null);
    startTransition(async () => {
      const result = await sendProspectOutreachAction(prospect.id, { confirm: confirmSend });
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirmSend(false);
      router.refresh();
    });
  }

  function toggleSequencePause() {
    setError(null);
    startTransition(async () => {
      const result = sequencePaused
        ? await resumeProspectSequenceAction(prospect.id)
        : await pauseProspectSequenceAction(prospect.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="card" data-testid="prospect-actions">
      <div style={{ marginBottom: "0.75rem" }}>
        <label className="form-label" htmlFor="prospectAutomationLevel">Automation Level</label>
        <select
          id="prospectAutomationLevel"
          className="form-input"
          value={automationLevel}
          onChange={(e) => setAutomationLevel(e.target.value as ProspectAutomationLevel)}
          data-testid="prospect-automation-level"
        >
          {PROSPECT_AUTOMATION_LEVELS.map((level) => (
            <option key={level.id} value={level.id}>
              {level.label}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>
          {PROSPECT_AUTOMATION_LEVELS.find((level) => level.id === automationLevel)?.description}
        </p>
      </div>
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
          {isPending ? "Converting..." : "Convert + Run"}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={continueAutomation}
          disabled={isPending || !prospect.converted_project_id}
          data-testid="prospect-continue-automation-button"
        >
          {isPending ? "Running..." : "Continue Automation"}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={generateOutreachPackage}
          disabled={isPending}
          data-testid="prospect-generate-package-button"
        >
          {isPending ? "Preparing..." : "Generate Outreach Package"}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={previewEmailDraft}
          disabled={isPending}
          data-testid="prospect-preview-email-button"
        >
          {isPending ? "Preparing..." : "Prepare Email Draft"}
        </button>
      </div>
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.75rem" }}>
        <input
          type="checkbox"
          checked={confirmSend}
          onChange={(e) => setConfirmSend(e.target.checked)}
          data-testid="prospect-send-confirm"
        />
        Confirm outbound send to the current contact email
      </label>
      <div style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={sendNow}
          disabled={isPending || !confirmSend}
          data-testid="prospect-send-button"
        >
          {isPending ? "Sending..." : "Send Outreach Email"}
        </button>
        {prospect.campaign_id && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={toggleSequencePause}
            disabled={isPending}
            style={{ marginLeft: "0.5rem" }}
            data-testid="prospect-sequence-toggle"
          >
            {isPending ? "Updating..." : sequencePaused ? "Resume Sequence" : "Pause Sequence"}
          </button>
        )}
      </div>
      {error && (
        <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.75rem" }}>{error}</p>
      )}
    </div>
  );
}
