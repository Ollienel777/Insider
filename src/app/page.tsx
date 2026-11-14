import { MISSIONS } from "@/agents/builder/missions";
import { MissionList } from "@/components/missions/mission-list";
import { AppShell } from "@/components/shell/app-shell";

// The mission picker (SPEC §2 beat 1): the five missions of the library,
// fixtures in every mode (§4.6). Picking one opens its cast screen.
export default function MissionsPage() {
  return (
    <AppShell>
      <MissionList missions={MISSIONS} />
    </AppShell>
  );
}
