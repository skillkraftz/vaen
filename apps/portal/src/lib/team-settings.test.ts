import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLastAdminProtected, sortTeamMembers } from "./team-settings";

describe("team settings helpers", () => {
  it("protects the last admin from demotion", () => {
    expect(isLastAdminProtected({
      members: [{ userId: "u-1", role: "admin" }],
      targetUserId: "u-1",
      nextRole: "operator",
    })).toBe(true);

    expect(isLastAdminProtected({
      members: [
        { userId: "u-1", role: "admin" },
        { userId: "u-2", role: "admin" },
      ],
      targetUserId: "u-1",
      nextRole: "operator",
    })).toBe(false);
  });

  it("sorts members by role priority and email", () => {
    const members = sortTeamMembers([
      {
        userId: "u-2",
        email: "sales@example.com",
        role: "sales",
        hasExplicitRole: true,
        createdAt: null,
        grantedAt: null,
        grantedBy: null,
        isCurrentUser: false,
      },
      {
        userId: "u-1",
        email: "admin@example.com",
        role: "admin",
        hasExplicitRole: true,
        createdAt: null,
        grantedAt: null,
        grantedBy: null,
        isCurrentUser: true,
      },
    ]);

    expect(members.map((member) => member.role)).toEqual(["admin", "sales"]);
  });
});

describe("team settings integration", () => {
  it("adds team settings actions with admin gating and last-admin protection", () => {
    const actionsPath = join(__dirname, "../app/dashboard/settings/team/actions.ts");
    const source = readFileSync(actionsPath, "utf-8");
    expect(source).toContain("export async function listTeamMembersAction");
    expect(source).toContain("export async function updateUserRoleAction");
    expect(source).toContain('requireRole("admin")');
    expect(source).toContain("createAdminClient");
    expect(source).toContain("auth.admin.listUsers");
    expect(source).toContain("The last admin cannot be demoted.");
  });

  it("renders team settings page and role controls", () => {
    const pagePath = join(__dirname, "../app/dashboard/settings/team/page.tsx");
    const uiPath = join(__dirname, "../app/dashboard/settings/team/team-settings-panel.tsx");
    const pageSource = readFileSync(pagePath, "utf-8");
    const uiSource = readFileSync(uiPath, "utf-8");
    expect(pageSource).toContain("listTeamMembersAction");
    expect(pageSource).toContain("TeamSettingsPanel");
    expect(uiSource).toContain('data-testid="team-settings-page"');
    expect(uiSource).toContain('data-testid="team-member-list"');
    expect(uiSource).toContain('data-testid="team-current-role"');
    expect(uiSource).toContain('data-testid="team-invite-stub"');
    expect(uiSource).toContain('data-testid="team-role-guide"');
    expect(uiSource).toContain('className="scroll-shell"');
    expect(uiSource).toContain('data-testid={`team-role-select-${member.userId}`}');
    expect(uiSource).toContain("High-risk controls already enforced by role");
    expect(uiSource).toContain("Some actions can also require approval");
    expect(uiSource).toContain("Invite-by-email is not wired yet");
    expect(uiSource).toContain("No invitation email will be sent from this page");
    expect(uiSource).toContain("Current safe path:");
    expect(uiSource).toContain("Last-admin protection is enforced");
  });

  it("documents each role in operator-friendly language", () => {
    const uiPath = join(__dirname, "../app/dashboard/settings/team/team-settings-panel.tsx");
    const uiSource = readFileSync(uiPath, "utf-8");

    expect(uiSource).toContain("Can review records and statuses");
    expect(uiSource).toContain("Can work prospects and outreach");
    expect(uiSource).toContain("Can run delivery workflow");
    expect(uiSource).toContain("Can manage pricing, roles, approvals");
  });

  it("adds team navigation for admins in the dashboard layout", () => {
    const layoutPath = join(__dirname, "../app/dashboard/layout.tsx");
    const source = readFileSync(layoutPath, "utf-8");
    expect(source).toContain('/dashboard/settings/team');
    expect(source).toContain("Team");
    expect(source).toContain('roleState.role === "admin"');
  });
});
