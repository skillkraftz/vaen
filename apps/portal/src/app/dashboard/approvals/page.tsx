import { ApprovalQueueManager } from "./approval-queue-manager";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/user-role-server";
import { listVisibleApprovalRequests } from "@/lib/approval-helpers";

export default async function ApprovalsPage() {
  const roleCheck = await requireRole("admin");
  if (!roleCheck.ok) {
    return (
      <div className="section">
        <div className="card">
          <h1>Approvals</h1>
          <p className="text-sm text-muted">{roleCheck.error}</p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [pending, recent] = await Promise.all([
    listVisibleApprovalRequests(supabase, { statuses: ["pending"], limit: 50 }),
    listVisibleApprovalRequests(supabase, { statuses: ["approved", "rejected", "expired"], limit: 50 }),
  ]);

  return <ApprovalQueueManager pending={pending} recent={recent} />;
}
