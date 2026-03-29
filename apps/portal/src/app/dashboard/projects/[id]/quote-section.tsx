"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Quote, QuoteLine, SelectedModule } from "@/lib/types";
import { formatCurrency, isQuoteOutdated } from "@/lib/quote-helpers";
import {
  addQuoteLineAction,
  createQuoteAction,
  removeQuoteLineAction,
  setQuoteDiscountAction,
  updateQuoteLineAction,
} from "./actions";

function QuoteLineEditor({
  line,
  editable,
}: {
  line: QuoteLine;
  editable: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState(line.label);
  const [description, setDescription] = useState(line.description ?? "");
  const [setup, setSetup] = useState(String(line.setup_price_cents));
  const [recurring, setRecurring] = useState(String(line.recurring_price_cents));

  function save() {
    startTransition(async () => {
      await updateQuoteLineAction(line.id, {
        label,
        description,
        setup_price_cents: Number(setup),
        recurring_price_cents: Number(recurring),
      });
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      await removeQuoteLineAction(line.id);
      router.refresh();
    });
  }

  return (
    <tr data-testid={`quote-line-${line.id}`}>
      <td>
        {editable ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input className="form-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
          </div>
        ) : (
          <div>
            <strong>{line.label}</strong>
            {line.description && <p className="text-sm text-muted">{line.description}</p>}
          </div>
        )}
      </td>
      <td>
        {editable ? (
          <input className="form-input text-mono" value={setup} onChange={(e) => setSetup(e.target.value)} />
        ) : (
          formatCurrency(line.setup_price_cents)
        )}
      </td>
      <td>
        {editable ? (
          <input className="form-input text-mono" value={recurring} onChange={(e) => setRecurring(e.target.value)} />
        ) : (
          formatCurrency(line.recurring_price_cents)
        )}
      </td>
      {editable && (
        <td style={{ whiteSpace: "nowrap" }}>
          <button type="button" className="btn btn-sm" onClick={save} disabled={isPending}>
            Save
          </button>
          {line.line_type === "addon" && (
            <button type="button" className="btn btn-sm" onClick={remove} disabled={isPending} style={{ marginLeft: "0.5rem" }}>
              Remove
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function QuoteCard({
  quote,
  currentModules,
}: {
  quote: Quote & { lines: QuoteLine[] };
  currentModules: SelectedModule[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [addonLabel, setAddonLabel] = useState("");
  const [addonSetup, setAddonSetup] = useState("0");
  const [addonRecurring, setAddonRecurring] = useState("0");
  const [discountPercent, setDiscountPercent] = useState(quote.discount_percent != null ? String(quote.discount_percent) : "");
  const [discountReason, setDiscountReason] = useState(quote.discount_reason ?? "");
  const editable = quote.status === "draft";
  const outdated = isQuoteOutdated(currentModules, quote.selected_modules_snapshot);

  function addAddon() {
    startTransition(async () => {
      await addQuoteLineAction(quote.id, {
        label: addonLabel,
        setup_price_cents: Number(addonSetup),
        recurring_price_cents: Number(addonRecurring),
      });
      setAddonLabel("");
      setAddonSetup("0");
      setAddonRecurring("0");
      router.refresh();
    });
  }

  function saveDiscount() {
    startTransition(async () => {
      await setQuoteDiscountAction(quote.id, {
        percent: discountPercent === "" ? 0 : Number(discountPercent),
        reason: discountReason,
      });
      router.refresh();
    });
  }

  return (
    <div className="card" data-testid={`quote-card-${quote.id}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <div>
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Quote #{quote.quote_number}</h3>
          <p className="text-sm text-muted">
            Revision snapshot: <span className="text-mono">{quote.revision_id ?? "none"}</span>
          </p>
        </div>
        <span className="badge" data-testid={`quote-status-${quote.status}`}>
          {quote.status}
        </span>
      </div>

      {outdated && (
        <p className="text-sm" style={{ color: "var(--color-warning)" }} data-testid="quote-outdated-warning">
          Module selection has changed since this quote was created.
        </p>
      )}

      <table className="info-table" style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Setup</th>
            <th>Monthly</th>
            {editable && <th />}
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((line) => (
            <QuoteLineEditor key={line.id} line={line} editable={editable} />
          ))}
          {editable && (
            <tr>
              <td>
                <input className="form-input" value={addonLabel} onChange={(e) => setAddonLabel(e.target.value)} placeholder="Custom line item" />
              </td>
              <td>
                <input className="form-input text-mono" value={addonSetup} onChange={(e) => setAddonSetup(e.target.value)} />
              </td>
              <td>
                <input className="form-input text-mono" value={addonRecurring} onChange={(e) => setAddonRecurring(e.target.value)} />
              </td>
              <td>
                <button type="button" className="btn btn-sm" onClick={addAddon} disabled={isPending}>
                  Add line
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editable && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
          <div>
            <label className="form-label">Discount %</label>
            <input className="form-input text-mono" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Discount reason</label>
            <input className="form-input" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <button type="button" className="btn btn-sm" onClick={saveDiscount} disabled={isPending}>
              Save Discount
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Subtotal</span>
          <span>{formatCurrency(quote.setup_subtotal_cents)} / {formatCurrency(quote.recurring_subtotal_cents)} mo</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }} data-testid="quote-discount">
          <span>Discount</span>
          <span>{formatCurrency(quote.discount_cents)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
          <span>Total</span>
          <span>
            <span data-testid="quote-total-setup">{formatCurrency(quote.setup_total_cents)}</span>
            {" / "}
            <span data-testid="quote-total-recurring">{formatCurrency(quote.recurring_total_cents)} mo</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export function QuoteSection({
  projectId,
  quotes,
  currentModules,
}: {
  projectId: string;
  quotes: Array<Quote & { lines: QuoteLine[] }>;
  currentModules: SelectedModule[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function createQuote() {
    startTransition(async () => {
      const result = await createQuoteAction(projectId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="section" data-testid="quote-section">
      <h2 className="mb-1" style={{ fontSize: "1rem", fontWeight: 600 }}>
        Quote
      </h2>

      {quotes.length === 0 ? (
        <div className="card">
          <p className="text-muted">No quote created yet.</p>
          <button type="button" className="btn btn-sm btn-primary" onClick={createQuote} disabled={isPending} data-testid="btn-create-quote" style={{ marginTop: "0.75rem" }}>
            {isPending ? "Creating..." : "Create Quote"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <button type="button" className="btn btn-sm" onClick={createQuote} disabled={isPending} data-testid="btn-create-quote">
              {isPending ? "Creating..." : "Create New Quote"}
            </button>
          </div>
          {quotes.map((quote) => (
            <QuoteCard key={quote.id} quote={quote} currentModules={currentModules} />
          ))}
        </div>
      )}
      {error && (
        <p className="text-sm" style={{ color: "var(--color-error)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
