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
  const draft: Record<string, unknown> = {
    version: "1.0.0",
    business: {
      name: project.name,
      type: project.business_type ?? "local business",
    },
    contact: {
      ...(project.contact_email ? { email: project.contact_email } : {}),
      ...(project.contact_phone ? { phone: project.contact_phone } : {}),
    },
    services: [], // Needs manual population from notes/transcript
    features: {
      contactForm: true, // Always include contact form
      maps: true, // Default on for local businesses
    },
    preferences: {
      template: "service-core",
      modules: ["maps-embed"],
    },
  };

  // Try to extract services from notes
  const services = extractServicesFromNotes(project.notes);
  if (services.length > 0) {
    draft.services = services;
  }

  // Add content if we have notes
  if (project.notes) {
    draft.content = {
      about: project.notes,
    };
  }

  return draft;
}

/**
 * Basic service extraction from notes.
 * Looks for lines starting with - or * that could be services.
 */
function extractServicesFromNotes(notes: string | null): Array<{ name: string }> {
  if (!notes) return [];

  const services: Array<{ name: string }> = [];
  const lines = notes.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Match bullet points that look like services
    const match = trimmed.match(/^[-*•]\s+(.+)$/);
    if (match) {
      const name = match[1].trim();
      // Skip lines that are clearly not services (too long, questions, etc.)
      if (name.length > 3 && name.length < 80 && !name.includes("?")) {
        services.push({ name });
      }
    }
  }

  return services;
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

  // Check for services in notes
  const services = extractServicesFromNotes(project.notes);
  if (services.length === 0) {
    items.push({
      field: "services",
      label: "Services List",
      severity: "required",
      hint: "No services detected in notes. Add a bulleted list of services offered.",
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
