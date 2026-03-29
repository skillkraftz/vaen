"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/lib/types";
import type { TeamMemberSummary } from "@/lib/team-settings";
import { updateUserRoleAction } from "./actions";

const ROLE_OPTIONS: UserRole[] = ["viewer", "sales", "operator", "admin"];

const ROLE_HELP: Record<UserRole, { label: string; permissions: string }> = {
  viewer: {
    label: "Viewer",
    permissions: "Can review records and statuses, but cannot trigger sensitive operational actions.",
  },
  sales: {
    label: "Sales",
    permissions: "Can work prospects and outreach, including batch outreach, but does not manage pricing or team roles.",
  },
  operator: {
    label: "Operator",
    permissions: "Can run delivery workflow, revisions, builds, reviews, and standard project operations.",
  },
  admin: {
    label: "Admin",
    permissions: "Can manage pricing, roles, approvals, and other high-risk controls.",
  },
};

function RoleRow({
  member,
  canManage,
  lastAdminProtected,
}: {
  member: TeamMemberSummary;
  canManage: boolean;
  lastAdminProtected: boolean;
}) {
  const router = useRouter();
  const [draftRole, setDraftRole] = useState<UserRole>(member.role);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateUserRoleAction(member.userId, draftRole);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <tr data-testid={`team-member-row-${member.userId}`}>
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <strong>{member.email ?? member.userId}</strong>
          <span className="text-sm text-muted">
            {member.isCurrentUser ? "Current user" : "Team member"}
            {!member.hasExplicitRole && " · no explicit role record, defaults to operator"}
          </span>
        </div>
      </td>
      <td>
        {canManage ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <select
              className="form-input"
              value={draftRole}
              onChange={(event) => setDraftRole(event.target.value as UserRole)}
              disabled={isPending || lastAdminProtected}
              data-testid={`team-role-select-${member.userId}`}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <p className="text-sm text-muted" style={{ maxWidth: "16rem" }}>
              {ROLE_HELP[draftRole].permissions}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span className="badge" data-testid={`team-role-badge-${member.userId}`}>{member.role}</span>
            <p className="text-sm text-muted" style={{ maxWidth: "16rem" }}>
              {ROLE_HELP[member.role].permissions}
            </p>
          </div>
        )}
      </td>
      <td className="text-sm text-muted">
        {member.grantedAt ? new Date(member.grantedAt).toLocaleString("en-US") : "Bootstrap/default"}
      </td>
      <td className="text-sm text-muted">
        {lastAdminProtected ? "Last admin protected" : member.grantedBy ?? "system"}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {canManage ? (
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={save}
              disabled={isPending || draftRole === member.role || lastAdminProtected}
              data-testid={`team-role-save-${member.userId}`}
            >
              {isPending ? "Saving..." : "Save"}
            </button>
            {lastAdminProtected && (
              <p className="text-sm text-muted" style={{ marginTop: "0.35rem", maxWidth: "14rem" }}>
                Promote another admin before changing this role.
              </p>
            )}
            {error && (
              <p className="text-sm" style={{ color: "var(--color-error)", marginTop: "0.35rem", maxWidth: "14rem" }}>
                {error}
              </p>
            )}
          </>
        ) : (
          <span className="text-sm text-muted">Read only</span>
        )}
      </td>
    </tr>
  );
}

export function TeamSettingsPanel({
  members,
  canManage,
  currentRole,
  error,
  inviteAvailable,
}: {
  members: TeamMemberSummary[];
  canManage: boolean;
  currentRole: UserRole | null;
  error?: string;
  inviteAvailable: boolean;
}) {
  const adminCount = members.filter((member) => member.role === "admin").length;

  return (
    <div className="section" data-testid="team-settings-page">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Team Settings</h1>
          <p className="text-sm text-muted">
            Manage human access to the existing role model. Roles inherit permissions: viewer &lt; sales &lt; operator &lt; admin.
          </p>
        </div>
        {currentRole && <span className="badge" data-testid="team-current-role">{currentRole}</span>}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="team-settings-summary">
        <p className="text-sm text-muted">
          {canManage
            ? "Admins can update roles here. Changes take effect immediately on the server-side permission checks."
            : "You can review your current role here. Team role changes, pricing changes, and permanent deletes require an admin."}
        </p>
        {canManage && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
            <p className="text-sm text-muted">
              High-risk controls already enforced by role: pricing changes require admin, permanent project purge requires admin, and batch outreach requires sales or higher.
            </p>
            <p className="text-sm text-muted">
              Some actions can also require approval, such as large discounts and larger batch outreach sends.
            </p>
            <p className="text-sm text-muted">
              Last-admin protection is enforced in the UI and server action layer.
            </p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="team-role-guide">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Role Guide</h2>
        <div className="detail-grid">
          {ROLE_OPTIONS.map((role) => (
            <div key={role} style={{ minWidth: 0 }}>
              <strong>{ROLE_HELP[role].label}</strong>
              <p className="text-sm text-muted" style={{ marginTop: "0.25rem" }}>
                {ROLE_HELP[role].permissions}
              </p>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p className="text-sm" style={{ color: "var(--color-error)" }}>{error}</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: "1rem" }} data-testid="team-member-list">
        {members.length === 0 ? (
          <p className="text-sm text-muted">No team members found yet.</p>
        ) : (
          <div className="scroll-shell">
            <table className="info-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Granted</th>
                  <th>Granted By</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <RoleRow
                    key={member.userId}
                    member={member}
                    canManage={canManage}
                    lastAdminProtected={adminCount === 1 && member.role === "admin"}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" data-testid="team-invite-stub">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Invite User</h2>
        {inviteAvailable ? (
          <p className="text-sm text-muted">Invite support is available.</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Invite-by-email is not wired yet. No invitation email will be sent from this page, and there is no in-app acceptance flow yet.
            </p>
            <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
              Current safe path:
              {" "}
              the new user signs up through the existing auth flow first, then an admin assigns the correct role here.
            </p>
            <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
              This keeps role changes explicit and avoids creating orphaned or half-invited accounts until backend invite support exists.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
