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
