"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Campaign } from "@/lib/types";
import { previewProspectImportRows } from "@/lib/prospect-campaigns";
import { importProspectsAction } from "../../campaigns/actions";

export function ProspectImportForm({
  campaigns,
}: {
  campaigns: Campaign[];
}) {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [createCampaignName, setCreateCampaignName] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof importProspectsAction>> | null>(null);
  const [isPending, startTransition] = useTransition();

  const preview = useMemo(
    () => previewProspectImportRows({ rawText }),
    [rawText],
  );

  function handleFile(file: File | null) {
    if (!file) return;
    file.text().then((text) => setRawText(text));
  }

  function runImport() {
    startTransition(async () => {
      const next = await importProspectsAction({
        rawText,
        campaignId: campaignId || null,
        createCampaignName: createCampaignName || null,
      });
      setResult(next);
      if (!next.error) {
        router.refresh();
      }
    });
  }

  return (
    <div className="section" data-testid="prospect-import-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Import Prospects</h1>
          <p className="text-sm text-muted">
            Paste CSV or tab-delimited rows with a header. Valid rows import, invalid rows stay visible, and duplicate websites are skipped explicitly.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <label className="form-label" htmlFor="prospectImportFile">CSV or TSV file</label>
        <input
          id="prospectImportFile"
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          className="form-input"
          onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
          data-testid="prospect-import-file"
        />
        <label className="form-label" htmlFor="prospectImportText" style={{ marginTop: "0.75rem" }}>Import text</label>
        <textarea
          id="prospectImportText"
          className="form-input"
          rows={10}
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          placeholder={"company_name,website_url,contact_name,contact_email,contact_phone,notes,source,campaign\nAcme Painting,acme.test,Alex,alex@acme.test,(555) 111-2222,High-end residential,manual,Spring Wave"}
          data-testid="prospect-import-text"
        />
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <div>
            <label className="form-label" htmlFor="importCampaignId">Assign imported rows to an existing campaign</label>
            <select
              id="importCampaignId"
              className="form-input"
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              data-testid="prospect-import-campaign-select"
            >
              <option value="">No campaign</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="createCampaignName">Or create a new campaign</label>
            <input
              id="createCampaignName"
              className="form-input"
              value={createCampaignName}
              onChange={(event) => setCreateCampaignName(event.target.value)}
              placeholder="Spring outreach wave"
              data-testid="prospect-import-create-campaign"
            />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: "0.75rem" }}
          disabled={isPending || preview.summary.valid === 0}
          onClick={runImport}
          data-testid="prospect-import-submit"
        >
          {isPending ? "Importing..." : `Import ${preview.summary.valid} valid row${preview.summary.valid === 1 ? "" : "s"}`}
        </button>
        {result?.error && (
          <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.5rem" }}>
            {result.error}
          </p>
        )}
      </div>

      <div className="card" data-testid="prospect-import-preview">
        <p className="text-sm text-muted" style={{ marginBottom: "0.75rem" }}>
          Total: {preview.summary.total} · Valid: {preview.summary.valid} · Invalid: {preview.summary.invalid} · Duplicates: {preview.summary.duplicates}
        </p>
        {preview.rows.length === 0 ? (
          <p className="text-sm text-muted">Paste CSV or TSV rows to preview the import.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {preview.rows.map((row) => (
              <div key={row.rowNumber} style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                  <strong>Row {row.rowNumber}: {row.company_name || "Missing company"}</strong>
                  <span className="badge">{row.valid ? "valid" : row.duplicate_reason ? "duplicate" : "invalid"}</span>
                </div>
                <p className="text-sm text-muted">{row.website_url}</p>
                {!row.valid && (
                  <p className="text-sm" style={{ color: "var(--color-warning)" }}>
                    {row.duplicate_reason ?? row.errors.join(" ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {result?.summary && (
        <div className="card" style={{ marginTop: "1rem" }} data-testid="prospect-import-result">
          <p className="text-sm text-muted">
            Imported: {result.summary.imported} · Invalid: {result.summary.invalid} · Duplicates: {result.summary.duplicates}
          </p>
        </div>
      )}
    </div>
  );
}
