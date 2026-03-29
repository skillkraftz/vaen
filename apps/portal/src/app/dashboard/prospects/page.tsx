import { createClient } from "@/lib/supabase/server";
import type { Campaign, Prospect } from "@/lib/types";
import { ProspectListManager } from "./prospect-list-manager";

export default async function ProspectsPage() {
  const supabase = await createClient();
  const [{ data: prospects }, { data: campaigns }] = await Promise.all([
    supabase
      .from("prospects")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <ProspectListManager
      prospects={(prospects ?? []) as Prospect[]}
      campaigns={(campaigns ?? []) as Campaign[]}
    />
  );
}
