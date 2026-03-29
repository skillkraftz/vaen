import { createClient } from "@/lib/supabase/server";
import type { Campaign, Prospect } from "@/lib/types";
import { CampaignListManager } from "./campaign-list-manager";

export default async function CampaignsPage() {
  const supabase = await createClient();
  const [{ data: campaigns }, { data: prospects }] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
    supabase.from("prospects").select("id, campaign_id, outreach_status").order("created_at", { ascending: false }),
  ]);

  const metricsByCampaignId = ((prospects ?? []) as Array<Pick<Prospect, "id" | "campaign_id" | "outreach_status">>).reduce<Record<string, { prospects: number; sent: number; ready: number }>>(
    (acc, prospect) => {
      if (!prospect.campaign_id) return acc;
      const current = acc[prospect.campaign_id] ?? { prospects: 0, sent: 0, ready: 0 };
      current.prospects += 1;
      if (prospect.outreach_status === "sent") current.sent += 1;
      if (prospect.outreach_status === "ready") current.ready += 1;
      acc[prospect.campaign_id] = current;
      return acc;
    },
    {},
  );

  return (
    <CampaignListManager
      campaigns={(campaigns ?? []) as Campaign[]}
      metricsByCampaignId={metricsByCampaignId}
    />
  );
}
