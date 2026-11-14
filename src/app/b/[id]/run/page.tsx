import { notFound } from "next/navigation";
import { readCachedLevel, type CachedLevel } from "@/agents/builder/cache";
import { RunScreen } from "@/components/run/run-screen";
import { LevelUnavailable } from "@/components/shell/level-unavailable";
import { findBuilding } from "@/lib/building";
import { missionParam, type SearchParams } from "@/lib/mission-param";

// The Run screen (SPEC §2 beat 5). The cached manifest comes with the page
// (it holds CoStar and Vexcel values and fiction only, SPEC §4.1); the floor
// is loaded in the browser by the Matterport adapter, which places the level
// on it there (SPEC §4.5).
export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  const missionId = await missionParam(building.id, "run", searchParams);
  // A level that fails its check is this screen's error state, as on the Dossier.
  let cached: CachedLevel | null;
  try {
    cached = await readCachedLevel(building.id, missionId);
  } catch (error) {
    console.error(`[level] ${building.id}:${missionId} failed its check`, error);
    return <LevelUnavailable buildingId={building.id} missionId={missionId} name={building.name} step="Run" />;
  }
  return (
    <RunScreen
      building={{ id: building.id, name: building.name, matterportModelId: building.matterportModelId }}
      manifest={cached?.manifest ?? null}
      heistMode={process.env.HEIST_MODE}
    />
  );
}
