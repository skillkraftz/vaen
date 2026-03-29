"use server";

import { createClient } from "@/lib/supabase/server";
import type { ApprovalRequest, ApprovalRequestType, ApprovalStatus } from "@/lib/types";
import {
  createApprovalRequestRecord,
  listVisibleApprovalRequests,
  resolveApprovalRequestRecord,
} from "@/lib/approval-helpers";
import { requireRole } from "@/lib/user-role-server";

export async function listPendingApprovalsAction(): Promise<{
  pending: ApprovalRequest[];
  recent: ApprovalRequest[];
  error?: string;
}> {
  const roleCheck = await requireRole("admin");
  if (!roleCheck.ok) return { pending: [], recent: [], error: roleCheck.error };

  const supabase = await createClient();
  try {
    const [pending, recent] = await Promise.all([
      listVisibleApprovalRequests(supabase, { statuses: ["pending"], limit: 50 }),
      listVisibleApprovalRequests(supabase, { statuses: ["approved", "rejected", "expired"], limit: 50 }),
    ]);
    return { pending, recent };
  } catch (error) {
    return { pending: [], recent: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createApprovalRequestAction(
  requestType: ApprovalRequestType,
  context: Record<string, unknown>,
): Promise<{ error?: string; request?: ApprovalRequest }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  try {
    const { request } = await createApprovalRequestRecord(supabase, {
      requestType,
      requestedBy: user.id,
      context: {
        ...context,
        requester_email: user.email ?? null,
      },
    });
    return { request };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resolveApprovalRequestAction(
  requestId: string,
  decision: "approved" | "rejected",
  resolutionNote?: string | null,
): Promise<{ error?: string; request?: ApprovalRequest; execution?: Record<string, unknown>; stale?: boolean }> {
  const roleCheck = await requireRole("admin");
  if (!roleCheck.ok) return { error: roleCheck.error };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const result = await resolveApprovalRequestRecord(supabase, {
    requestId,
    decision,
    resolverId: user.id,
    resolutionNote,
  });

  return {
    error: result.error,
    request: result.request,
    execution: result.execution,
    stale: result.stale,
  };
}
