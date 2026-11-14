import { notFound } from "next/navigation";
import { buildsOnDemand, levelFor } from "@/agents/builder/live-levels";
import { ScoutScreen } from "@/components/scout/scout-screen";
import { findBuilding } from "@/lib/building";
import { optionalMissionParam, type SearchParams } from "@/lib/mission-param";

// The Scout screen (SPEC §2 beat 2). The CoStar facts come with the page; the
// aerial is fetched by the screen from /api/buildings/[id]/aerial, behind a
// skeleton the size of the final render.
export default async function ScoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  // A building with no own mission (a kit pin from the map) scouts without one.
  const missionId = await optionalMissionParam(building.id, "scout", searchParams);
  // A kit building with its level built for this mission (#93) plans like a fixture.
  const hasLevel = Boolean(missionId && buildsOnDemand(building) && (await levelFor(building, missionId)));
  const { name, city, neighbourhood, yearBuilt, buildingClass, stories, source } = building;
  return (
    <ScoutScreen building={{ id: building.id, name, city, neighbourhood, yearBuilt, buildingClass, stories, source }} hasLevel={hasLevel} />
  );
}
