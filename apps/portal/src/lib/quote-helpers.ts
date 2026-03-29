import type { QuoteLine, SelectedModule, UserRole } from "./types";

export interface QuoteLineDraft {
  line_type: QuoteLine["line_type"];
  reference_id: string | null;
  label: string;
  description: string | null;
  setup_price_cents: number;
  recurring_price_cents: number;
  quantity: number;
  sort_order: number;
}

export function calculateQuoteSubtotals(lines: Array<Pick<QuoteLine, "line_type" | "setup_price_cents" | "recurring_price_cents" | "quantity">>) {
  return lines.reduce(
    (totals, line) => {
      if (line.line_type === "discount") return totals;
      const quantity = Math.max(1, line.quantity ?? 1);
      totals.setup += line.setup_price_cents * quantity;
      totals.recurring += line.recurring_price_cents * quantity;
      return totals;
    },
    { setup: 0, recurring: 0 },
  );
}

export interface DiscountValidationResult {
  valid: boolean;
  error?: string;
  percent?: number;
  approval_required?: boolean;
  approval_context?: {
    kind: "large_discount";
    role: UserRole;
    percent: number;
  };
}

export function validateDiscount(
  discountCents: number,
  subtotalCents: number,
  reason: string | null,
  role: UserRole = "operator",
): DiscountValidationResult {
  if (discountCents < 0) return { valid: false, error: "Discount cannot be negative." };
  if (discountCents > subtotalCents) return { valid: false, error: "Discount cannot exceed subtotal." };
  if (subtotalCents === 0) return { valid: true, percent: 0 };

  if (discountCents > 0 && (!reason || reason.trim().length < 3)) {
    return { valid: false, error: "A reason is required for discounts." };
  }

  const percent = subtotalCents > 0 ? (discountCents / subtotalCents) * 100 : 0;
  if (percent > 50) {
    return {
      valid: false,
      error: `Discount of ${percent.toFixed(0)}% exceeds maximum allowed (50%).`,
    };
  }

  if (role === "sales" && percent > 10) {
    return {
      valid: false,
      error: `Discount of ${percent.toFixed(0)}% exceeds maximum allowed for sales (10%).`,
    };
  }

  if (role === "operator" && percent > 25) {
    return {
      valid: false,
      error: `Discount of ${percent.toFixed(0)}% exceeds maximum allowed for operators (25%).`,
    };
  }

  if (role === "admin" && percent > 25) {
    return {
      valid: false,
      percent,
      approval_required: true,
      approval_context: {
        kind: "large_discount",
        role,
        percent,
      },
    };
  }

  return { valid: true, percent };
}

export function resolveDiscountCents(params: {
  subtotalCents: number;
  discountPercent?: number | null;
  discountCents?: number | null;
}) {
  const subtotal = Math.max(0, params.subtotalCents);
  if (params.discountPercent != null) {
    const percent = Math.max(0, params.discountPercent);
    return Math.round(subtotal * (percent / 100));
  }
  return Math.max(0, params.discountCents ?? 0);
}

export function calculateQuoteTotals(params: {
  lines: Array<Pick<QuoteLine, "line_type" | "setup_price_cents" | "recurring_price_cents" | "quantity">>;
  discountCents: number;
}) {
  const subtotals = calculateQuoteSubtotals(params.lines);
  const totals = {
    setupSubtotalCents: subtotals.setup,
    recurringSubtotalCents: subtotals.recurring,
    setupTotalCents: Math.max(0, subtotals.setup - params.discountCents),
    recurringTotalCents: subtotals.recurring,
  };
  return totals;
}

export function isQuoteOutdated(
  currentModules: SelectedModule[],
  snapshotModules: SelectedModule[],
) {
  const currentIds = [...new Set(currentModules.map((module) => module.id))].sort();
  const snapshotIds = [...new Set(snapshotModules.map((module) => module.id))].sort();
  return JSON.stringify(currentIds) !== JSON.stringify(snapshotIds);
}

export function getQuoteOutdatedReasons(params: {
  currentModules: SelectedModule[];
  snapshotModules: SelectedModule[];
  currentRevisionId: string | null;
  quoteRevisionId: string | null;
  currentTemplateId: string;
  quoteTemplateId: string;
}) {
  const reasons: string[] = [];
  if (isQuoteOutdated(params.currentModules, params.snapshotModules)) {
    reasons.push("Module selection has changed since this quote was created.");
  }
  if (params.currentRevisionId && params.quoteRevisionId && params.currentRevisionId !== params.quoteRevisionId) {
    reasons.push("Project revision has changed since this quote snapshot.");
  }
  if (params.currentTemplateId !== params.quoteTemplateId) {
    reasons.push("Template selection has changed since this quote was created.");
  }
  return reasons;
}

export function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
