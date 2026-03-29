"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bootstrapCurrentUserRole, requireRole } from "@/lib/user-role-server";
import type { UserRole, UserRoleRecord } from "@/lib/types";
import {
  isLastAdminProtected,
  sortTeamMembers,
  type TeamMemberSummary,
} from "@/lib/team-settings";
import { normalizeUserRole } from "@/lib/user-roles";

function mapRoleRecordByUserId(records: UserRoleRecord[]) {
  return new Map(records.map((record) => [record.user_id, record]));
}

export async function listTeamMembersAction(): Promise<{
  members: TeamMemberSummary[];
  currentUserId: string | null;
  currentRole: UserRole | null;
  canManage: boolean;
  inviteAvailable: boolean;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return {
      members: [],
      currentUserId: null,
      currentRole: null,
      canManage: false,
      inviteAvailable: false,
      error: userError.message,
    };
  }

  if (!user) {
    return {
      members: [],
      currentUserId: null,
      currentRole: null,
      canManage: false,
      inviteAvailable: false,
      error: "Not authenticated",
    };
  }

  const roleState = await bootstrapCurrentUserRole();
  const currentRole = roleState.role ?? "operator";
  const canManage = currentRole === "admin";

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("*");

  if (rolesError) {
    return {
      members: [],
      currentUserId: user.id,
      currentRole,
      canManage,
      inviteAvailable: false,
      error: rolesError.message,
    };
  }

  const roleRecords = (roleRows ?? []) as UserRoleRecord[];
  const roleMap = mapRoleRecordByUserId(roleRecords);

  if (!canManage) {
    const selfRole = roleMap.get(user.id);
    return {
      members: [{
        userId: user.id,
        email: user.email ?? null,
        role: normalizeUserRole(selfRole?.role ?? currentRole),
        hasExplicitRole: !!selfRole,
        createdAt: user.created_at ?? null,
        grantedAt: selfRole?.granted_at ?? null,
        grantedBy: selfRole?.granted_by ?? null,
        isCurrentUser: true,
      }],
      currentUserId: user.id,
      currentRole,
      canManage: false,
      inviteAvailable: false,
    };
  }

  const admin = createAdminClient();
  const { data: listedUsers, error: listUsersError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (listUsersError) {
    return {
      members: [],
      currentUserId: user.id,
      currentRole,
      canManage: true,
      inviteAvailable: false,
      error: listUsersError.message,
    };
  }

  const members = sortTeamMembers((listedUsers.users ?? []).map((authUser) => {
    const roleRecord = roleMap.get(authUser.id);
    return {
      userId: authUser.id,
      email: authUser.email ?? null,
      role: normalizeUserRole(roleRecord?.role),
      hasExplicitRole: !!roleRecord,
      createdAt: authUser.created_at ?? null,
      grantedAt: roleRecord?.granted_at ?? null,
      grantedBy: roleRecord?.granted_by ?? null,
      isCurrentUser: authUser.id === user.id,
    } satisfies TeamMemberSummary;
  }));

  return {
    members,
    currentUserId: user.id,
    currentRole,
    canManage: true,
    inviteAvailable: false,
  };
}

export async function updateUserRoleAction(
  targetUserId: string,
  nextRole: UserRole,
): Promise<{ error?: string }> {
  const roleCheck = await requireRole("admin");
  if (!roleCheck.ok) return { error: roleCheck.error };

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { error: userError.message };
  if (!user) return { error: "Not authenticated" };
  if (!targetUserId) return { error: "Target user is required." };
  if (!["viewer", "sales", "operator", "admin"].includes(nextRole)) {
    return { error: "Invalid role." };
  }

  const admin = createAdminClient();
  const { data: targetUser, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
  if (targetError || !targetUser.user) {
    return { error: targetError?.message ?? "Target user not found." };
  }

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("*");
  if (rolesError) return { error: rolesError.message };

  const members = (roleRows ?? []) as UserRoleRecord[];
  const normalizedMembers = members.map((member) => ({
    userId: member.user_id,
    role: normalizeUserRole(member.role),
  }));

  if (isLastAdminProtected({
    members: normalizedMembers,
    targetUserId,
    nextRole,
  })) {
    return { error: "The last admin cannot be demoted." };
  }

  const { error: upsertError } = await supabase
    .from("user_roles")
    .upsert({
      user_id: targetUserId,
      role: nextRole,
      granted_by: user.id,
      granted_at: new Date().toISOString(),
    }, {
      onConflict: "user_id",
    });

  if (upsertError) return { error: upsertError.message };

  revalidatePath("/dashboard/settings/team");
  revalidatePath("/dashboard");
  return {};
}
