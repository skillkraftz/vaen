import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/types";
import { NewIntakeForm } from "./new-intake-form";

export default async function NewIntakePage() {
  const supabase = await createClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("*")
    .order("name", { ascending: true });

  return <NewIntakeForm clients={(clients ?? []) as Client[]} />;
}
