"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getAvailableStepNumbers,
  isCampaignStepLocked,
  readProspectSequenceState,
  sortCampaignSequenceSteps,
  type CampaignSequenceStepInput,
} from "@/lib/campaign-sequences";
import { getProspectSendReadiness } from "@/lib/outreach-execution";
import { getCampaignSequenceProgress, getSequencePauseReason } from "@/lib/sequence-execution";
import type {
  ApprovalRequest,
  Campaign,
  CampaignSequenceStep,
  Prospect,
  ProspectOutreachPackage,
} from "@/lib/types";
import {
  advanceDueFollowUpsAction,
  batchAnalyzeCampaignProspectsAction,
  batchConvertCampaignProspectsAction,
  batchGenerateCampaignPackagesAction,
  batchRunCampaignAutomationAction,
  batchSendCampaignOutreachAction,
  saveCampaignSequenceAction,
  updateCampaignStatusAction,
} from "../actions";
import { PROSPECT_AUTOMATION_LEVELS } from "@/lib/prospect-outreach";
import type { ProspectAutomationLevel } from "@/lib/types";

interface CampaignProspectRow {
  prospect: Prospect;
  latestPackage: ProspectOutreachPackage | null;
}

function computedReadiness(row: CampaignProspectRow) {
  const readiness = getProspectSendReadiness({
    prospect: row.prospect,
    outreachPackage: row.latestPackage,
  });
  return readiness.ready ? "ready" : "blocked";
}

