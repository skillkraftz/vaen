import { createClient } from "@/lib/supabase/server";

type PortalSupabase = Awaited<ReturnType<typeof createClient>>;

function slugifySegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function normalizeVariantLabel(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function allocateVariantIdentity(
  supabase: PortalSupabase,
  source: { id: string; name: string; slug: string; variant_of: string | null },
  variantLabel: string | null,
) {
  const normalizedLabel = normalizeVariantLabel(variantLabel);
  const suffix = slugifySegment(normalizedLabel ?? "variant") || "variant";
  const baseSlug = `${source.slug}-${suffix}`;
  const lineageRootId = source.variant_of ?? source.id;

  let nextSlug = baseSlug;
  let attempt = 2;
  while (true) {
    const { data: existing } = await supabase
      .from("projects")
      .select("id")
      .eq("slug", nextSlug)
      .maybeSingle();

    if (!existing) break;
    nextSlug = `${baseSlug}-${attempt}`;
    attempt += 1;
  }

  const nextName = normalizedLabel
    ? `${source.name} (${normalizedLabel})`
    : `${source.name} (Variant)`;

  return {
    lineageRootId,
    variantLabel: normalizedLabel,
    name: nextName,
    slug: nextSlug,
  };
}
