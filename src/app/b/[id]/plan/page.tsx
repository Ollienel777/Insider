import { notFound } from "next/navigation";
import { readCachedLevel } from "@/agents/builder/cache";
import { PlanScreen } from "@/components/plan/plan-screen";
import { findBuilding } from "@/lib/building";
import { missionParam, type SearchParams } from "@/lib/mission-param";

// The Plan screen (SPEC §2 beat 4). Like Run, the cached manifest comes with
// the page and the floor loads in the browser, where the crew's plan is
// checked on it (SPEC §4.5).
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  const missionId = await missionParam(building.id, "plan", searchParams);
  const cached = missionId ? await readCachedLevel(building.id, missionId) : null;
  return (
    <PlanScreen
      building={{ id: building.id, name: building.name, matterportModelId: building.matterportModelId }}
      manifest={cached?.manifest ?? null}
      heistMode={process.env.HEIST_MODE}
    />
  );
}
