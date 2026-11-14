import { notFound } from "next/navigation";
import { readCachedLevel, type CachedLevel } from "@/agents/builder/cache";
import { RunScreen } from "@/components/run/run-screen";
import { LevelUnavailable } from "@/components/shell/level-unavailable";
import { findBuilding } from "@/lib/building";

// The Run screen (SPEC §2 beat 5). The cached manifest comes with the page
// (it holds CoStar and Vexcel values and fiction only, SPEC §4.1); the floor
// is loaded in the browser by the Matterport adapter, which places the level
// on it there (SPEC §4.5).
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  // A level that fails its check is this screen's error state, as on the Dossier.
  let cached: CachedLevel | null;
  try {
    cached = await readCachedLevel(building.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return <LevelUnavailable buildingId={building.id} name={building.name} step="Run" detail={message} />;
  }
  return (
    <RunScreen
      building={{ id: building.id, name: building.name, matterportModelId: building.matterportModelId }}
      manifest={cached?.manifest ?? null}
      heistMode={process.env.HEIST_MODE}
    />
  );
}
