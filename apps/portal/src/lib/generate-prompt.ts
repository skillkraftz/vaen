/**
 * Generate a single prompt.txt artifact for AI handoff.
 *
 * The prompt contains everything needed for Codex/OpenClaw to produce
 * a high-quality client-request.json: client context, current draft,
 * template/module guidance, and strict output instructions.
 *
 * Template-aware: the copy guidance section adapts based on the selected
 * template and modules to produce site-type-appropriate improvements.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface PromptInput {
  /** Project metadata */
  project: {
    name: string;
    slug: string;
    businessType: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    notes: string | null;
  };
  /** Current draft client-request.json (the scaffold to improve) */
  draftRequest: Record<string, unknown>;
  /** Intake recommendations */
  recommendations: {
    template: { id: string; name: string; reasoning: string };
    modules: Array<{ id: string; name: string; reasoning: string }>;
  } | null;
  /** Client summary markdown from intake processing */
  clientSummary: string | null;
  /** Missing info items detected during intake */
  missingInfo: Array<{ field: string; severity: string; hint: string }> | null;
}

// ── Template copy guidance ────────────────────────────────────────────

interface TemplateGuidance {
  siteType: string;
  copyGoals: string[];
  serviceGuidance: string;
  contentTips: string[];
}

const TEMPLATE_GUIDANCE: Record<string, TemplateGuidance> = {
  "service-core": {
    siteType: "local service business website",
    copyGoals: [
      "Build immediate trust with homeowners and local customers",
      "Highlight speed, reliability, and professionalism",
      "Make it easy for visitors to request a quote or call",
      "Emphasize local presence and community reputation",
    ],
    serviceGuidance:
      "Each service should have a clear, benefit-oriented description (2-3 sentences). " +
      "Focus on what the customer gets, not technical jargon. " +
      "Use specific language — 'Same-day emergency panel repair' beats 'Electrical services'.",
    contentTips: [
      "Hero headline should be direct and benefit-focused, not clever — visitors decide in 3 seconds",
      "Hero subheadline should name the service area and core value proposition",
      "About section should feel personal and trustworthy — mention years of experience, licenses, or family-owned if applicable",
      "Tagline should be memorable and specific to this business, not generic",
    ],
  },
  "service-area": {
    siteType: "multi-location service area website",
    copyGoals: [
      "Establish coverage across multiple geographic areas",
      "Build local relevance for each service area",
      "Drive leads from each location served",
      "Show consistency of service quality across areas",
    ],
    serviceGuidance:
      "Services should be described with geographic context where relevant. " +
      "If the business serves different areas with different specialties, note that. " +
      "Each service description should work for any location page.",
    contentTips: [
      "Hero should communicate breadth of coverage area",
      "About section should explain why the business serves multiple areas",
      "Include service areas list if the client mentioned specific cities/regions",
    ],
  },
  authority: {
    siteType: "professional authority / expertise website",
    copyGoals: [
      "Establish the principal as a credentialed expert",
      "Build trust through demonstrated knowledge and experience",
      "Position services as premium and specialized",
      "Convey professionalism and attention to detail",
    ],
    serviceGuidance:
      "Services should sound specialized and premium. " +
      "Use language that implies depth of expertise — 'comprehensive assessment' not just 'check'. " +
      "Include outcomes and methodology where possible.",
    contentTips: [
      "Hero should lead with credentials or years of experience",
      "About section should read like a professional bio, not a sales pitch",
      "Emphasize qualifications, certifications, published work, or notable clients",
      "Tone should be confident but approachable — authoritative without being cold",
    ],
  },
};

const DEFAULT_GUIDANCE: TemplateGuidance = TEMPLATE_GUIDANCE["service-core"];

// ── Module context ────────────────────────────────────────────────────

const MODULE_DESCRIPTIONS: Record<string, string> = {
  "maps-embed":
    "Google Maps embed showing the business location. " +
    "Ensure the contact.address fields are complete and accurate.",
  "manual-testimonials":
    "Customer testimonials section. Each testimonial needs a name, text, " +
    "and optional rating (1-5). If the client mentioned reviews or customer feedback, " +
    "include them. If none are provided, leave the array empty — do not fabricate testimonials.",
  "google-reviews-live":
    "Live Google Reviews integration. Ensure the business name is Google-searchable.",
  "booking-lite":
    "Simple booking/scheduling widget. The contact section should emphasize " +
    "appointment scheduling and include business hours if mentioned.",
};

// ── Prompt generation ─────────────────────────────────────────────────

