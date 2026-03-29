import { ensureDraftDefaults } from "@/lib/draft-helpers";

export interface ClientSeed {
  name: string;
  businessType: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
}

export function asNullableString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildInitialRequestSnapshot(seed: ClientSeed): Record<string, unknown> {
  return ensureDraftDefaults({
    business: {
      name: seed.name,
      type: seed.businessType ?? "",
    },
    contact: {
      name: seed.contactName ?? "",
      email: seed.contactEmail ?? "",
      phone: seed.contactPhone ?? "",
    },
    services: [],
    content: {},
    preferences: {},
    _intake: {
      businessName: seed.name,
      businessType: seed.businessType ?? undefined,
      contactName: seed.contactName ?? undefined,
      contactEmail: seed.contactEmail ?? undefined,
      contactPhone: seed.contactPhone ?? undefined,
      notes: seed.notes ?? undefined,
    },
  });
}
