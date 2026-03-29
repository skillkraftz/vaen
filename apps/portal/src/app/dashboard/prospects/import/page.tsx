import { createClient } from "@/lib/supabase/server";
import type { Campaign } from "@/lib/types";
import { ProspectImportForm } from "./prospect-import-form";

export default async function ProspectImportPage() {
  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  return <ProspectImportForm campaigns={(campaigns ?? []) as Campaign[]} />;
}
