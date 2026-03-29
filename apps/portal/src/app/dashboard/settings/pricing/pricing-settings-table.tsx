"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PackagePricing, PricingChangeEvent } from "@/lib/types";
import { formatCurrency } from "@/lib/quote-helpers";
import { formatPricingDollars } from "@/lib/pricing-settings";
import { updatePricingItemAction } from "./actions";

interface PricingDraft {
  label: string;
  description: string;
  setupPrice: string;
  recurringPrice: string;
  active: boolean;
  changeReason: string;
}

function toDraft(item: PackagePricing): PricingDraft {
  return {
    label: item.label,
    description: item.description ?? "",
    setupPrice: formatPricingDollars(item.setup_price_cents),
    recurringPrice: formatPricingDollars(item.recurring_price_cents),
    active: item.active,
    changeReason: "",
  };
}

function parseCurrencyInput(value: string) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return NaN;
  return Math.round(numeric * 100);
}

function PricingRow({
  item,
  onSaved,
}: {
  item: PackagePricing;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<PricingDraft>(() => toDraft(item));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updatePricingItemAction(item.id, {
        label: draft.label,
        description: draft.description,
        setup_price_cents: parseCurrencyInput(draft.setupPrice),
        recurring_price_cents: parseCurrencyInput(draft.recurringPrice),
        active: draft.active,
        change_reason: draft.changeReason,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setDraft((current) => ({ ...current, changeReason: "" }));
      onSaved();
    });
  }

  return (
    <tr data-testid={`pricing-row-${item.id}`}>
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <strong>{item.id}</strong>
          <span className="badge">{item.item_type}</span>
        </div>
      </td>
      <td>
        <input
          className="form-input"
          value={draft.label}
          onChange={(e) => setDraft((current) => ({ ...current, label: e.target.value }))}
        />
      </td>
      <td>
        <input
          className="form-input"
          value={draft.description}
          onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))}
          placeholder="Description"
        />
      </td>
      <td>
        <input
          className="form-input text-mono"
          value={draft.setupPrice}
          onChange={(e) => setDraft((current) => ({ ...current, setupPrice: e.target.value }))}
          inputMode="decimal"
        />
      </td>
      <td>
        <input
          className="form-input text-mono"
          value={draft.recurringPrice}
          onChange={(e) => setDraft((current) => ({ ...current, recurringPrice: e.target.value }))}
          inputMode="decimal"
        />
      </td>
      <td>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft((current) => ({ ...current, active: e.target.checked }))}
          />
          {draft.active ? "Active" : "Inactive"}
        </label>
      </td>
      <td>
        <input
          className="form-input"
          value={draft.changeReason}
          onChange={(e) => setDraft((current) => ({ ...current, changeReason: e.target.value }))}
          placeholder="Optional change note"
        />
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={save}
          disabled={isPending}
          data-testid={`pricing-save-${item.id}`}
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        {error && (
          <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.35rem", maxWidth: "14rem" }}>
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

export function PricingSettingsTable({
  items,
  history,
  error,
}: {
  items: PackagePricing[];
  history: PricingChangeEvent[];
  error?: string;
}) {
  const router = useRouter();
  const grouped = useMemo(() => ({
    templates: items.filter((item) => item.item_type === "template"),
    modules: items.filter((item) => item.item_type === "module"),
  }), [items]);

  return (
    <div className="section" data-testid="pricing-settings-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Pricing Settings</h1>
          <p className="text-sm text-muted">
            Changes here affect future quotes only. Existing quotes remain immutable historical snapshots.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="text-sm text-muted">
          Edit template and module defaults here. Quote creation will read the latest active pricing rows, but existing quote lines and totals will not be rewritten.
        </p>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p className="text-sm" style={{ color: "var(--color-error)" }}>{error}</p>
        </div>
      )}

      {[
        { title: "Templates", items: grouped.templates },
        { title: "Modules", items: grouped.modules },
      ].map((group) => (
        <div className="section" key={group.title} style={{ padding: 0 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>{group.title}</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="info-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Label</th>
                  <th>Description</th>
                  <th>Setup</th>
                  <th>Recurring</th>
                  <th>Status</th>
                  <th>Audit Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <PricingRow key={item.id} item={item} onSaved={() => router.refresh()} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="section">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Recent Pricing Changes</h2>
        <div className="card" data-testid="pricing-history-list">
          {history.length === 0 ? (
            <p className="text-sm text-muted">No pricing changes recorded yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {history.map((entry) => (
                <div key={entry.id} style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                    <strong>{entry.pricing_item_id}</strong>
                    <span className="text-sm text-muted">
                      {entry.changed_by_email ?? entry.changed_by} · {new Date(entry.created_at).toLocaleString("en-US")}
                    </span>
                  </div>
                  {entry.change_reason && (
                    <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                      Note: {entry.change_reason}
                    </p>
                  )}
                  <div className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>
                    {Object.keys(entry.next_values).map((field) => {
                      const nextValue = entry.next_values[field];
                      const previousValue = entry.previous_values[field];
                      const renderValue = (value: unknown) => {
                        if (typeof value === "number" && field.endsWith("_cents")) {
                          return formatCurrency(value);
                        }
                        return String(value);
                      };
                      return (
                        <div key={field}>
                          {field}: {renderValue(previousValue)} → {renderValue(nextValue)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
