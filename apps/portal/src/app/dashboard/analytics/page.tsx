import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/user-role-server";
import { fetchAnalyticsData } from "@/lib/analytics";
import { AnalyticsDashboard } from "./analytics-dashboard";

export default async function AnalyticsPage() {
  const roleCheck = await requireRole("sales");
  if (!roleCheck.ok) {
    return (
      <div className="section" data-testid="analytics-page">
        <p className="text-sm" style={{ color: "var(--color-error)" }}>
          {roleCheck.error ?? "Insufficient permissions."}
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const data = await fetchAnalyticsData(supabase);

  return <AnalyticsDashboard data={data} />;
}
