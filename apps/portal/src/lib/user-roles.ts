import type { UserRole } from "./types";

export const ROLE_HIERARCHY: UserRole[] = ["viewer", "sales", "operator", "admin"];
export const DEFAULT_USER_ROLE: UserRole = "operator";

export function normalizeUserRole(role: string | null | undefined): UserRole {
  if (!role) return DEFAULT_USER_ROLE;
  return ROLE_HIERARCHY.includes(role as UserRole) ? (role as UserRole) : DEFAULT_USER_ROLE;
}

export function roleRank(role: UserRole) {
  return ROLE_HIERARCHY.indexOf(role);
}

export function roleSatisfies(role: UserRole, minRole: UserRole) {
  return roleRank(role) >= roleRank(minRole);
}
