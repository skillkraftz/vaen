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
  selectedModules?: Array<{ id: string }> | null;
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
  heroExamples: { good: string[]; bad: string[] };
}

const TEMPLATE_GUIDANCE: Record<string, TemplateGuidance> = {
  "service-core": {
    siteType: "local service business website",
    copyGoals: [
      "Build immediate trust with homeowners and local customers",
      "Highlight speed, reliability, and professionalism",
      "Make it easy for visitors to request a quote or call",
      "Emphasize local presence and community reputation",
      "Write for conversion — every section should reduce hesitation and move toward contact",
    ],
    serviceGuidance:
      "Each service should have a clear, benefit-oriented description (2-3 sentences). " +
      "Focus on what the customer gets, not technical jargon. " +
      "Use specific language — 'Same-day emergency panel repair' beats 'Electrical services'. " +
      "IMPORTANT: Do NOT drop or omit services that appear in the draft or client notes. " +
      "If the client mentioned a service (even briefly), it must appear in the output. " +
      "Add a strong description even for services that only have a name.",
    contentTips: [
      "Hero headline must be specific to THIS business — never use 'Trusted [profession] in [city]' or similar generic patterns",
      "Hero headline should state a concrete benefit or differentiator — what makes this business the obvious choice?",
      "Hero subheadline should reinforce the value proposition and name the service area",
      "About section should feel personal and trustworthy — mention years of experience, licenses, or family-owned if applicable",
      "Tagline should be memorable and specific to this business, not a generic industry tagline",
      "Every section should build toward the CTA — explain why to choose this business, not just what it does",
    ],
    heroExamples: {
      good: [
        "Rochester's 24/7 Electrician — Licensed, Insured, There When You Need Us",
        "Your Whole-Home Electrical Team — Panels, Wiring, EV Chargers & More",
        "Fast, Clean Plumbing Repairs — We Show Up on Time, Every Time",
      ],
      bad: [
        "Trusted Electrician in Rochester (generic pattern)",
        "Your Local Plumbing Experts (says nothing specific)",
        "Quality Service You Can Count On (could be any business)",
        "Welcome to [Business Name] (wastes the most important line on the page)",
      ],
    },
  },
  "service-area": {
    siteType: "multi-location service area website",
    copyGoals: [
      "Establish coverage across multiple geographic areas",
      "Build local relevance for each service area",
      "Drive leads from each location served",
      "Show consistency of service quality across areas",
      "Write for conversion — visitors from any area should feel the business is local to them",
    ],
    serviceGuidance:
      "Services should be described with geographic context where relevant. " +
      "If the business serves different areas with different specialties, note that. " +
      "Each service description should work for any location page. " +
      "IMPORTANT: Do NOT drop services from the draft — preserve and improve all of them.",
    contentTips: [
      "Hero should communicate breadth of coverage area while still feeling local",
      "About section should explain why the business serves multiple areas — growth, demand, expertise",
      "Include service areas list if the client mentioned specific cities/regions",
      "Hero headline must NOT be generic — avoid 'Serving the Greater [Area]' patterns",
    ],
    heroExamples: {
      good: [
        "Expert HVAC Service Across the Triangle — Raleigh, Durham, Chapel Hill",
        "Denver Metro's Go-To Roofers — From Downtown to the Foothills",
      ],
      bad: [
        "Serving the Greater Denver Area (generic, no differentiator)",
        "Your Trusted Regional Provider (meaningless)",
      ],
    },
  },
  authority: {
    siteType: "professional authority / expertise website",
    copyGoals: [
      "Establish the principal as a credentialed expert",
      "Build trust through demonstrated knowledge and experience",
      "Position services as premium and specialized",
      "Convey professionalism and attention to detail",
      "Write for conversion — prospects should feel confident booking after reading",
    ],
    serviceGuidance:
      "Services should sound specialized and premium. " +
      "Use language that implies depth of expertise — 'comprehensive assessment' not just 'check'. " +
      "Include outcomes and methodology where possible. " +
      "IMPORTANT: Do NOT drop services from the draft — preserve and improve all of them.",
    contentTips: [
      "Hero should lead with credentials or years of experience — establish authority immediately",
      "About section should read like a professional bio, not a sales pitch",
      "Emphasize qualifications, certifications, published work, or notable clients",
      "Tone should be confident but approachable — authoritative without being cold",
      "Hero headline must NOT be generic — avoid 'Expert [profession] Services' patterns",
    ],
    heroExamples: {
      good: [
        "Board-Certified Structural Engineer — 20 Years Protecting Your Investment",
        "Published Tax Strategist — Saving Businesses an Average of 23% Annually",
      ],
      bad: [
        "Expert Consulting Services (generic, no authority)",
        "Professional Solutions for Your Needs (meaningless)",
      ],
    },
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
  const { project, draftRequest, recommendations, selectedModules, clientSummary, missingInfo } =
    input;

  const templateId = recommendations?.template.id ?? "service-core";
  const guidance = TEMPLATE_GUIDANCE[templateId] ?? DEFAULT_GUIDANCE;
  const selectedModuleIds = selectedModules?.map((module) => module.id) ?? [];
  const recommendedModules = recommendations?.modules ?? [];
  const modules = selectedModuleIds.length > 0
    ? selectedModuleIds.map((id) => {
      const rec = recommendedModules.find((module) => module.id === id);
      return {
        id,
        name: rec?.name ?? id,
        reasoning: rec?.reasoning ?? rec?.name ?? "Operator-selected module",
      };
    })
    : recommendedModules;

  const sections: string[] = [];

  // ── 1. Role & instruction ────────────────────────────────────────
  sections.push(`# AI Copywriter — ${guidance.siteType}

You are an expert website copywriter specializing in small business websites.
You write copy that converts visitors into customers — not generic filler.
Your job is to take the draft client-request.json below and return an improved version
with stronger, more specific copy, filled-in gaps, and polished content — ready to drive a generated website.

## Output contract

- Return ONLY a valid JSON object (the improved client-request.json)
- No commentary, no explanation, no markdown fencing — just the JSON
- The output must parse as valid JSON
- Preserve the exact schema structure shown in the draft
- Do not add new top-level keys
- Do not remove required fields (version, business, contact, services)
- CRITICAL: Do not remove or drop any services from the draft — improve them all
- Prefer writing output to a file (client-request.json) if your environment supports it`);

  // ── 2. Client context ────────────────────────────────────────────
  sections.push(`## Client context

**Project:** ${project.name}
**Business type:** ${project.businessType ?? "Not specified"}
**Contact:** ${[project.contactName, project.contactEmail, project.contactPhone].filter(Boolean).join(" | ") || "Not provided"}`);

  if (project.notes) {
    sections.push(`### Client notes / transcript

These are the raw notes, transcripts, or intake details from the client.
This is your PRIMARY source of truth. Extract and preserve:
- Every service or capability mentioned (even briefly or implicitly)
- Tone preferences and competitive positioning
- Target customers and geographic focus
- Specific language, numbers, or claims the client made
- Priorities the client emphasized (these should be reflected in service ordering and hero copy)

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

  // ── 5b. Hero quality rules (new) ─────────────────────────────────
  copySection += `\n### Hero & headline quality rules

The hero headline is the MOST IMPORTANT line of copy on the entire site.
Visitors decide whether to stay or leave in under 3 seconds.

**Requirements:**
- The headline must be specific to THIS business — mention what they do, who they serve, or what makes them different
- The headline should drive action — it should make the visitor want to scroll down or call
- The subheadline should reinforce the headline with a supporting benefit or trust signal
- Together, headline + subheadline should answer: "Why should I choose this business over the others?"

**BANNED patterns (do NOT use these):**
- "Trusted [profession] in [city]" — overused, says nothing specific
- "Your Local [profession] Experts" — generic, not a differentiator
- "Quality [service] You Can Count On" — empty promise, could be any business
- "Welcome to [Business Name]" — wastes the most important line on the page
- "Professional [service] Services" — redundant and generic
- "[City]'s Premier [profession]" — unsubstantiated superlative
- Any headline that could apply to a different business in the same industry by changing the name\n`;

  if (guidance.heroExamples) {
    copySection += `\n**Good headline examples** (for reference, do NOT copy verbatim):\n`;
    for (const ex of guidance.heroExamples.good) {
      copySection += `- ${ex}\n`;
    }
    copySection += `\n**Bad headline examples** (these are what we're avoiding):\n`;
    for (const ex of guidance.heroExamples.bad) {
      copySection += `- ${ex}\n`;
    }
  }

  // ── 5c. Service completeness rules (new) ─────────────────────────
  copySection += `\n### Service completeness rules

**CRITICAL: Do NOT drop services.**
- Every service in the draft MUST appear in your output
- If the client notes mention services not in the draft, ADD them
- If a service only has a name and no description, write a strong 2-3 sentence description
- Order services by business priority — lead with what the client emphasized most
- If the client mentioned a service is their specialty or main focus, reflect that in the description

**Service description quality:**
- Each description should answer: "What does the customer get, and why is this business good at it?"
- Use concrete language — mention timelines, guarantees, or specific capabilities when available
- Avoid generic descriptions like "We offer professional X services" — be specific about what sets this business apart\n`;

  // ── 5d. Anti-generic rules (new) ─────────────────────────────────
  copySection += `\n### Anti-generic copy rules

The #1 quality problem in generated websites is generic, templated copy.
Every line you write should pass this test: "Could I swap in a different business name and this copy still works?"
If yes, the copy is too generic — rewrite it.

**Rules:**
- Reference the specific business, services, or location in hero, tagline, and about sections
- Use details from the client notes — years in business, specific capabilities, service area, team size
- Write from the business's perspective, not a template's perspective
- The about section should sound like it was written BY someone who knows this business
- Avoid filler phrases: "dedicated to excellence", "committed to quality", "state-of-the-art", "second to none"
- If you don't have a specific detail, write around it naturally — don't insert a generic placeholder\n`;

  // ── 5e. General quality rules ─────────────────────────────────────
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
- \`services\`: improve descriptions, ensure each has a \`name\` and \`description\`. Do NOT remove any services.
- \`branding\`: preserve if provided, leave absent if not — do not guess colors
- \`content.about\`: write or improve the about section (3-5 sentences)
- \`content.heroHeadline\`: write a compelling, specific headline (see hero quality rules above)
- \`content.heroSubheadline\`: write a supporting subheadline that reinforces the value proposition
- \`content.testimonials\`: preserve provided testimonials exactly — do not fabricate
- \`content.galleryImages\`: preserve if provided — do not fabricate URLs
- \`features\`: preserve as provided
- \`preferences\`: preserve as provided — these are operator settings, not client copy`);

  // ── 7. Current draft ─────────────────────────────────────────────
  sections.push(`## Current draft client-request.json

This is the starting point. Improve the copy, fill gaps, and return the complete improved version.
Remember: preserve ALL services, improve ALL descriptions, and write conversion-focused copy.

\`\`\`json
${JSON.stringify(draftRequest, null, 2)}
\`\`\``);

  // ── 8. Final reminder ────────────────────────────────────────────
  sections.push(`## Reminder

Return ONLY the improved JSON. No explanation. No markdown. Just the JSON object.
Prefer writing to a file named client-request.json if your tool supports it.

Checklist before returning:
- [ ] All services from the draft are present (none dropped)
- [ ] Hero headline is specific to this business (not generic)
- [ ] Hero subheadline reinforces the value proposition
- [ ] Tagline is memorable and specific
- [ ] About section sounds like it was written for this specific business
- [ ] Service descriptions are benefit-oriented and concrete
- [ ] No banned headline patterns used
- [ ] All contact details preserved exactly
- [ ] version is "1.0.0"
- [ ] Output is valid JSON`);

  return sections.join("\n\n") + "\n";
}
