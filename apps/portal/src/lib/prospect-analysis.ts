export interface ProspectAnalysisResult {
  ok: boolean;
  normalizedUrl: string;
  siteTitle: string | null;
  metaDescription: string | null;
  primaryH1: string | null;
  contentExcerpt: string | null;
  rawHtmlExcerpt: string | null;
  structuredOutput: Record<string, unknown>;
  outreachSummary: string | null;
  errorMessage?: string;
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

export function normalizeWebsiteUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function extractProspectWebsiteSignals(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescriptionMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const title = titleMatch ? stripTags(titleMatch[1]) : null;
  const metaDescription = metaDescriptionMatch ? decodeEntities(metaDescriptionMatch[1].trim()) : null;
  const primaryH1 = h1Match ? stripTags(h1Match[1]) : null;
  const bodyText = bodyMatch ? stripTags(bodyMatch[1]) : stripTags(html);
  const contentExcerpt = bodyText ? bodyText.slice(0, 320) : null;
  const emails = [...new Set(Array.from(html.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)).map((match) => match[0]))];
  const phones = [...new Set(Array.from(html.matchAll(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}/g)).map((match) => match[0]))];

  return {
    title,
    metaDescription,
    primaryH1,
    contentExcerpt,
    rawHtmlExcerpt: html.slice(0, 3000),
    structuredOutput: {
      title,
      metaDescription,
      primaryH1,
      emails,
      phones,
      contentExcerpt,
    },
  };
}

export async function analyzeProspectWebsite(url: string): Promise<ProspectAnalysisResult> {
  const normalizedUrl = normalizeWebsiteUrl(url);
  if (!normalizedUrl) {
    return {
      ok: false,
      normalizedUrl,
      siteTitle: null,
      metaDescription: null,
      primaryH1: null,
      contentExcerpt: null,
      rawHtmlExcerpt: null,
      structuredOutput: {},
      outreachSummary: null,
      errorMessage: "Website URL is required.",
    };
  }

  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        "user-agent": "vaen-prospect-analyzer/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return {
        ok: false,
        normalizedUrl,
        siteTitle: null,
        metaDescription: null,
        primaryH1: null,
        contentExcerpt: null,
        rawHtmlExcerpt: null,
        structuredOutput: {},
        outreachSummary: null,
        errorMessage: `Website returned ${response.status}.`,
      };
    }

    const html = await response.text();
    const extracted = extractProspectWebsiteSignals(html);
    const outreachSummary = [
      extracted.title ? `Current site title: ${extracted.title}` : null,
      extracted.primaryH1 ? `Primary headline: ${extracted.primaryH1}` : null,
      extracted.metaDescription ? `Meta description: ${extracted.metaDescription}` : null,
    ].filter(Boolean).join(" ");

    return {
      ok: true,
      normalizedUrl,
      siteTitle: extracted.title,
      metaDescription: extracted.metaDescription,
      primaryH1: extracted.primaryH1,
      contentExcerpt: extracted.contentExcerpt,
      rawHtmlExcerpt: extracted.rawHtmlExcerpt,
      structuredOutput: extracted.structuredOutput,
      outreachSummary: outreachSummary || null,
    };
  } catch (error) {
    return {
      ok: false,
      normalizedUrl,
      siteTitle: null,
      metaDescription: null,
      primaryH1: null,
      contentExcerpt: null,
      rawHtmlExcerpt: null,
      structuredOutput: {},
      outreachSummary: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
