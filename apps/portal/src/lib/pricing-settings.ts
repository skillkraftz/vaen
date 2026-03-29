import type { PackagePricing } from "./types";

type EditablePricingFields = Pick<
  PackagePricing,
  "label" | "description" | "setup_price_cents" | "recurring_price_cents" | "active"
>;

export interface PricingItemUpdateInput {
  label: string;
  description?: string | null;
  setup_price_cents: number;
  recurring_price_cents: number;
  active: boolean;
  change_reason?: string | null;
}

export function validatePricingItemUpdate(input: PricingItemUpdateInput): {
  valid: boolean;
  error?: string;
} {
  if (input.label.trim().length === 0) {
    return { valid: false, error: "Label is required." };
  }
  if (!Number.isFinite(input.setup_price_cents) || input.setup_price_cents < 0) {
    return { valid: false, error: "Setup price must be a non-negative amount." };
  }
  if (!Number.isFinite(input.recurring_price_cents) || input.recurring_price_cents < 0) {
    return { valid: false, error: "Recurring price must be a non-negative amount." };
  }
  return { valid: true };
}

export function sanitizePricingItemUpdate(input: PricingItemUpdateInput): EditablePricingFields {
  return {
    label: input.label.trim(),
    description: input.description?.trim() ? input.description.trim() : null,
    setup_price_cents: Math.max(0, Math.round(input.setup_price_cents)),
    recurring_price_cents: Math.max(0, Math.round(input.recurring_price_cents)),
    active: !!input.active,
  };
}

export function buildPricingChangeAudit(
  previous: PackagePricing,
  next: EditablePricingFields,
): {
  changed: boolean;
  previousValues: Record<string, unknown>;
  nextValues: Record<string, unknown>;
  changedFields: string[];
} {
  const changedFields: string[] = [];
  const previousValues: Record<string, unknown> = {};
  const nextValues: Record<string, unknown> = {};

  const entries: Array<keyof EditablePricingFields> = [
    "label",
    "description",
    "setup_price_cents",
    "recurring_price_cents",
    "active",
  ];

  for (const key of entries) {
    if (previous[key] !== next[key]) {
      changedFields.push(key);
      previousValues[key] = previous[key];
      nextValues[key] = next[key];
    }
  }

  return {
    changed: changedFields.length > 0,
    previousValues,
    nextValues,
    changedFields,
  };
}

export function formatPricingDollars(cents: number) {
  return (cents / 100).toFixed(2);
}
