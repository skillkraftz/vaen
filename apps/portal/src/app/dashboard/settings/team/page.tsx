import { listTeamMembersAction } from "./actions";
import { TeamSettingsPanel } from "./team-settings-panel";

export default async function TeamSettingsPage() {
  const result = await listTeamMembersAction();

  return (
    <TeamSettingsPanel
      members={result.members}
      canManage={result.canManage}
      currentRole={result.currentRole}
      error={result.error}
      inviteAvailable={result.inviteAvailable}
    />
  );
}
