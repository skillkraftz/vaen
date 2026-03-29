import "server-only";

import { createClient } from "./supabase/server";
import type { UserRole, UserRoleRecord } from "./types";
import { DEFAULT_USER_ROLE, normalizeUserRole, roleSatisfies } from "./user-roles";

function normalizeRoleRecord(
  value: UserRoleRecord | UserRoleRecord[] | null | undefined,
): UserRoleRecord | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function getUserRole(userId?: string): Promise<UserRole> {
  if (!userId) return DEFAULT_USER_ROLE;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return DEFAULT_USER_ROLE;
  return normalizeUserRole((data as UserRoleRecord).role);
}

export async function bootstrapCurrentUserRole(): Promise<{
  userId: string | null;
  role: UserRole | null;
  record: UserRoleRecord | null;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) return { userId: null, role: null, record: null, error: userError.message };
  if (!user) return { userId: null, role: null, record: null, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("bootstrap_user_role", {
    target_user_id: user.id,
  });

  if (error) return { userId: user.id, role: DEFAULT_USER_ROLE, record: null, error: error.message };

  const record = normalizeRoleRecord(data as UserRoleRecord | UserRoleRecord[] | null);
  const role = normalizeUserRole(record?.role);
  return { userId: user.id, role, record };
}

export async function requireRole(minRole: UserRole): Promise<{
  ok: boolean;
  role: UserRole | null;
  error?: string;
}> {
  const bootstrapped = await bootstrapCurrentUserRole();
  if (bootstrapped.error || !bootstrapped.role) {
    return {
      ok: false,
      role: bootstrapped.role,
      error: bootstrapped.error ?? "Not authenticated",
    };
  }

  if (!roleSatisfies(bootstrapped.role, minRole)) {
    return {
      ok: false,
      role: bootstrapped.role,
      error: `Requires ${minRole} role or higher.`,
    };
  }

  return { ok: true, role: bootstrapped.role };
}
