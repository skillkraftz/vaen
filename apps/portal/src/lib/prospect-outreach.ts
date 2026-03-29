import type {
  Prospect,
  ProspectAutomationLevel,
  ProspectSiteAnalysis,
  ProspectOutreachPackage,
  Project,
  Quote,
  QuoteLine,
} from "./types";
import { formatCurrency } from "./quote-helpers";

export const PROSPECT_AUTOMATION_LEVELS: Array<{
  id: ProspectAutomationLevel;
  label: string;
  description: string;
}> = [
  {
    id: "convert_only",
    label: "Convert Only",
    description: "Create the client and project shell only.",
  },
  {
    id: "process_intake",
    label: "Convert + Process Intake",
    description: "Run intake processing and stop at intake_draft_ready.",
  },
  {
    id: "export_to_generator",
    label: "Convert + Process + Export",
    description: "Advance through intake approval and export the request to the generator.",
  },
  {
    id: "generate_site",
    label: "Convert + Process + Export + Generate",
    description: "Dispatch the generate job after export.",
  },
  {
    id: "review_site",
    label: "Convert + Process + Export + Generate + Review",
    description: "Go as far as possible now, then prepare review as the next automation step after generate completes.",
  },
];

export function getAutomationLevelLabel(level: ProspectAutomationLevel) {
  return PROSPECT_AUTOMATION_LEVELS.find((item) => item.id === level)?.label ?? level;
}

export function inferRecommendedPackage(params: {
  project: Pick<Project, "selected_modules" | "recommendations"> | null;
  latestQuote?: Pick<Quote, "template_id"> | null;
}) {
  if (params.latestQuote?.template_id) return params.latestQuote.template_id;
  return params.project?.recommendations?.template.id ?? "service-core";
}

export function buildOfferSummary(params: {
  prospect: Pick<Prospect, "company_name" | "website_url" | "outreach_summary">;
  analysis: Pick<ProspectSiteAnalysis, "site_title" | "primary_h1" | "content_excerpt"> | null;
  recommendedPackage: string;
  pricingSummary: string | null;
}) {
  const bullets = [
    `What we noticed: ${params.analysis?.site_title ?? params.prospect.website_url}`,
    `What we can improve: ${params.analysis?.primary_h1 ?? params.prospect.outreach_summary ?? "Clarify the homepage value proposition and lead capture."}`,
    `Recommended package: ${params.recommendedPackage}`,
    `Estimated pricing: ${params.pricingSummary ?? "Pricing estimate pending quote creation."}`,
    "Why now: turning the current website into a stronger conversion asset improves outreach and close rates immediately.",
    "Call to action: review the proposed direction, screenshots, and pricing, then approve outreach send prep.",
  ];
  return bullets.join("\n");
}

export function buildOutreachEmailDraft(params: {
  prospect: Pick<Prospect, "company_name" | "website_url">;
  analysis: Pick<ProspectSiteAnalysis, "primary_h1" | "content_excerpt"> | null;
  recommendedPackage: string;
  pricingSummary: string | null;
  screenshotCount: number;
}) {
  const subject = `${params.prospect.company_name}: website improvement ideas`;
  const body = [
    `Hi ${params.prospect.company_name} team,`,
    "",
    `I reviewed ${params.prospect.website_url} and noticed a few clear opportunities to improve the site's sales effectiveness.`,
    params.analysis?.primary_h1
      ? `The current main headline is "${params.analysis.primary_h1}", which suggests an opportunity to sharpen the value proposition and call to action.`
      : "The homepage could do a better job of clarifying the value proposition and next step.",
    params.analysis?.content_excerpt
      ? `The current content also points to this issue: ${params.analysis.content_excerpt}`
      : null,
    "",
    `Our recommended starting point is the ${params.recommendedPackage} package${params.pricingSummary ? `, estimated at ${params.pricingSummary}` : ""}.`,
    params.screenshotCount > 0
      ? `We also have ${params.screenshotCount} review screenshot${params.screenshotCount === 1 ? "" : "s"} ready to reference in the outreach package.`
      : "We can attach a visual review package once the design review step is complete.",
    "",
    "If useful, I can send over a concise breakdown of what we would improve and how quickly we could move.",
    "",
    "Best,",
    "vaen",
  ].filter(Boolean).join("\n");

  return { subject, body };
}

export function summarizeQuote(
  quote: (Quote & { lines?: QuoteLine[] }) | null,
) {
  if (!quote) return null;
  return `${formatCurrency(quote.setup_total_cents)} setup / ${formatCurrency(quote.recurring_total_cents)} mo`;
}

export function buildOutreachPackageRecord(params: {
  prospect: Prospect;
  analysis: ProspectSiteAnalysis | null;
  project: Project | null;
  quote: (Quote & { lines?: QuoteLine[] }) | null;
  screenshotCount: number;
  screenshotPaths: string[];
  latestJobStatus: string | null;
  automationLevel: ProspectAutomationLevel;
}) {
  const recommendedPackage = inferRecommendedPackage({
    project: params.project,
    latestQuote: params.quote,
  });
  const pricingSummary = summarizeQuote(params.quote);
  const offerSummary = buildOfferSummary({
    prospect: params.prospect,
    analysis: params.analysis,
    recommendedPackage,
    pricingSummary,
  });
  const emailDraft = buildOutreachEmailDraft({
    prospect: params.prospect,
    analysis: params.analysis,
    recommendedPackage,
    pricingSummary,
    screenshotCount: params.screenshotCount,
  });

  const packageData = {
    prospect: {
      id: params.prospect.id,
      company_name: params.prospect.company_name,
      website_url: params.prospect.website_url,
      status: params.prospect.status,
    },
    analysis: params.analysis
      ? {
          site_title: params.analysis.site_title,
          primary_h1: params.analysis.primary_h1,
          content_excerpt: params.analysis.content_excerpt,
        }
      : null,
    project: params.project
      ? {
          id: params.project.id,
          status: params.project.status,
          last_reviewed_revision_id: params.project.last_reviewed_revision_id,
        }
      : null,
    quote: params.quote
      ? {
          id: params.quote.id,
          status: params.quote.status,
          summary: pricingSummary,
        }
      : null,
    automation: {
      requested_level: params.automationLevel,
      latest_job_status: params.latestJobStatus,
    },
    screenshots: {
      count: params.screenshotCount,
      paths: params.screenshotPaths,
      available: params.screenshotCount > 0,
    },
    talking_points: offerSummary.split("\n"),
    resend_ready: {
      subject: emailDraft.subject,
      body: emailDraft.body,
      attachment_paths: params.screenshotPaths,
    },
  };

  return {
    status: "ready" as ProspectOutreachPackage["status"],
    packageData,
    offerSummary,
    emailSubject: emailDraft.subject,
    emailBody: emailDraft.body,
  };
}