export function CampaignDetailManager({
  campaign,
  rows,
  approvalRequest,
  sequenceSteps,
  lockedStepCounts,
}: {
  campaign: Campaign;
  rows: CampaignProspectRow[];
  approvalRequest: ApprovalRequest | null;
  sequenceSteps: CampaignSequenceStep[];
  lockedStepCounts: Record<number, number>;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [readinessFilter, setReadinessFilter] = useState("all");
  const [campaignStatus, setCampaignStatus] = useState<Campaign["status"]>(campaign.status);
  const [automationLevel, setAutomationLevel] = useState<ProspectAutomationLevel>("process_intake");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [batchResult, setBatchResult] = useState<{
    summary?: { sent?: number; blocked?: number; failed: number; succeeded?: number; skipped?: number };
    results?: Array<{ prospectId: string; status: string; message: string }>;
  } | null>(null);
  const [sequenceDraft, setSequenceDraft] = useState<CampaignSequenceStepInput[]>(
    sortCampaignSequenceSteps(sequenceSteps.map((step) => ({
      id: step.id,
      step_number: step.step_number,
      label: step.label,
      delay_days: step.delay_days,
      subject_template: step.subject_template,
      body_template: step.body_template,
    }))),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredRows = useMemo(
    () => rows.filter((row) => {
      const readiness = computedReadiness(row);
      const statusMatches = statusFilter === "all" || row.prospect.status === statusFilter;
      const readinessMatches = readinessFilter === "all" || readiness === readinessFilter;
      return statusMatches && readinessMatches;
    }),
    [rows, statusFilter, readinessFilter],
  );
  const sequenceProgress = useMemo(
    () => getCampaignSequenceProgress({
      sequenceSteps,
      prospects: rows.map((row) => row.prospect),
    }),
    [rows, sequenceSteps],
  );
  const dueFollowUpCount = sequenceProgress.reduce((sum, step) => sum + step.dueCount, 0);
  const availableStepNumbers = getAvailableStepNumbers(sequenceDraft);
  const confirmationPhrase = `SEND ${selectedIds.length} EMAIL${selectedIds.length === 1 ? "" : "S"}`;

  function toggleProspect(prospectId: string) {
    setSelectedIds((current) => (
      current.includes(prospectId)
        ? current.filter((id) => id !== prospectId)
        : [...current, prospectId]
    ));
  }

  function updateStep(stepNumber: number, patch: Partial<CampaignSequenceStepInput>) {
    setSequenceDraft((current) => sortCampaignSequenceSteps(current.map((step) => (
      step.step_number === stepNumber ? { ...step, ...patch } : step
    ))));
  }

  function addStep() {
    const nextStepNumber = availableStepNumbers[0];
    if (!nextStepNumber) return;
    setSequenceDraft((current) => sortCampaignSequenceSteps([
      ...current,
      {
        step_number: nextStepNumber,
        label: `Step ${nextStepNumber}`,
        delay_days: nextStepNumber === 1 ? 0 : 3,
        subject_template: "",
        body_template: "",
      },
    ]));
  }

  function removeStep(stepNumber: number) {
    setSequenceDraft((current) => current.filter((step) => step.step_number !== stepNumber));
  }

  function saveSequence() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveCampaignSequenceAction(campaign.id, sequenceDraft);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice("Campaign sequence saved.");
      router.refresh();
    });
  }

  function saveStatus() {
    setError(null);
    startTransition(async () => {
      const result = await updateCampaignStatusAction(campaign.id, campaignStatus);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function generatePackages() {
    setError(null);
    startTransition(async () => {
      const result = await batchGenerateCampaignPackagesAction({ prospectIds: selectedIds });
      if (result.error) {
        setError(result.error);
        return;
      }
      setBatchResult({
        results: result.results?.map((item) => ({ ...item })),
      });
      router.refresh();
    });
  }

  function analyzeSelected() {
    setError(null);
    startTransition(async () => {
      const result = await batchAnalyzeCampaignProspectsAction({ prospectIds: selectedIds });
      if (result.error) {
        setError(result.error);
        return;
      }
      setBatchResult(result);
      router.refresh();
    });
  }

  function convertSelected() {
    setError(null);
    startTransition(async () => {
      const result = await batchConvertCampaignProspectsAction({
        prospectIds: selectedIds,
        automationLevel: "convert_only",
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setBatchResult(result);
      router.refresh();
    });
  }

  function automateSelected() {
    setError(null);
    startTransition(async () => {
      const result = await batchRunCampaignAutomationAction({
        prospectIds: selectedIds,
        level: automationLevel,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setBatchResult(result);
      router.refresh();
    });
  }

  function advanceDueFollowUps() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await advanceDueFollowUpsAction(campaign.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBatchResult(result);
      router.refresh();
    });
  }

  function sendSelected() {
    setError(null);
    startTransition(async () => {
      const result = await batchSendCampaignOutreachAction({
        prospectIds: selectedIds,
        confirmPhrase,
        campaignId: campaign.id,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.approval_required) {
        setNotice(`Batch send requires admin approval. Request ${result.request_id ?? "submitted"}.`);
        return;
      }
      setConfirmPhrase("");
      setBatchResult(result);
      router.refresh();
    });
  }

  return (
    <div className="section" data-testid="campaign-detail-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <Link href="/dashboard/campaigns" className="text-sm text-muted">
            &larr; Campaigns
          </Link>
          <h1 style={{ marginTop: "0.5rem", marginBottom: "0.25rem" }}>{campaign.name}</h1>
          <p className="text-sm text-muted">{campaign.description ?? "No description provided."}</p>
        </div>
        <span className="badge">{campaign.status}</span>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <label className="form-label" htmlFor="campaignStatus">Campaign status</label>
            <select
              id="campaignStatus"
              className="form-input"
              value={campaignStatus}
              onChange={(event) => setCampaignStatus(event.target.value as Campaign["status"])}
              data-testid="campaign-status-select"
            >
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="completed">completed</option>
              <option value="archived">archived</option>
            </select>
          </div>
          <button type="button" className="btn btn-sm" onClick={saveStatus} disabled={isPending} data-testid="campaign-status-save">
            {isPending ? "Saving..." : "Save Status"}
          </button>
        </div>
        <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
          Use status to mark the current outreach run without changing the underlying prospect/project workflow.
        </p>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <label className="form-label" htmlFor="campaignStatusFilter">Filter by prospect status</label>
            <select
              id="campaignStatusFilter"
              className="form-input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">all</option>
              <option value="new">new</option>
              <option value="researching">researching</option>
              <option value="analyzed">analyzed</option>
              <option value="ready_for_outreach">ready_for_outreach</option>
              <option value="converted">converted</option>
              <option value="disqualified">disqualified</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="campaignReadinessFilter">Filter by send readiness</label>
            <select
              id="campaignReadinessFilter"
              className="form-input"
              value={readinessFilter}
              onChange={(event) => setReadinessFilter(event.target.value)}
            >
              <option value="all">all</option>
              <option value="ready">ready</option>
              <option value="blocked">blocked</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="campaign-sequence-builder">
        <div className="section-header" style={{ marginBottom: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>Outreach Sequence</h2>
            <p className="text-sm text-muted">
              Define up to 5 campaign-specific follow-up steps. Template variables: {"{{company_name}}"}, {"{{contact_name}}"}, {"{{website_url}}"}, {"{{offer_summary}}"}, {"{{pricing_summary}}"}.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={addStep}
            disabled={isPending || availableStepNumbers.length === 0}
            data-testid="campaign-sequence-add-step"
          >
            Add Step
          </button>
        </div>

        {sequenceDraft.length === 0 ? (
          <p className="text-sm text-muted">No sequence steps yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {sequenceDraft.map((step) => {
              const locked = isCampaignStepLocked(
                step.step_number,
                new Map(Object.entries(lockedStepCounts).map(([key, value]) => [Number(key), value])),
              );
              const lockCount = lockedStepCounts[step.step_number] ?? 0;
              return (
                <div
                  key={step.id ?? step.step_number}
                  className="card"
                  style={{ padding: "0.75rem", background: "var(--color-surface-subtle)" }}
                  data-testid={`campaign-sequence-step-${step.step_number}`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem" }}>
                    <strong>Step {step.step_number}</strong>
                    {locked ? (
                      <span className="badge" data-testid={`campaign-sequence-step-locked-${step.step_number}`}>
                        locked · {lockCount} send{lockCount === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => removeStep(step.step_number)}
                        disabled={isPending}
                        data-testid={`campaign-sequence-step-remove-${step.step_number}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div style={{ display: "grid", gap: "0.5rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "9rem 1fr 9rem", gap: "0.75rem" }}>
                      <div>
                        <label className="form-label" htmlFor={`step-number-${step.step_number}`}>Step #</label>
                        <select
                          id={`step-number-${step.step_number}`}
                          className="form-input"
                          value={step.step_number}
                          disabled={locked || isPending}
                          onChange={(event) => updateStep(step.step_number, { step_number: Number(event.target.value) })}
                          data-testid={`campaign-sequence-step-number-${step.step_number}`}
                        >
                          {[1, 2, 3, 4, 5].map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="form-label" htmlFor={`step-label-${step.step_number}`}>Label</label>
                        <input
                          id={`step-label-${step.step_number}`}
                          className="form-input"
                          value={step.label}
                          disabled={locked || isPending}
                          onChange={(event) => updateStep(step.step_number, { label: event.target.value })}
                          data-testid={`campaign-sequence-step-label-${step.step_number}`}
                        />
                      </div>
                      <div>
                        <label className="form-label" htmlFor={`step-delay-${step.step_number}`}>Delay (days)</label>
                        <input
                          id={`step-delay-${step.step_number}`}
                          className="form-input text-mono"
                          type="number"
                          min={0}
                          value={step.delay_days}
                          disabled={locked || isPending}
                          onChange={(event) => updateStep(step.step_number, { delay_days: Number(event.target.value) })}
                          data-testid={`campaign-sequence-step-delay-${step.step_number}`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="form-label" htmlFor={`step-subject-${step.step_number}`}>Subject template</label>
                      <input
                        id={`step-subject-${step.step_number}`}
                        className="form-input"
                        value={step.subject_template ?? ""}
                        disabled={locked || isPending}
                        onChange={(event) => updateStep(step.step_number, { subject_template: event.target.value })}
                        data-testid={`campaign-sequence-step-subject-${step.step_number}`}
                      />
                    </div>
                    <div>
                      <label className="form-label" htmlFor={`step-body-${step.step_number}`}>Body template</label>
                      <textarea
                        id={`step-body-${step.step_number}`}
                        className="form-input"
                        rows={4}
                        value={step.body_template ?? ""}
                        disabled={locked || isPending}
                        onChange={(event) => updateStep(step.step_number, { body_template: event.target.value })}
                        data-testid={`campaign-sequence-step-body-${step.step_number}`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={saveSequence}
            disabled={isPending}
            data-testid="campaign-sequence-save"
          >
            {isPending ? "Saving..." : "Save Sequence"}
          </button>
          <p className="text-sm text-muted">
            Steps with existing sends are locked. Future steps remain editable.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="campaign-sequence-progress">
        <div className="section-header" style={{ marginBottom: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>Sequence Progress</h2>
            <p className="text-sm text-muted">
              Follow-ups only advance when you trigger them here. Manual sends do not move prospects through the sequence.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={advanceDueFollowUps}
            disabled={isPending || sequenceSteps.length === 0 || dueFollowUpCount === 0}
            data-testid="campaign-sequence-advance-button"
          >
            {isPending ? "Advancing..." : `Advance Due Follow-ups${dueFollowUpCount > 0 ? ` (${dueFollowUpCount})` : ""}`}
          </button>
        </div>
        {sequenceProgress.length === 0 ? (
          <p className="text-sm text-muted">Add sequence steps before advancing follow-ups.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {sequenceProgress.map((step) => (
              <div
                key={step.step_number}
                className="card"
                style={{ padding: "0.75rem", background: "var(--color-surface-subtle)" }}
                data-testid={`campaign-sequence-progress-step-${step.step_number}`}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                  <strong>{`Step ${step.step_number}: ${step.label}`}</strong>
                  <span className="text-sm text-muted">
                    sent {step.sentCount} · due {step.dueCount} · paused {step.pausedCount}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="campaign-batch-actions">
        <p className="text-sm text-muted" style={{ marginBottom: "0.75rem" }}>
          Selected prospects: {selectedIds.length}. Batch actions stay explicit: analysis, conversion, and early pipeline automation run one prospect at a time and report per-prospect outcomes. Sending still requires a typed confirmation phrase.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={analyzeSelected}
            disabled={isPending || selectedIds.length === 0}
            data-testid="campaign-batch-analyze-button"
          >
            {isPending ? "Running..." : "Analyze Selected"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={convertSelected}
            disabled={isPending || selectedIds.length === 0}
            data-testid="campaign-batch-convert-button"
          >
            {isPending ? "Running..." : "Convert Selected"}
          </button>
          <div style={{ minWidth: "18rem" }}>
            <label className="form-label" htmlFor="campaignAutomationLevel">Automation level</label>
            <select
              id="campaignAutomationLevel"
              className="form-input"
              value={automationLevel}
              onChange={(event) => setAutomationLevel(event.target.value as ProspectAutomationLevel)}
              data-testid="campaign-automation-level"
            >
              {PROSPECT_AUTOMATION_LEVELS.filter((level) => level.id !== "review_site").map((level) => (
                <option key={level.id} value={level.id}>
                  {level.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={automateSelected}
            disabled={isPending || selectedIds.length === 0}
            data-testid="campaign-batch-automation-button"
          >
            {isPending ? "Running..." : "Run Automation"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={generatePackages}
            disabled={isPending || selectedIds.length === 0}
            data-testid="campaign-batch-package-button"
          >
            {isPending ? "Running..." : "Generate Packages"}
          </button>
          <div style={{ minWidth: "16rem" }}>
            <label className="form-label" htmlFor="campaignSendPhrase">Type {confirmationPhrase || "SEND N EMAILS"}</label>
            <input
              id="campaignSendPhrase"
              className="form-input"
              value={confirmPhrase}
              onChange={(event) => setConfirmPhrase(event.target.value)}
              data-testid="campaign-batch-send-phrase"
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={sendSelected}
            disabled={isPending || selectedIds.length === 0}
            data-testid="campaign-batch-send-button"
          >
            {isPending ? "Sending..." : "Send Selected"}
          </button>
        </div>
        {error && (
          <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.5rem" }}>
            {error}
          </p>
        )}
      </div>

      {(notice || approvalRequest) && (
        <div
          className="card"
          style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--color-surface-subtle)" }}
          data-testid="campaign-approval-banner"
        >
          <p className="text-sm" style={{ color: "var(--color-warning)" }}>
            {notice ?? `Batch outreach approval is ${approvalRequest?.status}.`}
          </p>
          {approvalRequest?.resolution_note && (
            <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>
              {approvalRequest.resolution_note}
            </p>
          )}
        </div>
      )}

      {batchResult?.summary && (
        <div className="card" style={{ marginBottom: "1rem" }} data-testid="campaign-batch-result">
          <p className="text-sm text-muted">
            {typeof batchResult.summary.succeeded === "number" && `Succeeded: ${batchResult.summary.succeeded} · `}
            {typeof batchResult.summary.skipped === "number" && `Skipped: ${batchResult.summary.skipped} · `}
            {typeof batchResult.summary.sent === "number" && `Sent: ${batchResult.summary.sent} · `}
            {typeof batchResult.summary.blocked === "number" && `Blocked: ${batchResult.summary.blocked} · `}
            Failed: {batchResult.summary.failed}
          </p>
          {batchResult.results && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
              {batchResult.results.map((result) => (
                <p key={`${result.prospectId}-${result.status}`} className="text-sm text-muted">
                  {result.prospectId}: {result.status} · {result.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card" data-testid="campaign-prospect-list">
        {filteredRows.length === 0 ? (
          <p className="text-sm text-muted">No prospects match the current filters.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {filteredRows.map((row) => {
              const readiness = computedReadiness(row);
              const sequenceState = readProspectSequenceState(row.prospect.metadata);
              const pauseReason = getSequencePauseReason(row.prospect);

              return (
                <div key={row.prospect.id} style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row.prospect.id)}
                      onChange={() => toggleProspect(row.prospect.id)}
                      data-testid={`campaign-select-${row.prospect.id}`}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                        <div>
                          <Link href={`/dashboard/prospects/${row.prospect.id}`} className="card-link">
                            <strong>{row.prospect.company_name}</strong>
                          </Link>
                          <p className="text-sm text-muted">{row.prospect.website_url}</p>
                          <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                            Prospect: {row.prospect.status} · Outreach: {row.prospect.outreach_status ?? "draft"} · Send: {readiness}
                          </p>
                          {(sequenceState || pauseReason) && (
                            <p className="text-sm text-muted">
                              Sequence: {pauseReason
                                ? `paused (${pauseReason})`
                                : `step ${sequenceState?.current_step ?? 1}`}
                            </p>
                          )}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span className="badge">{readiness}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
