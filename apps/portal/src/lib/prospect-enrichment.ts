import type {
  Prospect,
  ProspectEnrichment,
  ProspectSiteAnalysis,
  Project,
  Quote,
  QuoteLine,
} from "./types";
import { inferRecommendedPackage, summarizeQuote } from "./prospect-outreach";

export type ProspectEnrichmentSource = ProspectEnrichment["source"];
export type ProspectEnrichmentStatus = ProspectEnrichment["status"];

interface ProspectEnrichmentBuildContext {
  prospect: Prospect;
  analysis: ProspectSiteAnalysis | null;
  project: Project | null;
  quote: (Quote & { lines?: QuoteLine[] }) | null;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))];
}

export function inferMissingPieces(params: {
  prospect: Pick<Prospect, "contact_name" | "contact_email" | "contact_phone">;
  analysis: Pick<ProspectSiteAnalysis, "meta_description" | "primary_h1" | "structured_output"> | null;
}) {
  const structuredOutput = (params.analysis?.structured_output ?? {}) as Record<string, unknown>;
  const siteEmails = Array.isArray(structuredOutput.emails)
    ? structuredOutput.emails.filter((item): item is string => typeof item === "string")
    : [];
  const sitePhones = Array.isArray(structuredOutput.phones)
    ? structuredOutput.phones.filter((item): item is string => typeof item === "string")
    : [];

  return unique([
    !params.prospect.contact_name ? "Decision-maker or primary contact name is missing." : null,
    !params.prospect.contact_email && siteEmails.length === 0 ? "No clear email capture path is visible yet." : null,
    !params.prospect.contact_phone && sitePhones.length === 0 ? "No obvious phone-first conversion path is visible yet." : null,
    !params.analysis?.primary_h1 ? "Homepage headline/value proposition needs clarification." : null,
    !params.analysis?.meta_description ? "Search-facing meta description is missing or weak." : null,
  ]);
}

export function buildHeuristicProspectEnrichmentRecord(
  params: ProspectEnrichmentBuildContext,
): Omit<ProspectEnrichment, "id" | "created_at" | "updated_at"> {
  const recommendedPackage = inferRecommendedPackage({
    project: params.project,
    latestQuote: params.quote,
  });
  const pricingSummary = summarizeQuote(params.quote);
  const missingPieces = inferMissingPieces({
    prospect: params.prospect,
    analysis: params.analysis,
  });

  const businessSummary = [
    `${params.prospect.company_name} appears to be a local-service business operating from ${params.prospect.website_url}.`,
    params.analysis?.site_title ? `Current site title: ${params.analysis.site_title}.` : null,
    params.analysis?.primary_h1 ? `Primary headline: ${params.analysis.primary_h1}.` : null,
    params.analysis?.content_excerpt ? `Content signal: ${params.analysis.content_excerpt}` : null,
  ].filter(Boolean).join(" ");

  const opportunitySummary = [
    params.analysis?.primary_h1
      ? `The current headline suggests room to sharpen the offer and next step.`
      : `The homepage needs a clearer value proposition and conversion path.`,
    missingPieces.length > 0
      ? `Missing sales inputs: ${missingPieces.join(" ")}`
      : `Core contact and messaging inputs are present, so the next leverage point is positioning and proof.`,
  ].join(" ");

  const offerPositioning = [
    `Recommended starting package: ${recommendedPackage}.`,
    pricingSummary ? `Current estimate: ${pricingSummary}.` : "Pricing should be confirmed through a live quote.",
    `Lead with a concise before/after story: stronger headline, clearer CTA, and tighter trust/proof structure.`,
  ].join(" ");

  const precreatedCopy = {
    what_we_noticed: params.analysis?.primary_h1
      ? `The current homepage headline is "${params.analysis.primary_h1}", which leaves room to make the value proposition and next action more concrete.`
      : "The current homepage does not yet present a strong, immediate value proposition.",
    what_we_can_improve: missingPieces.length > 0
      ? missingPieces
      : ["Clarify offer positioning, trust signals, and contact conversion flow."],
    recommended_package: recommendedPackage,
    estimated_pricing: pricingSummary,
    call_to_action: "Review the proposed package direction and approve a concise outreach package tailored to this business.",
  };

  return {
    prospect_id: params.prospect.id,
    source: "heuristic_v1",
    status: "completed",
    source_job_id: null,
    business_summary: businessSummary || null,
    recommended_package: recommendedPackage,
    opportunity_summary: opportunitySummary || null,
    missing_pieces: missingPieces,
    offer_positioning: offerPositioning || null,
    precreated_copy: precreatedCopy,
    error_message: null,
    metadata: {
      analysis_id: params.analysis?.id ?? null,
      quote_id: params.quote?.id ?? null,
      project_id: params.project?.id ?? null,
      pricing_summary: pricingSummary,
      generation_status: "completed",
      generator_version: "heuristic_v1",
      requested_source: "heuristic_v1",
    },
  };
}

export function buildPendingProspectEnrichmentRecord(params: {
  prospectId: string;
  source: Extract<ProspectEnrichmentSource, "worker_job" | "manual">;
  analysisId?: string | null;
  projectId?: string | null;
  quoteId?: string | null;
  sourceJobId?: string | null;
  note?: string | null;
}): Omit<ProspectEnrichment, "id" | "created_at" | "updated_at"> {
  return {
    prospect_id: params.prospectId,
    source: params.source,
    status: "pending",
    source_job_id: params.sourceJobId ?? null,
    business_summary: null,
    recommended_package: null,
    opportunity_summary: null,
    missing_pieces: [],
    offer_positioning: null,
    precreated_copy: {},
    error_message: null,
    metadata: {
      analysis_id: params.analysisId ?? null,
      quote_id: params.quoteId ?? null,
      project_id: params.projectId ?? null,
      generation_status: "pending",
      requested_source: params.source,
      note: params.note ?? null,
    },
  };
}

export function buildProspectEnrichmentRecord(
  params: ProspectEnrichmentBuildContext,
): Omit<ProspectEnrichment, "id" | "created_at" | "updated_at"> {
  return buildHeuristicProspectEnrichmentRecord(params);
}

export function selectPreferredProspectEnrichment(
  enrichments: ProspectEnrichment[],
): ProspectEnrichment | null {
  if (enrichments.length === 0) return null;
  return enrichments.find((enrichment) => enrichment.status === "completed") ?? enrichments[0] ?? null;
}
