import { notFound } from "next/navigation";
import { ScoutScreen } from "@/components/scout/scout-screen";
import { findBuilding } from "@/lib/building";

// The Scout screen (SPEC §2 beat 2). The CoStar facts come with the page; the
// aerial is fetched by the screen from /api/buildings/[id]/aerial, behind a
// skeleton the size of the final render.
export default async function ScoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  const { name, city, neighbourhood, yearBuilt, buildingClass, stories } = building;
  return <ScoutScreen building={{ id: building.id, name, city, neighbourhood, yearBuilt, buildingClass, stories }} />;
}
