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
    const result = validateDiscount(50000, 170000, "Too much", "operator");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("operators");
  });

  it("requires a reason for any non-zero discount", () => {
    const result = validateDiscount(1000, 170000, "", "sales");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("reason");
  });

  it("limits sales discounts to 10 percent", () => {
    const result = validateDiscount(20000, 170000, "Light promo", "sales");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sales");
    expect(result.error).toContain("10%");
  });

  it("returns approval_required for admin discounts above 25 percent", () => {
    const result = validateDiscount(50000, 170000, "Strategic deal", "admin");
    expect(result.valid).toBe(false);
    expect(result.approval_required).toBe(true);
    expect(result.approval_context).toEqual({
      kind: "large_discount",
      role: "admin",
      percent: expect.any(Number),
    });
  });

  it("blocks discounts above 50 percent for admins", () => {
    const result = validateDiscount(100000, 170000, "Too deep", "admin");
    expect(result.valid).toBe(false);
    expect(result.approval_required).not.toBe(true);
    expect(result.error).toContain("50%");
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
