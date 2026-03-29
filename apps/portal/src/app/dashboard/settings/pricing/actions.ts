"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PackagePricing, PricingChangeEvent } from "@/lib/types";
import {
  buildPricingChangeAudit,
  sanitizePricingItemUpdate,
  type PricingItemUpdateInput,
  validatePricingItemUpdate,
} from "@/lib/pricing-settings";

export async function listPricingSettingsAction(): Promise<{
  items: PackagePricing[];
  history: PricingChangeEvent[];
  error?: string;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { items: [], history: [], error: "Not authenticated" };

  const [{ data: items, error: itemsError }, { data: history, error: historyError }] = await Promise.all([
    supabase
      .from("package_pricing")
      .select("*")
      .order("item_type", { ascending: true })
      .order("sort_order", { ascending: true }),
    supabase
      .from("pricing_change_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const error = itemsError?.message ?? historyError?.message;
  if (error) return { items: [], history: [], error };
  return {
    items: (items ?? []) as PackagePricing[],
    history: (history ?? []) as PricingChangeEvent[],
  };
}

export async function updatePricingItemAction(
  pricingItemId: string,
  input: PricingItemUpdateInput,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const validation = validatePricingItemUpdate(input);
  if (!validation.valid) return { error: validation.error };

  const { data: existing, error: existingError } = await supabase
    .from("package_pricing")
    .select("*")
    .eq("id", pricingItemId)
    .single();

  if (existingError || !existing) {
    return { error: existingError?.message ?? "Pricing item not found." };
  }

  const currentItem = existing as PackagePricing;
  const sanitized = sanitizePricingItemUpdate(input);
  const audit = buildPricingChangeAudit(currentItem, sanitized);
  if (!audit.changed) return {};

  const { error: updateError } = await supabase
    .from("package_pricing")
    .update(sanitized)
    .eq("id", pricingItemId);

  if (updateError) return { error: updateError.message };

  await supabase.from("pricing_change_events").insert({
    pricing_item_id: pricingItemId,
    changed_by: user.id,
    changed_by_email: user.email ?? null,
    previous_values: audit.previousValues,
    next_values: audit.nextValues,
    change_reason: input.change_reason?.trim() ? input.change_reason.trim() : null,
  });

  revalidatePath("/dashboard/settings/pricing");
  return {};
}
