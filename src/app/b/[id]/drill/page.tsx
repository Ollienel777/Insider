import { notFound } from "next/navigation";
import { DrillScreen } from "@/components/drill/drill-screen";
import { findBuilding } from "@/lib/building";

// The Drill screen (SPEC §2 beat 7). The building's CoStar record comes with
// the page (no tenant fields exist in it, SPEC §4.1); the floor is loaded in
// the browser by the Matterport adapter, and the drill runs there (SPEC §4.5).
export default async function DrillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  return <DrillScreen building={building} heistMode={process.env.HEIST_MODE} />;
}
