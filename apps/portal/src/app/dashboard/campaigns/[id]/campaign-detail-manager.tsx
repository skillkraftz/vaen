"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getProspectSendReadiness } from "@/lib/outreach-execution";
import type { Campaign, Prospect, ProspectOutreachPackage } from "@/lib/types";
import {
  batchGenerateCampaignPackagesAction,
  batchSendCampaignOutreachAction,
  updateCampaignStatusAction,
} from "../actions";

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
}: {
  campaign: Campaign;
  rows: CampaignProspectRow[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [readinessFilter, setReadinessFilter] = useState("all");
  const [campaignStatus, setCampaignStatus] = useState<Campaign["status"]>(campaign.status);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [batchResult, setBatchResult] = useState<{
    summary?: { sent: number; blocked: number; failed: number };
    results?: Array<{ prospectId: string; status: string; message: string }>;
  } | null>(null);
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

  const confirmationPhrase = `SEND ${selectedIds.length} EMAIL${selectedIds.length === 1 ? "" : "S"}`;

  function toggleProspect(prospectId: string) {
    setSelectedIds((current) => (
      current.includes(prospectId)
        ? current.filter((id) => id !== prospectId)
        : [...current, prospectId]
    ));
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

  function sendSelected() {
    setError(null);
    startTransition(async () => {
      const result = await batchSendCampaignOutreachAction({
        prospectIds: selectedIds,
        confirmPhrase,
      });
      if (result.error) {
        setError(result.error);
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

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="campaign-batch-actions">
        <p className="text-sm text-muted" style={{ marginBottom: "0.75rem" }}>
          Selected prospects: {selectedIds.length}. Batch actions stay explicit: package generation is safe to run in bulk, and sending requires a typed confirmation phrase.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }}>
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

      {batchResult?.summary && (
        <div className="card" style={{ marginBottom: "1rem" }} data-testid="campaign-batch-result">
          <p className="text-sm text-muted">
            Sent: {batchResult.summary.sent} · Blocked: {batchResult.summary.blocked} · Failed: {batchResult.summary.failed}
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
