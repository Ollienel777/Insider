import { notFound } from "next/navigation";
import { readCachedLevel } from "@/agents/builder/cache";
import { RunScreen } from "@/components/run/run-screen";
import { findBuilding } from "@/lib/building";

// The Run screen (SPEC §2 beat 5). The cached manifest comes with the page
// (it holds CoStar and Vexcel values and fiction only, SPEC §4.1); the floor
// is loaded in the browser by the Matterport adapter, which places the level
// on it there (SPEC §4.5).
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  const cached = await readCachedLevel(building.id);
  return (
    <RunScreen
      building={{ id: building.id, name: building.name, matterportModelId: building.matterportModelId }}
      manifest={cached?.manifest ?? null}
      heistMode={process.env.HEIST_MODE}
    />
  );
}
