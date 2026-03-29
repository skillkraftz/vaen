import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Campaign, Prospect, ProspectOutreachPackage } from "@/lib/types";
import { CampaignDetailManager } from "./campaign-detail-manager";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();

  if (!campaign) notFound();

  const { data: prospects } = await supabase
    .from("prospects")
    .select("*")
    .eq("campaign_id", id)
    .order("created_at", { ascending: false });

  const prospectItems = (prospects ?? []) as Prospect[];
  const prospectIds = prospectItems.map((prospect) => prospect.id);
  const { data: packages } = prospectIds.length > 0
    ? await supabase
        .from("prospect_outreach_packages")
        .select("*")
        .in("prospect_id", prospectIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const latestPackageByProspect = new Map<string, ProspectOutreachPackage>();
  for (const item of (packages ?? []) as ProspectOutreachPackage[]) {
    if (!latestPackageByProspect.has(item.prospect_id)) {
      latestPackageByProspect.set(item.prospect_id, item);
    }
  }

  return (
    <CampaignDetailManager
      campaign={campaign as Campaign}
      rows={prospectItems.map((prospect) => ({
        prospect,
        latestPackage: latestPackageByProspect.get(prospect.id) ?? null,
      }))}
    />
  );
}
