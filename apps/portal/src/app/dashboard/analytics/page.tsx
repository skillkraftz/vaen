import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/user-role-server";
import { fetchAnalyticsData } from "@/lib/analytics";
import { AnalyticsDashboard } from "./analytics-dashboard";

export default async function AnalyticsPage() {
  const roleCheck = await requireRole("sales");
  if (!roleCheck.ok) {
    return (
      <div className="section" data-testid="analytics-page">
        <p className="text-sm" style={{ color: "var(--color-error)" }} data-testid="analytics-page-error">
          {roleCheck.error ?? "Insufficient permissions."}
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  try {
    const data = await fetchAnalyticsData(supabase);
    return <AnalyticsDashboard data={data} />;
  } catch (error) {
    return (
      <div className="section" data-testid="analytics-page">
        <div className="card" data-testid="analytics-page-error" style={{ padding: "0.75rem" }}>
          <p className="text-sm" style={{ color: "var(--color-error)" }}>
            Analytics data is unavailable right now.
          </p>
          <p className="text-sm text-muted" style={{ marginTop: "0.35rem" }}>
            {error instanceof Error ? error.message : "Unknown analytics error."}
          </p>
        </div>
      </div>
    );
  }
}
