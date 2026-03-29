import type { UserRole } from "./types";
import { normalizeUserRole } from "./user-roles";

export interface TeamMemberSummary {
  userId: string;
  email: string | null;
  role: UserRole;
  hasExplicitRole: boolean;
  createdAt: string | null;
  grantedAt: string | null;
  grantedBy: string | null;
  isCurrentUser: boolean;
}

export function countAdmins(members: Array<Pick<TeamMemberSummary, "role">>) {
  return members.filter((member) => member.role === "admin").length;
}

export function isLastAdminProtected(params: {
  members: Array<Pick<TeamMemberSummary, "userId" | "role">>;
  targetUserId: string;
  nextRole: UserRole;
}) {
  const target = params.members.find((member) => member.userId === params.targetUserId);
  if (!target) return false;
  if (normalizeUserRole(target.role) !== "admin") return false;
  if (params.nextRole === "admin") return false;
  return countAdmins(params.members) <= 1;
}

export function sortTeamMembers(members: TeamMemberSummary[]) {
  return [...members].sort((left, right) => {
    if (left.role !== right.role) {
      const rank = { admin: 0, operator: 1, sales: 2, viewer: 3 } as const;
      return rank[left.role] - rank[right.role];
    }
    if (left.email && right.email) return left.email.localeCompare(right.email);
    if (left.email) return -1;
    if (right.email) return 1;
    return left.userId.localeCompare(right.userId);
  });
}
