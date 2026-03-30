import { describe, expect, it } from "vitest";
import { buildClientSendableQuoteSummary } from "./quote-client-summary";
import type { Quote, QuoteLine } from "./types";

describe("buildClientSendableQuoteSummary", () => {
  it("builds a client-sendable subject, body, and summary from quote totals", () => {
    const quote = {
      id: "quote-1",
      project_id: "project-1",
      quote_number: 12,
      revision_id: "rev-1",
      template_id: "service-core",
      selected_modules_snapshot: [],
      status: "draft",
      setup_subtotal_cents: 240000,
      recurring_subtotal_cents: 9900,
      discount_cents: 0,
      discount_percent: null,
      discount_reason: null,
      discount_approved_by: null,
      setup_total_cents: 240000,
      recurring_total_cents: 9900,
      valid_days: 14,
      valid_until: "2026-04-12T00:00:00.000Z",
      client_name: "Acme Painting",
      client_email: "hello@acme.test",
      notes: "Includes launch support.",
      metadata: {},
      created_at: "",
      updated_at: "",
    } satisfies Quote;

    const lines = [
      {
        id: "line-1",
        quote_id: "quote-1",
        line_type: "template",
        reference_id: "service-core",
        label: "Service Core Website",
        description: null,
        setup_price_cents: 200000,
        recurring_price_cents: 9900,
        quantity: 1,
        sort_order: 0,
      },
      {
        id: "line-2",
        quote_id: "quote-1",
        line_type: "module",
        reference_id: "booking-lite",
        label: "Booking Lite",
        description: null,
        setup_price_cents: 40000,
        recurring_price_cents: 0,
        quantity: 1,
        sort_order: 1,
      },
    ] satisfies QuoteLine[];

    const result = buildClientSendableQuoteSummary(quote, lines);
    expect(result.subject).toContain("Quote #12");
    expect(result.subject).toContain("Acme Painting");
    expect(result.summary).toContain("Service Core Website and Booking Lite");
    expect(result.body).toContain("Setup: $2,400");
    expect(result.body).toContain("Monthly: $99 / mo");
    expect(result.body).toContain("Includes launch support.");
  });
});
