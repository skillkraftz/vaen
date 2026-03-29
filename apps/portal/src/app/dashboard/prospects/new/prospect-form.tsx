"use client";

import { useActionState } from "react";
import { createProspectAction } from "../actions";

const initialState = { error: "" };

export function ProspectForm() {
  const [state, formAction, pending] = useActionState(createProspectAction, initialState);

  return (
    <form action={formAction} className="section" data-testid="new-prospect-form">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>New Prospect</h1>
          <p className="text-sm text-muted">
            Capture a company, analyze its current site, then convert it into a client and project when ready.
          </p>
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <div>
          <label className="form-label" htmlFor="companyName">Company Name</label>
          <input id="companyName" name="companyName" className="form-input" required />
        </div>
        <div>
          <label className="form-label" htmlFor="websiteUrl">Website URL</label>
          <input id="websiteUrl" name="websiteUrl" className="form-input" placeholder="https://example.com" required />
        </div>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
          <div>
            <label className="form-label" htmlFor="contactName">Contact Name</label>
            <input id="contactName" name="contactName" className="form-input" />
          </div>
          <div>
            <label className="form-label" htmlFor="contactEmail">Contact Email</label>
            <input id="contactEmail" name="contactEmail" className="form-input" type="email" />
          </div>
          <div>
            <label className="form-label" htmlFor="contactPhone">Contact Phone</label>
            <input id="contactPhone" name="contactPhone" className="form-input" />
          </div>
        </div>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
          <div>
            <label className="form-label" htmlFor="source">Source</label>
            <input id="source" name="source" className="form-input" placeholder="Cold list, referral, import..." />
          </div>
          <div>
            <label className="form-label" htmlFor="campaign">Campaign</label>
            <input id="campaign" name="campaign" className="form-input" placeholder="Spring painters batch" />
          </div>
        </div>
        <div>
          <label className="form-label" htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" className="form-input" rows={5} />
        </div>
        {state.error && (
          <p className="text-sm" style={{ color: "var(--color-error)" }}>{state.error}</p>
        )}
        <div>
          <button type="submit" className="btn btn-primary" data-testid="create-prospect-submit" disabled={pending}>
            {pending ? "Creating..." : "Create Prospect"}
          </button>
        </div>
      </div>
    </form>
  );
}