export function generatePrompt(input: PromptInput): string {
  const { project, draftRequest, recommendations, clientSummary, missingInfo } =
    input;

  const templateId = recommendations?.template.id ?? "service-core";
  const guidance = TEMPLATE_GUIDANCE[templateId] ?? DEFAULT_GUIDANCE;
  const modules = recommendations?.modules ?? [];

  const sections: string[] = [];

  // ── 1. Role & instruction ────────────────────────────────────────
  sections.push(`# AI Copywriter — ${guidance.siteType}

You are an expert website copywriter specializing in small business websites.
Your job is to take the draft client-request.json below and return an improved version
with better copy, filled-in gaps, and polished content — ready to drive a generated website.

## Output contract

- Return ONLY a valid JSON object (the improved client-request.json)
- No commentary, no explanation, no markdown fencing — just the JSON
- The output must parse as valid JSON
- Preserve the exact schema structure shown in the draft
- Do not add new top-level keys
- Do not remove required fields (version, business, contact, services)`);

  // ── 2. Client context ────────────────────────────────────────────
  sections.push(`## Client context

**Project:** ${project.name}
**Business type:** ${project.businessType ?? "Not specified"}
**Contact:** ${[project.contactName, project.contactEmail, project.contactPhone].filter(Boolean).join(" | ") || "Not provided"}`);

  if (project.notes) {
    sections.push(`### Client notes / transcript

These are the raw notes, transcripts, or intake details from the client.
Extract useful details — service descriptions, tone preferences, competitive positioning,
target customers, geographic focus, and any specific language the client used.

\`\`\`
${project.notes.trim()}
\`\`\``);
  }

  if (clientSummary) {
    sections.push(`### Intake summary

${clientSummary.trim()}`);
  }

  // ── 3. Missing info hints ────────────────────────────────────────
  if (missingInfo && missingInfo.length > 0) {
    const required = missingInfo.filter((m) => m.severity === "required");
    const recommended = missingInfo.filter((m) => m.severity === "recommended");

    if (required.length > 0 || recommended.length > 0) {
      let missingSection = `### Known gaps

The following fields are missing or weak. Fill them intelligently from context:\n`;

      if (required.length > 0) {
        missingSection += `\n**Required (must fill):**\n`;
        for (const m of required) {
          missingSection += `- ${m.field}: ${m.hint}\n`;
        }
      }
      if (recommended.length > 0) {
        missingSection += `\n**Recommended (fill if possible):**\n`;
        for (const m of recommended) {
          missingSection += `- ${m.field}: ${m.hint}\n`;
        }
      }

      sections.push(missingSection.trimEnd());
    }
  }

  // ── 4. Template & module context ─────────────────────────────────
  sections.push(`## Site type & template

**Template:** ${templateId} — ${guidance.siteType}
**Pages generated:** ${templateId === "service-core" ? "Home, Contact" : templateId === "service-area" ? "Home, Contact, Area pages" : templateId === "authority" ? "Home, About, Services, Contact" : "Home, Contact"}`);

  if (modules.length > 0) {
    let moduleSection = `### Active modules\n`;
    for (const mod of modules) {
      const desc = MODULE_DESCRIPTIONS[mod.id] ?? mod.reasoning;
      moduleSection += `\n- **${mod.name}** (${mod.id}): ${desc}`;
    }
    sections.push(moduleSection);
  }

  // ── 5. Copy & quality guidance ───────────────────────────────────
  let copySection = `## Copy improvement goals

This is a ${guidance.siteType}. The copy should:\n`;

  for (const goal of guidance.copyGoals) {
    copySection += `- ${goal}\n`;
  }

  copySection += `\n### Service descriptions\n\n${guidance.serviceGuidance}\n`;
  copySection += `\n### Content tips\n`;
  for (const tip of guidance.contentTips) {
    copySection += `- ${tip}\n`;
  }

  copySection += `\n### General quality rules

- Write in plain, confident English — no filler, no buzzwords
- Every sentence should earn its place
- Descriptions should be specific to THIS business, not generic templates
- If the client notes mention specific details (years in business, license numbers, specialties), use them
- Do not invent facts the client didn't provide (locations, awards, certifications)
- Keep taglines under 10 words
- Keep hero headlines under 12 words
- Keep hero subheadlines under 25 words
- Service descriptions should be 2-3 sentences each
- About text should be 3-5 sentences`;

  sections.push(copySection);

  // ── 6. JSON schema & preservation rules ──────────────────────────
  sections.push(`## JSON structure rules

- \`version\`: must be "1.0.0" — do not change
- \`business.name\`: preserve exactly as provided (it's the legal/brand name)
- \`business.type\`: preserve or clarify (e.g., "electrician" → "Residential & Commercial Electrician")
- \`business.tagline\`: write a strong, specific tagline if missing or generic
- \`business.description\`: write a 1-2 sentence business description
- \`contact\`: preserve all provided contact details exactly — do not modify phone/email/address
- \`services\`: improve descriptions, ensure each has a \`name\` and \`description\`
- \`branding\`: preserve if provided, leave absent if not — do not guess colors
- \`content.about\`: write or improve the about section (3-5 sentences)
- \`content.heroHeadline\`: write a compelling, specific headline
- \`content.heroSubheadline\`: write a supporting subheadline
- \`content.testimonials\`: preserve provided testimonials exactly — do not fabricate
- \`content.galleryImages\`: preserve if provided — do not fabricate URLs
- \`features\`: preserve as provided
- \`preferences\`: preserve as provided — these are operator settings, not client copy`);

  // ── 7. Current draft ─────────────────────────────────────────────
  sections.push(`## Current draft client-request.json

This is the starting point. Improve the copy, fill gaps, and return the complete improved version.

\`\`\`json
${JSON.stringify(draftRequest, null, 2)}
\`\`\``);

  // ── 8. Final reminder ────────────────────────────────────────────
  sections.push(`## Reminder

Return ONLY the improved JSON. No explanation. No markdown. Just the JSON object.`);

  return sections.join("\n\n") + "\n";
}
