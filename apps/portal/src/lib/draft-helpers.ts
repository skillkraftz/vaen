/**
 * Pure draft-request helpers — no I/O, no DB, fully testable.
 *
 * Extracted from actions.ts so the merge/validation/defaults logic
 * can be covered by fast unit tests without mocking Supabase.
 */

/** Required top-level keys in a valid client-request.json */
export const REQUIRED_DRAFT_KEYS = ["version", "business", "contact"] as const;

/** Safe defaults when draft_request is null or missing keys */
export const DRAFT_DEFAULTS: Record<string, unknown> = {
  version: "1.0.0",
  business: {},
  contact: {},
  services: [],
  content: {},
  preferences: {},
};

/** Deep merge: target fields are overridden by source, objects are recursively merged */
export function deepMergeDraft(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMergeDraft(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/** Immutably set a nested path on an object */
export function deepSetServer(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 1) return { ...obj, [path[0]]: value };
  const [head, ...rest] = path;
  const child = (obj[head] ?? {}) as Record<string, unknown>;
  return { ...obj, [head]: deepSetServer(child, rest, value) };
}

/** Validate that required fields exist in the draft */
export function validateDraftRequired(
  draft: Record<string, unknown>,
): string | null {
  const missing = REQUIRED_DRAFT_KEYS.filter((key) => !(key in draft));
  if (missing.length > 0) {
    return `Draft is missing required fields: ${missing.join(", ")}. This would break generation.`;
  }
  return null;
}

/**
 * Ensure a draft has safe defaults for all expected keys.
 * Returns a new object — does not mutate input.
 */
export function ensureDraftDefaults(
  draft: Record<string, unknown> | null,
): Record<string, unknown> {
  return { ...DRAFT_DEFAULTS, ...(draft ?? {}) };
}

export function syncProjectFieldsIntoDraft(
  draft: Record<string, unknown> | null,
  fields: {
    name: string;
    business_type?: string | null;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    notes?: string | null;
  },
): Record<string, unknown> {
  const next = ensureDraftDefaults(draft);
  const business = { ...((next.business ?? {}) as Record<string, unknown>) };
  const contact = { ...((next.contact ?? {}) as Record<string, unknown>) };
  const content = { ...((next.content ?? {}) as Record<string, unknown>) };
  const intake = { ...((next._intake ?? {}) as Record<string, unknown>) };

  business.name = fields.name;
  if (fields.business_type !== undefined) {
    if (fields.business_type) business.type = fields.business_type;
    else delete business.type;
  }

  if (fields.contact_name !== undefined) {
    if (fields.contact_name) contact.name = fields.contact_name;
    else delete contact.name;
  }

  if (fields.contact_email !== undefined) {
    if (fields.contact_email) contact.email = fields.contact_email;
    else delete contact.email;
  }

  if (fields.contact_phone !== undefined) {
    if (fields.contact_phone) contact.phone = fields.contact_phone;
    else delete contact.phone;
  }

  if (fields.notes !== undefined) {
    if (fields.notes) content.about = fields.notes;
    else delete content.about;
  }

  intake.businessName = fields.name;
  if (fields.business_type !== undefined) {
    if (fields.business_type) intake.businessType = fields.business_type;
    else delete intake.businessType;
  }

  if (fields.contact_name !== undefined) {
    if (fields.contact_name) intake.contactName = fields.contact_name;
    else delete intake.contactName;
  }

  if (fields.contact_email !== undefined) {
    if (fields.contact_email) intake.contactEmail = fields.contact_email;
    else delete intake.contactEmail;
  }

  if (fields.contact_phone !== undefined) {
    if (fields.contact_phone) intake.contactPhone = fields.contact_phone;
    else delete intake.contactPhone;
  }

  if (fields.notes !== undefined) {
    if (fields.notes) intake.notes = fields.notes;
    else delete intake.notes;
  }

  next.business = business;
  next.contact = contact;
  next.content = content;
  next._intake = intake;

  return next;
}
