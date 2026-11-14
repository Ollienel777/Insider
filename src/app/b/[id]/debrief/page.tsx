import { notFound } from "next/navigation";
import { readCachedLevel, type CachedLevel } from "@/agents/builder/cache";
import { DebriefScreen } from "@/components/debrief/debrief-screen";
import { LevelUnavailable } from "@/components/shell/level-unavailable";
import { findBuilding } from "@/lib/building";

// The Debrief screen (SPEC §2 beat 6). Pure client state: the run's log is in
// the browser's storage, and the level is placed again there on the floor the
// Matterport adapter loads (SPEC §4.5), from the cached manifest that comes
// with the page.
export default async function DebriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  // A level that fails its check is this screen's error state, as on the Dossier.
  let cached: CachedLevel | null;
  try {
    cached = await readCachedLevel(building.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return <LevelUnavailable buildingId={building.id} name={building.name} step="Debrief" detail={message} />;
  }
  return (
    <DebriefScreen
      building={{ id: building.id, name: building.name, matterportModelId: building.matterportModelId }}
      manifest={cached?.manifest ?? null}
      heistMode={process.env.HEIST_MODE}
    />
  );
}
