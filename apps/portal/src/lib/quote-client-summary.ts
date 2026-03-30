import type { Quote, QuoteLine } from "@/lib/types";
import { formatCurrency } from "@/lib/quote-helpers";

function buildLineSummary(lines: QuoteLine[]) {
  const names = lines
    .filter((line) => line.line_type !== "discount")
    .map((line) => line.label.trim())
    .filter((label) => label.length > 0);

  if (names.length === 0) return "website scope";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more`;
}

export function buildClientSendableQuoteSummary(quote: Quote, lines: QuoteLine[]) {
  const setupTotal = formatCurrency(quote.setup_total_cents);
  const recurringTotal = formatCurrency(quote.recurring_total_cents);
  const scopeSummary = buildLineSummary(lines);

  const subject = `Quote #${quote.quote_number} for ${quote.client_name ?? "your website project"}`;
  const body = [
    `Hi ${quote.client_name ?? "there"},`,
    "",
    `Attached is Quote #${quote.quote_number} for ${scopeSummary}.`,
    `Setup: ${setupTotal}`,
    `Monthly: ${recurringTotal} / mo`,
    quote.valid_until
      ? `Valid until: ${new Date(quote.valid_until).toLocaleDateString("en-US")}`
      : null,
    quote.notes?.trim() ? `Notes: ${quote.notes.trim()}` : null,
    "",
    "Reply with any questions or approval notes and we can move into contract and launch planning.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const summary = `${scopeSummary} · ${setupTotal} setup · ${recurringTotal} / mo`;

  return {
    subject,
    body,
    summary,
  };
}
