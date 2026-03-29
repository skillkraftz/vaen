import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("pricing and quote schema", () => {
  it("adds package_pricing, quotes, quote_lines, and contracts tables", () => {
    const migrationPath = join(REPO_ROOT, "supabase/migrations/20260329000007_create_pricing_and_quotes.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const source = readFileSync(migrationPath, "utf-8");
    expect(source).toContain("create table if not exists public.package_pricing");
    expect(source).toContain("create table if not exists public.quotes");
    expect(source).toContain("create table if not exists public.quote_lines");
    expect(source).toContain("create table if not exists public.contracts");
    expect(source).toContain("Service Core Website");
    expect(source).toContain("Online Booking");
  });
});

describe("quote actions and UI", () => {
  it("exports quote creation and editing actions", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function createQuoteAction");
    expect(source).toContain("export async function getQuotesForProjectAction");
    expect(source).toContain("export async function updateQuoteLineAction");
    expect(source).toContain("export async function addQuoteLineAction");
    expect(source).toContain("export async function removeQuoteLineAction");
    expect(source).toContain("export async function setQuoteDiscountAction");
    expect(source).toContain("export async function transitionQuoteAction");
    expect(source).toContain('event_type: "quote_created"');
  });

  it("snapshots revision and selected modules when creating a quote", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const createFn = source.slice(
      source.indexOf("export async function createQuoteAction"),
      source.indexOf("export async function updateQuoteLineAction"),
    );
    expect(createFn).toContain("revision_id: revisionId");
    expect(createFn).toContain("selected_modules_snapshot: selectedModules");
    expect(createFn).toContain("template_id: templateId");
    expect(createFn).toContain("buildQuoteLineDrafts");
  });

  it("renders the quote section with stable selectors", () => {
    const sectionPath = join(__dirname, "../app/dashboard/projects/[id]/quote-section.tsx");
    const source = readFileSync(sectionPath, "utf-8");
    expect(source).toContain('data-testid="quote-section"');
    expect(source).toContain('data-testid="btn-create-quote"');
    expect(source).toContain('data-testid={`quote-card-${quote.id}`}');
    expect(source).toContain('data-testid={`quote-status-${quote.status}`}');
    expect(source).toContain('data-testid={`quote-line-${line.id}`}');
    expect(source).toContain('data-testid="quote-total-setup"');
    expect(source).toContain('data-testid="quote-total-recurring"');
    expect(source).toContain('data-testid="quote-discount"');
    expect(source).toContain('data-testid="quote-outdated-warning"');
    expect(source).toContain('data-testid="btn-send-quote"');
    expect(source).toContain('data-testid="btn-accept-quote"');
    expect(source).toContain('data-testid="btn-reject-quote"');
    expect(source).toContain('data-testid="contract-badge"');
  });

  it("places the quote section on the project page", () => {
    const pagePath = join(__dirname, "../app/dashboard/projects/[id]/page.tsx");
    const source = readFileSync(pagePath, "utf-8");
    expect(source).toContain("QuoteSection");
    expect(source).toContain("quotes={quoteList}");
    expect(source).toContain("contracts={contractList}");
    expect(source).toContain("currentModules={selectedModules}");
    expect(source).toContain("currentRevisionId={p.current_revision_id}");
    expect(source).toContain("currentTemplateId={templateId}");
  });

  it("accepting a quote creates a contract and expires competing quotes", () => {
    const actionsPath = join(__dirname, "../app/dashboard/projects/[id]/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    const lifecycleFn = source.slice(
      source.indexOf("export async function transitionQuoteAction"),
      source.indexOf("export async function removeQuoteLineAction"),
    );
    expect(lifecycleFn).toContain('newStatus === "accepted"');
    expect(lifecycleFn).toContain("createContractFromQuote");
    expect(lifecycleFn).toContain('.update({ status: "expired" })');
    expect(lifecycleFn).toContain('event_type: `quote_${newStatus}`');
  });
});
