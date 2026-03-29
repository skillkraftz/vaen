import { normalizeWebsiteUrl } from "./prospect-analysis";
import type { Campaign, Prospect, ProspectOutreachPackage } from "./types";

export const CAMPAIGN_STATUSES: Campaign["status"][] = [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
];

export interface ProspectImportRowDraft {
  rowNumber: number;
  company_name: string;
  website_url: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  source: string | null;
  campaign: string | null;
}

export interface ProspectImportPreviewRow extends ProspectImportRowDraft {
  valid: boolean;
  normalized_website_url: string | null;
  duplicate_key: string | null;
  duplicate_reason: string | null;
  errors: string[];
}

function parseDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function nullableValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseProspectImportText(rawText: string): ProspectImportRowDraft[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  const headers = parseDelimitedLine(firstLine, delimiter).map(normalizeHeader);

  return lines.slice(1).map((line, index) => {
    const cells = parseDelimitedLine(line, delimiter);
    const valueFor = (field: string) => cells[headers.indexOf(field)];

    return {
      rowNumber: index + 2,
      company_name: valueFor("company_name")?.trim() ?? "",
      website_url: valueFor("website_url")?.trim() ?? "",
      contact_name: nullableValue(valueFor("contact_name")),
      contact_email: nullableValue(valueFor("contact_email")),
      contact_phone: nullableValue(valueFor("contact_phone")),
      notes: nullableValue(valueFor("notes")),
      source: nullableValue(valueFor("source")),
      campaign: nullableValue(valueFor("campaign")),
    };
  });
}

export function previewProspectImportRows(params: {
  rawText: string;
  existingProspects?: Array<Pick<Prospect, "website_url">>;
}) {
  const rows = parseProspectImportText(params.rawText);
  const seenKeys = new Set<string>();
  const existingKeys = new Set(
    (params.existingProspects ?? [])
      .map((prospect) => {
        try {
          return normalizeWebsiteUrl(prospect.website_url);
        } catch {
          return null;
        }
      })
      .filter((value): value is string => !!value),
  );

  const previewRows: ProspectImportPreviewRow[] = rows.map((row) => {
    const errors: string[] = [];
    if (!row.company_name.trim()) errors.push("Company name is required.");
    if (!row.website_url.trim()) errors.push("Website URL is required.");

    let normalizedUrl: string | null = null;
    if (row.website_url.trim()) {
      try {
        normalizedUrl = normalizeWebsiteUrl(row.website_url);
      } catch {
        errors.push("Website URL is invalid.");
      }
    }

    let duplicateReason: string | null = null;
    if (normalizedUrl) {
      if (seenKeys.has(normalizedUrl)) {
        duplicateReason = "Duplicate website URL within this import.";
      } else if (existingKeys.has(normalizedUrl)) {
        duplicateReason = "Prospect with this website already exists.";
      }
    }

    if (normalizedUrl) {
      seenKeys.add(normalizedUrl);
    }

    return {
      ...row,
      normalized_website_url: normalizedUrl,
      duplicate_key: normalizedUrl,
      duplicate_reason: duplicateReason,
      valid: errors.length === 0 && !duplicateReason,
      errors,
    };
  });

  return {
    rows: previewRows,
    summary: {
      total: previewRows.length,
      valid: previewRows.filter((row) => row.valid).length,
      invalid: previewRows.filter((row) => row.errors.length > 0).length,
      duplicates: previewRows.filter((row) => !!row.duplicate_reason).length,
    },
  };
}

export function summarizeCampaignMetrics(params: {
  prospects: Prospect[];
  outreachPackages?: ProspectOutreachPackage[];
}) {
  const prospectCount = params.prospects.length;
  const readyForOutreach = params.prospects.filter((prospect) => prospect.status === "ready_for_outreach").length;
  const converted = params.prospects.filter((prospect) => prospect.status === "converted").length;
  const outreachReady = params.prospects.filter((prospect) => prospect.outreach_status === "ready").length;
  const sent = params.prospects.filter((prospect) => prospect.outreach_status === "sent").length;

  return {
    prospectCount,
    readyForOutreach,
    converted,
    outreachReady,
    sent,
    packageCount: params.outreachPackages?.length ?? 0,
  };
}
