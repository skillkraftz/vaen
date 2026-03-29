"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Campaign, Prospect } from "@/lib/types";
import { assignProspectsToCampaignAction } from "../campaigns/actions";

function statusLabel(status: Prospect["status"]) {
  return status.replaceAll("_", " ");
}

export function ProspectListManager({
  prospects,
  campaigns,
}: {
  prospects: Prospect[];
  campaigns: Campaign[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedCount = selectedIds.length;
  const campaignsById = useMemo(
    () => new Map(campaigns.map((campaign) => [campaign.id, campaign])),
    [campaigns],
  );

  function toggleProspect(prospectId: string) {
    setSelectedIds((current) => (
      current.includes(prospectId)
        ? current.filter((id) => id !== prospectId)
        : [...current, prospectId]
    ));
  }

  function assignSelected() {
    setError(null);
    startTransition(async () => {
      const result = await assignProspectsToCampaignAction({
        prospectIds: selectedIds,
        campaignId: campaignId || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSelectedIds([]);
      router.refresh();
    });
  }

  return (
    <div className="section" data-testid="prospect-list-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Prospects</h1>
          <p className="text-sm text-muted">
            Group outreach targets into campaigns, review readiness, and move them toward controlled batch sending.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Link href="/dashboard/campaigns" className="btn btn-sm" data-testid="campaign-list-link">
            Campaigns
          </Link>
          <Link href="/dashboard/prospects/import" className="btn btn-sm" data-testid="prospect-import-link">
            Import Prospects
          </Link>
          <Link href="/dashboard/prospects/new" className="btn btn-primary" data-testid="new-prospect-link">
            + New Prospect
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="prospect-bulk-assign">
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ minWidth: "16rem" }}>
            <label className="form-label" htmlFor="bulkCampaignId">Assign selected to campaign</label>
            <select
              id="bulkCampaignId"
              className="form-input"
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              data-testid="prospect-bulk-campaign-select"
            >
              <option value="">No campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={assignSelected}
            disabled={isPending || selectedCount === 0}
            data-testid="prospect-bulk-assign-button"
          >
            {isPending ? "Saving..." : `Assign ${selectedCount || ""}`.trim()}
          </button>
        </div>
        <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
          Duplicate handling on import is website-based. Existing prospects and duplicate rows are skipped explicitly rather than merged silently.
        </p>
        {error && (
          <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.5rem" }}>
            {error}
          </p>
        )}
      </div>

      <div className="card" data-testid="prospect-list">
        {prospects.length === 0 ? (
          <p className="text-sm text-muted">No prospects yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {prospects.map((prospect) => {
              const linkedCampaign = prospect.campaign_id ? campaignsById.get(prospect.campaign_id) ?? null : null;
              return (
                <div
                  key={prospect.id}
                  data-testid={`prospect-card-${prospect.id}`}
                  style={{ padding: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "0.75rem" }}
                >
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(prospect.id)}
                      onChange={() => toggleProspect(prospect.id)}
                      aria-label={`Select ${prospect.company_name}`}
                      data-testid={`prospect-select-${prospect.id}`}
                    />
                    <Link href={`/dashboard/prospects/${prospect.id}`} className="card-link" style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                        <div>
                          <strong>{prospect.company_name}</strong>
                          <p className="text-sm text-muted">{prospect.website_url}</p>
                          <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                            Campaign: {linkedCampaign?.name ?? prospect.campaign ?? "None"} · Outreach: {prospect.outreach_status ?? "draft"}
                          </p>
                          {prospect.outreach_summary && (
                            <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                              {prospect.outreach_summary}
                            </p>
                          )}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span className="badge">{statusLabel(prospect.status)}</span>
                          <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>
                            {new Date(prospect.created_at).toLocaleDateString("en-US")}
                          </p>
                        </div>
                      </div>
                    </Link>
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
