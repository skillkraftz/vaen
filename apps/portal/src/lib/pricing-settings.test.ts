import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildPricingChangeAudit,
  sanitizePricingItemUpdate,
  validatePricingItemUpdate,
} from "./pricing-settings";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("pricing settings schema", () => {
  it("adds pricing change events and pricing policies", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000008_add_pricing_change_events.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("alter table public.package_pricing enable row level security");
    expect(source).toContain('create policy "Authenticated users can read pricing"');
    expect(source).toContain("create table if not exists public.pricing_change_events");
    expect(source).toContain("previous_values jsonb");
    expect(source).toContain("next_values jsonb");
    expect(source).toContain("changed_by_email");
  });
});

describe("pricing settings helpers", () => {
  it("rejects negative setup and recurring pricing", () => {
    expect(validatePricingItemUpdate({
      label: "Service Core",
      setup_price_cents: -1,
      recurring_price_cents: 1000,
      active: true,
    })).toEqual({
      valid: false,
      error: "Setup price must be a non-negative amount.",
    });

    expect(validatePricingItemUpdate({
      label: "Service Core",
      setup_price_cents: 1000,
      recurring_price_cents: -1,
      active: true,
    })).toEqual({
      valid: false,
      error: "Recurring price must be a non-negative amount.",
    });
  });

  it("sanitizes label, description, and price values", () => {
    expect(sanitizePricingItemUpdate({
      label: "  Service Core Website  ",
      description: "  Standard service business website  ",
      setup_price_cents: 150000.4,
      recurring_price_cents: 9900.2,
      active: true,
    })).toEqual({
      label: "Service Core Website",
      description: "Standard service business website",
      setup_price_cents: 150000,
      recurring_price_cents: 9900,
      active: true,
    });
  });

  it("records old vs new values for audit history", () => {
    const audit = buildPricingChangeAudit(
      {
        id: "booking-lite",
        item_type: "module",
        label: "Online Booking",
        description: "Calendly / Cal.com embed",
        setup_price_cents: 20000,
        recurring_price_cents: 2500,
        active: true,
        sort_order: 12,
        created_at: "",
        updated_at: "",
      },
      {
        label: "Booking Lite",
        description: "Calendly widget",
        setup_price_cents: 25000,
        recurring_price_cents: 3000,
        active: false,
      },
    );

    expect(audit.changed).toBe(true);
    expect(audit.changedFields).toEqual([
      "label",
      "description",
      "setup_price_cents",
      "recurring_price_cents",
      "active",
    ]);
    expect(audit.previousValues.setup_price_cents).toBe(20000);
    expect(audit.nextValues.active).toBe(false);
  });
});

describe("pricing settings actions and UI", () => {
  it("exports pricing settings actions", () => {
    const actionsPath = join(__dirname, "../app/dashboard/settings/pricing/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function listPricingSettingsAction");
    expect(source).toContain("export async function updatePricingItemAction");
    expect(source).toContain("validatePricingItemUpdate");
    expect(source).toContain('from("pricing_change_events").insert');
    expect(source).toContain('from("package_pricing")');
  });

  it("renders a dedicated pricing settings surface with history", () => {
    const pagePath = join(__dirname, "../app/dashboard/settings/pricing/page.tsx");
    const uiPath = join(__dirname, "../app/dashboard/settings/pricing/pricing-settings-table.tsx");
    const pageSource = readFileSync(pagePath, "utf-8");
    const uiSource = readFileSync(uiPath, "utf-8");
    expect(pageSource).toContain("PricingSettingsTable");
    expect(uiSource).toContain('data-testid="pricing-settings-page"');
    expect(uiSource).toContain('data-testid="pricing-history-list"');
    expect(uiSource).toContain("future quotes only");
    expect(uiSource).toContain("immutable historical snapshots");
    expect(uiSource).toContain("template");
    expect(uiSource).toContain("module");
  });

  it("adds pricing navigation in the dashboard layout", () => {
    const layoutPath = join(__dirname, "../app/dashboard/layout.tsx");
    const source = readFileSync(layoutPath, "utf-8");
    expect(source).toContain('/dashboard/settings/pricing');
    expect(source).toContain("Pricing");
  });
});
