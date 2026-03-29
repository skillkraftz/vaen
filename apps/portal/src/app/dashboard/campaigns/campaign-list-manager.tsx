"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Campaign } from "@/lib/types";
import { createCampaignAction } from "./actions";

export function CampaignListManager({
  campaigns,
  metricsByCampaignId,
}: {
  campaigns: Campaign[];
  metricsByCampaignId: Record<string, { prospects: number; sent: number; ready: number }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function createCampaign() {
    setError(null);
    startTransition(async () => {
      const result = await createCampaignAction({ name, description });
      if (result.error) {
        setError(result.error);
        return;
      }
      setName("");
      setDescription("");
      router.refresh();
    });
  }

  return (
    <div className="section" data-testid="campaign-list-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Campaigns</h1>
          <p className="text-sm text-muted">
            Group prospects into repeatable outreach runs without losing the underlying prospect and send history.
          </p>
        </div>
        <Link href="/dashboard/prospects/import" className="btn btn-sm" data-testid="campaign-import-link">
          Import Prospects
        </Link>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <input
            className="form-input"
            placeholder="Campaign name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-testid="campaign-name-input"
          />
          <input
            className="form-input"
            placeholder="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            data-testid="campaign-description-input"
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: "0.75rem" }}
          onClick={createCampaign}
          disabled={isPending}
          data-testid="campaign-create-button"
        >
          {isPending ? "Creating..." : "Create Campaign"}
        </button>
        {error && (
          <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.5rem" }}>
            {error}
          </p>
        )}
      </div>

      <div className="card" data-testid="campaign-list">
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted">No campaigns yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {campaigns.map((campaign) => {
              const metrics = metricsByCampaignId[campaign.id] ?? { prospects: 0, sent: 0, ready: 0 };
              return (
                <Link
                  key={campaign.id}
                  href={`/dashboard/campaigns/${campaign.id}`}
                  className="card-link"
                  style={{ padding: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "0.75rem" }}
                  data-testid={`campaign-card-${campaign.id}`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                    <div>
                      <strong>{campaign.name}</strong>
                      <p className="text-sm text-muted">{campaign.description ?? "No description"}</p>
                      <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                        Prospects: {metrics.prospects} · Ready: {metrics.ready} · Sent: {metrics.sent}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className="badge">{campaign.status}</span>
                      <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>
                        {campaign.last_activity_at
                          ? `Active ${new Date(campaign.last_activity_at).toLocaleDateString("en-US")}`
                          : new Date(campaign.created_at).toLocaleDateString("en-US")}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
