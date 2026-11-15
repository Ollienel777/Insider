import { getCoStar } from "@/adapters/costar";
import { MISSIONS } from "@/agents/builder/missions";
import { MissionList, type MissionMapBuilding } from "@/components/missions/mission-list";
import { AppShell } from "@/components/shell/app-shell";
import { City } from "@/domain";
import { forcedServices } from "@/lib/forced-server";

// The mission picker (SPEC §2 beat 1): the five missions of the library,
// fixtures in every mode (§4.6). Picking one opens its cast screen. Its map
// marks each city's buildings, from the CoStar adapter; if CoStar can't answer,
// the map shows the streets alone and the picker still works.
export default async function MissionsPage() {
  return (
    <AppShell>
      <MissionList missions={MISSIONS} buildings={await mapBuildings()} />
    </AppShell>
  );
}

async function mapBuildings(): Promise<MissionMapBuilding[]> {
  try {
    const forced = (await forcedServices()).has("costar");
    const { adapter } = getCoStar({ forced });
    const all = (await Promise.all(City.options.map((c) => adapter.listBuildings(c)))).flat();
    return all.map(({ id, name, city, lat, lng }) => ({ id, name, city, lat, lng }));
  } catch {
    return [];
  }
}
