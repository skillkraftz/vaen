/**
 * Intake processing: generates draft artifacts from portal project + assets.
 *
 * - client-summary.md — human-readable overview
 * - draft client-request.json — mapped to @vaen/schemas ClientRequest shape
 * - missing-info — fields that are absent or incomplete
 * - recommendations — template + module suggestions
 */

import type { Project, Asset, MissingInfoItem, IntakeRecommendations } from "./types";

// ── Types ────────────────────────────────────────────────────────────

export interface IntakeProcessingResult {
  clientSummary: string;
  draftRequest: Record<string, unknown>;
  missingInfo: MissingInfoItem[];
  recommendations: IntakeRecommendations;
}

// ── Main entry ───────────────────────────────────────────────────────

export function processIntake(project: Project, assets: Asset[]): IntakeProcessingResult {
  const draftRequest = buildDraftRequest(project);
  const missingInfo = detectMissingInfo(project, assets);
  const recommendations = recommendTemplateAndModules(project, assets);
  const clientSummary = generateClientSummary(project, assets, missingInfo, recommendations);

  return { clientSummary, draftRequest, missingInfo, recommendations };
}

// ── D. Client summary generation ─────────────────────────────────────

function generateClientSummary(
  project: Project,
  assets: Asset[],
  missingInfo: MissingInfoItem[],
  recommendations: IntakeRecommendations,
): string {
  const lines: string[] = [];

  lines.push(`# Client Summary: ${project.name}`);
  lines.push("");
  lines.push(`**Slug:** \`${project.slug}\``);
  lines.push(`**Status:** ${project.status.replace(/_/g, " ")}`);
  lines.push(`**Created:** ${new Date(project.created_at).toLocaleDateString("en-US")}`);
  lines.push("");

  // Business info
  lines.push("## Business Information");
  lines.push("");
  if (project.business_type) {
    lines.push(`- **Type:** ${project.business_type}`);
  }
  if (project.contact_name) {
    lines.push(`- **Contact:** ${project.contact_name}`);
  }
  if (project.contact_email) {
    lines.push(`- **Email:** ${project.contact_email}`);
  }
  if (project.contact_phone) {
    lines.push(`- **Phone:** ${project.contact_phone}`);
  }
  lines.push("");

  // Notes / goals
  if (project.notes) {
    lines.push("## Client Notes");
    lines.push("");
    lines.push(project.notes);
    lines.push("");
  }

  // Uploaded assets
  if (assets.length > 0) {
    lines.push("## Uploaded Assets");
    lines.push("");
    const byCategory = groupBy(assets, (a) => a.category);
    for (const [category, items] of Object.entries(byCategory)) {
      lines.push(`### ${capitalize(category)} (${items.length})`);
      for (const asset of items) {
        const size = asset.file_size ? ` (${formatBytes(asset.file_size)})` : "";
        lines.push(`- ${asset.file_name}${size}`);
      }
      lines.push("");
    }
  }

  // Missing info
  const required = missingInfo.filter((m) => m.severity === "required");
  const recommended = missingInfo.filter((m) => m.severity === "recommended");

  if (required.length > 0) {
    lines.push("## Missing Information (Required)");
    lines.push("");
    for (const item of required) {
      lines.push(`- **${item.label}**${item.hint ? ` — ${item.hint}` : ""}`);
    }
    lines.push("");
  }

  if (recommended.length > 0) {
    lines.push("## Missing Information (Recommended)");
    lines.push("");
    for (const item of recommended) {
      lines.push(`- **${item.label}**${item.hint ? ` — ${item.hint}` : ""}`);
    }
    lines.push("");
  }

  // Recommendations
  lines.push("## Recommendations");
  lines.push("");
  lines.push(`- **Template:** ${recommendations.template.id} — ${recommendations.template.reason}`);
  for (const mod of recommendations.modules) {
    lines.push(`- **Module:** ${mod.id} — ${mod.reason}`);
  }
  if (recommendations.notes) {
    lines.push("");
    lines.push(`> ${recommendations.notes}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ── E. Draft client-request.json ─────────────────────────────────────

function buildDraftRequest(project: Project): Record<string, unknown> {
  // Extract services: try notes first, then infer from business type
  let services: Array<{ name: string; description?: string }> = extractServicesFromNotes(project.notes);
  if (services.length === 0) {
    services = inferServicesFromBusinessType(project.business_type);
  }

  // If the existing draft_request already has services (user edited them), preserve those
  const existingServices = (project.draft_request as Record<string, unknown> | null)?.services;
  if (Array.isArray(existingServices) && existingServices.length > 0) {
    services = existingServices as Array<{ name: string; description?: string }>;
  }

  const draft: Record<string, unknown> = {
    version: "1.0.0",
    business: {
      name: project.name,
      type: project.business_type ?? "local business",
      ...(project.business_type ? { description: `${project.name} provides professional ${project.business_type.toLowerCase()} services.` } : {}),
    },
    contact: {
      ...(project.contact_email ? { email: project.contact_email } : {}),
      ...(project.contact_phone ? { phone: project.contact_phone } : {}),
    },
    services,
    features: {
      contactForm: true,
      maps: true,
    },
    preferences: {
      template: "service-core",
      modules: ["maps-embed"],
    },
  };

  // Add content from notes — use it for 'about' but try to make it concise
  if (project.notes) {
    // Truncate very long notes for the about field
    const aboutText = project.notes.length > 500
      ? project.notes.substring(0, 500) + "..."
      : project.notes;
    draft.content = {
      about: aboutText,
    };
  }

  return draft;
}

/**
 * Service extraction from notes/transcript.
 * Tries multiple strategies:
 * 1. Bullet points (- or * items)
 * 2. Comma-separated lists after trigger phrases ("we offer", "services include", etc.)
 * 3. Numbered lists (1. 2. 3.)
 */
function extractServicesFromNotes(notes: string | null): Array<{ name: string; description?: string }> {
  if (!notes) return [];

  const services: Array<{ name: string; description?: string }> = [];
  const seen = new Set<string>();

  function add(name: string, desc?: string) {
    const key = name.toLowerCase().trim();
    if (key.length < 3 || key.length > 80 || key.includes("?") || seen.has(key)) return;
    seen.add(key);
    services.push({ name: name.trim(), ...(desc ? { description: desc.trim() } : {}) });
  }

  const lines = notes.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Strategy 1: bullet points
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      add(bullet[1]);
      continue;
    }
    // Strategy 3: numbered lists
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      add(numbered[1]);
      continue;
    }
  }

  // Strategy 2: comma-separated lists after trigger phrases
  const triggers = [
    /(?:we offer|services include|we provide|we do|we specialize in|specializ(?:e|ing) in|our services|interested in|highlighting|wants to highlight|wants to offer|looking to offer|focus on|focusing on)[:\s]+(.+)/gi,
    /(?:services?)[:\s,]+(.+)/gi,
  ];
  for (const re of triggers) {
    let match;
    while ((match = re.exec(notes)) !== null) {
      const list = match[1];
      // Split on commas, "and", semicolons
      const parts = list.split(/[,;]\s*|\s+and\s+/i);
      for (const part of parts) {
        const clean = part.replace(/[.!]$/, "").trim();
        if (clean.length > 2 && clean.length < 60) {
          add(clean);
        }
      }
    }
  }

  return services;
}

/**
 * Infer likely services from business type when notes don't yield any.
 */
function inferServicesFromBusinessType(businessType: string | null): Array<{ name: string }> {
  if (!businessType) return [];
  const type = businessType.toLowerCase();

  const serviceMap: Record<string, string[]> = {
    "electric": ["Electrical Repairs", "Panel Upgrades", "Lighting Installation", "Wiring", "Electrical Inspections"],
    "plumb": ["Drain Cleaning", "Pipe Repair", "Water Heater Installation", "Fixture Installation", "Emergency Plumbing"],
    "paint": ["Interior Painting", "Exterior Painting", "Cabinet Painting", "Deck Staining", "Color Consultation"],
    "landscap": ["Lawn Maintenance", "Garden Design", "Tree Trimming", "Hardscaping", "Irrigation"],
    "roof": ["Roof Repair", "Roof Replacement", "Roof Inspection", "Gutter Installation", "Emergency Repairs"],
    "hvac": ["AC Repair", "Furnace Installation", "Duct Cleaning", "HVAC Maintenance", "Heat Pump Service"],
    "clean": ["Residential Cleaning", "Commercial Cleaning", "Deep Cleaning", "Move-In/Move-Out Cleaning"],
  };

  for (const [key, services] of Object.entries(serviceMap)) {
    if (type.includes(key)) {
      return services.map((name) => ({ name }));
    }
  }
  return [];
}

// ── F. Missing info detection ────────────────────────────────────────

function detectMissingInfo(project: Project, assets: Asset[]): MissingInfoItem[] {
  const items: MissingInfoItem[] = [];

  // Required fields
  if (!project.business_type) {
    items.push({
      field: "business_type",
      label: "Business Type",
      severity: "required",
      hint: "Needed for template selection and content generation",
    });
  }

  if (!project.contact_email && !project.contact_phone) {
    items.push({
      field: "contact",
      label: "Contact Information",
      severity: "required",
      hint: "At least an email or phone number is needed for the website",
    });
  }

  // Check for services: from notes extraction, business-type inference, or existing draft
  const extractedServices = extractServicesFromNotes(project.notes);
  const inferredServices = inferServicesFromBusinessType(project.business_type);
  const existingDraftServices = Array.isArray((project.draft_request as Record<string, unknown> | null)?.services)
    ? (project.draft_request as Record<string, unknown>).services as unknown[]
    : [];

  if (extractedServices.length === 0 && inferredServices.length === 0 && existingDraftServices.length === 0) {
    items.push({
      field: "services",
      label: "Services List",
      severity: "required",
      hint: "No services detected. Add services via the Services editor or include a bulleted list in notes.",
    });
  } else if (extractedServices.length === 0 && existingDraftServices.length === 0 && inferredServices.length > 0) {
    items.push({
      field: "services",
      label: "Services List",
      severity: "recommended",
      hint: `Services were inferred from business type. Review and edit them to be accurate.`,
    });
  }

  // Recommended fields
  if (!project.contact_name) {
    items.push({
      field: "contact_name",
      label: "Contact Name",
      severity: "recommended",
      hint: "Adds a personal touch to the website",
    });
  }

  if (!project.notes || project.notes.length < 50) {
    items.push({
      field: "notes",
      label: "Detailed Notes or Transcript",
      severity: "recommended",
      hint: "More detail helps generate better content — consider adding a call transcript or description",
    });
  }

  // Check for images
  const images = assets.filter((a) => a.category === "image");
  if (images.length === 0) {
    items.push({
      field: "images",
      label: "Business Images",
      severity: "recommended",
      hint: "Photos of work, team, or location improve the site significantly",
    });
  }

  // Optional niceties
  if (!project.contact_email) {
    items.push({
      field: "contact_email",
      label: "Email Address",
      severity: "optional",
      hint: "Enables contact form functionality",
    });
  }

  if (!project.contact_phone) {
    items.push({
      field: "contact_phone",
      label: "Phone Number",
      severity: "optional",
      hint: "Click-to-call is popular for local business sites",
    });
  }

  // Check for audio (transcripts)
  const audio = assets.filter((a) => a.category === "audio");
  if (audio.length === 0) {
    items.push({
      field: "audio",
      label: "Audio Recording / Transcript",
      severity: "optional",
      hint: "A client call recording helps generate authentic copy",
    });
  }

  return items;
}

// ── G. Template + module recommendations ─────────────────────────────

function recommendTemplateAndModules(
  project: Project,
  assets: Asset[],
): IntakeRecommendations {
  // Template selection (rule-based)
  const template = selectTemplate(project);

  // Module selection
  const modules: Array<{ id: string; reason: string }> = [];

  // maps-embed — always for local businesses
  modules.push({
    id: "maps-embed",
    reason: "Local business sites benefit from an embedded map showing their location",
  });

  // manual-testimonials — if we have testimonials in notes or enough content
  const notesLower = (project.notes ?? "").toLowerCase();
  if (
    notesLower.includes("testimonial") ||
    notesLower.includes("review") ||
    notesLower.includes("client said") ||
    notesLower.includes("customer said")
  ) {
    modules.push({
      id: "manual-testimonials",
      reason: "Client notes mention testimonials or reviews",
    });
  }

  // booking-lite — if scheduling/booking mentioned
  if (
    notesLower.includes("booking") ||
    notesLower.includes("appointment") ||
    notesLower.includes("schedule") ||
    notesLower.includes("calendar")
  ) {
    modules.push({
      id: "booking-lite",
      reason: "Client notes mention booking or scheduling needs",
    });
  }

  // google-reviews-live — if google reviews mentioned
  if (notesLower.includes("google review") || notesLower.includes("google rating")) {
    modules.push({
      id: "google-reviews-live",
      reason: "Client wants to showcase Google Reviews",
    });
  }

  const notes = buildRecommendationNotes(project, assets);

  return { template, modules, ...(notes ? { notes } : {}) };
}

function selectTemplate(project: Project): { id: string; reason: string } {
  const type = (project.business_type ?? "").toLowerCase();
  const notes = (project.notes ?? "").toLowerCase();

  // service-area for multi-location businesses
  if (
    notes.includes("multiple location") ||
    notes.includes("multi-location") ||
    notes.includes("service area") ||
    notes.includes("we cover") ||
    notes.includes("cities") ||
    notes.includes("regions")
  ) {
    return {
      id: "service-area",
      reason: "Multi-location or wide service area detected in notes",
    };
  }

  // authority for professional services
  const authorityTypes = ["lawyer", "attorney", "consultant", "accountant", "financial", "advisor", "doctor", "dentist", "therapist"];
  if (authorityTypes.some((t) => type.includes(t) || notes.includes(t))) {
    return {
      id: "authority",
      reason: `Professional service type "${project.business_type}" benefits from authority-style layout`,
    };
  }

  // Default: service-core for local trade/service businesses
  return {
    id: "service-core",
    reason: "Standard local service business — service-core template is the best fit",
  };
}

function buildRecommendationNotes(project: Project, assets: Asset[]): string | undefined {
  const notes: string[] = [];

  const images = assets.filter((a) => a.category === "image");
  if (images.length >= 5) {
    notes.push("Multiple images available — consider enabling a gallery section.");
  }

  const audio = assets.filter((a) => a.category === "audio");
  if (audio.length > 0) {
    notes.push("Audio files uploaded — these can be transcribed for content generation.");
  }

  if (!project.contact_email && !project.contact_phone) {
    notes.push("No contact info provided — website will need at least one contact method before deployment.");
  }

  return notes.length > 0 ? notes.join(" ") : undefined;
}

// ── Utilities ────────────────────────────────────────────────────────

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    (result[k] ??= []).push(item);
  }
  return result;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
