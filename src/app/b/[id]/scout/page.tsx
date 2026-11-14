import { notFound } from "next/navigation";
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
  await optionalMissionParam(building.id, "scout", searchParams);
  const { name, city, neighbourhood, yearBuilt, buildingClass, stories } = building;
  return <ScoutScreen building={{ id: building.id, name, city, neighbourhood, yearBuilt, buildingClass, stories }} />;
}
