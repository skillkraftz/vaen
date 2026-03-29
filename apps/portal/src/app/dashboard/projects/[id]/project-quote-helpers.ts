import { createClient } from "@/lib/supabase/server";
import type { Contract, PackagePricing, Project, Quote, QuoteLine, SelectedModule } from "@/lib/types";
import {
  calculateQuoteTotals,
  resolveDiscountCents,
  validateDiscount,
  type QuoteLineDraft,
} from "@/lib/quote-helpers";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

export function getTemplateIdForQuote(
  project: Pick<Project, "recommendations">,
  draft: Record<string, unknown>,
) {
  const preferences = (draft.preferences as Record<string, unknown> | undefined) ?? {};
  return typeof preferences.template === "string"
    ? preferences.template
    : project.recommendations?.template.id ?? "service-core";
}

export async function loadPricingRows(
  supabase: PortalSupabase,
  ids: string[],
) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [] as PackagePricing[];

  const { data, error } = await supabase
    .from("package_pricing")
    .select("*")
    .in("id", uniqueIds)
    .eq("active", true);

  if (error) throw new Error(error.message);
  return (data ?? []) as PackagePricing[];
}

export function buildQuoteLineDrafts(params: {
  templateId: string;
  selectedModules: SelectedModule[];
  pricing: PackagePricing[];
}) {
  const pricingById = new Map(params.pricing.map((row) => [row.id, row]));
  const templatePricing = pricingById.get(params.templateId);
  if (!templatePricing) {
    throw new Error(`Missing pricing for template "${params.templateId}".`);
  }

  const lines: QuoteLineDraft[] = [
    {
      line_type: "template",
      reference_id: params.templateId,
      label: templatePricing.label,
      description: templatePricing.description,
      setup_price_cents: templatePricing.setup_price_cents,
      recurring_price_cents: templatePricing.recurring_price_cents,
      quantity: 1,
      sort_order: 0,
    },
  ];

  params.selectedModules.forEach((module, index) => {
    const pricing = pricingById.get(module.id);
    lines.push({
      line_type: "module",
      reference_id: module.id,
      label: pricing?.label ?? module.id,
      description: pricing?.description ?? null,
      setup_price_cents: pricing?.setup_price_cents ?? 0,
      recurring_price_cents: pricing?.recurring_price_cents ?? 0,
      quantity: 1,
      sort_order: index + 1,
    });
  });

  return lines;
}

export async function insertQuoteLines(
  supabase: PortalSupabase,
  quoteId: string,
  lines: QuoteLineDraft[],
) {
  if (lines.length === 0) return;
  const { error } = await supabase
    .from("quote_lines")
    .insert(lines.map((line) => ({ ...line, quote_id: quoteId })));
  if (error) throw new Error(error.message);
}

export async function recalculateQuote(
  supabase: PortalSupabase,
  quoteId: string,
  discountInput?: { discountPercent?: number | null; discountCents?: number | null; reason?: string | null },
) {
  const [{ data: quote }, { data: lines }] = await Promise.all([
    supabase.from("quotes").select("*").eq("id", quoteId).single(),
    supabase.from("quote_lines").select("*").eq("quote_id", quoteId).order("sort_order", { ascending: true }),
  ]);

  if (!quote) throw new Error("Quote not found.");

  const quoteRow = quote as Quote;
  const lineRows = (lines ?? []) as QuoteLine[];

  const discountCents = resolveDiscountCents({
    subtotalCents: calculateQuoteTotals({ lines: lineRows, discountCents: 0 }).setupSubtotalCents,
    discountPercent: discountInput?.discountPercent ?? quoteRow.discount_percent,
    discountCents: discountInput?.discountCents ?? quoteRow.discount_cents,
  });

  const validation = validateDiscount(
    discountCents,
    calculateQuoteTotals({ lines: lineRows, discountCents: 0 }).setupSubtotalCents,
    discountInput?.reason ?? quoteRow.discount_reason,
  );
  if (!validation.valid) throw new Error(validation.error);

  const totals = calculateQuoteTotals({ lines: lineRows, discountCents });
  const nextDiscountPercent = discountInput?.discountPercent != null
    ? discountInput.discountPercent
    : discountInput?.discountCents != null
      ? validation.percent ?? null
      : quoteRow.discount_percent;

  const { error } = await supabase
    .from("quotes")
    .update({
      setup_subtotal_cents: totals.setupSubtotalCents,
      recurring_subtotal_cents: totals.recurringSubtotalCents,
      discount_cents: discountCents,
      discount_percent: nextDiscountPercent,
      discount_reason: discountInput?.reason ?? quoteRow.discount_reason,
      setup_total_cents: totals.setupTotalCents,
      recurring_total_cents: totals.recurringTotalCents,
    })
    .eq("id", quoteId);

  if (error) throw new Error(error.message);
}

export async function expirePastDueQuotes(
  supabase: PortalSupabase,
  projectId: string,
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("quotes")
    .update({ status: "expired" })
    .eq("project_id", projectId)
    .in("status", ["draft", "sent"])
    .lt("valid_until", now);

  if (error) throw new Error(error.message);
}

export async function createContractFromQuote(
  supabase: PortalSupabase,
  quote: Quote,
  project: Pick<Project, "id" | "client_id">,
) {
  const { data: existing } = await supabase
    .from("contracts")
    .select("*")
    .eq("quote_id", quote.id)
    .maybeSingle();

  if (existing) return existing as Contract;

  const { data, error } = await supabase
    .from("contracts")
    .insert({
      quote_id: quote.id,
      project_id: project.id,
      client_id: project.client_id,
      billing_type: quote.recurring_total_cents > 0 ? "monthly" : "one_time",
      setup_amount_cents: quote.setup_total_cents,
      recurring_amount_cents: quote.recurring_total_cents,
      metadata: {
        source_quote_status: quote.status,
      },
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create contract.");
  return data as Contract;
}
