import { describe, expect, it } from "vitest";
import {
  calculateQuoteTotals,
  getQuoteOutdatedReasons,
  isQuoteOutdated,
  resolveDiscountCents,
  validateDiscount,
} from "./quote-helpers";

describe("quote helpers", () => {
  it("calculates setup and recurring totals from quote lines", () => {
    const totals = calculateQuoteTotals({
      lines: [
        { line_type: "template", setup_price_cents: 150000, recurring_price_cents: 9900, quantity: 1 },
        { line_type: "module", setup_price_cents: 20000, recurring_price_cents: 2500, quantity: 1 },
      ],
      discountCents: 17000,
    });

    expect(totals.setupSubtotalCents).toBe(170000);
    expect(totals.recurringSubtotalCents).toBe(12400);
    expect(totals.setupTotalCents).toBe(153000);
    expect(totals.recurringTotalCents).toBe(12400);
  });

  it("resolves percentage discounts into cents", () => {
    expect(resolveDiscountCents({ subtotalCents: 170000, discountPercent: 10 })).toBe(17000);
  });

  it("blocks discounts over 25 percent", () => {
    const result = validateDiscount(50000, 170000, "Too much");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("25%");
  });

  it("requires a reason for any non-zero discount", () => {
    const result = validateDiscount(1000, 170000, "");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("reason");
  });

  it("detects outdated quotes by module id snapshot", () => {
    expect(isQuoteOutdated(
      [{ id: "maps-embed" }, { id: "manual-testimonials" }],
      [{ id: "maps-embed" }],
    )).toBe(true);
  });

  it("reports revision and template drift as outdated reasons", () => {
    expect(getQuoteOutdatedReasons({
      currentModules: [{ id: "maps-embed" }],
      snapshotModules: [{ id: "maps-embed" }],
      currentRevisionId: "rev-2",
      quoteRevisionId: "rev-1",
      currentTemplateId: "service-pro",
      quoteTemplateId: "service-core",
    })).toEqual([
      "Project revision has changed since this quote snapshot.",
      "Template selection has changed since this quote was created.",
    ]);
  });
});
