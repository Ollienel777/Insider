import { notFound } from "next/navigation";
import { DrillScreen } from "@/components/drill/drill-screen";
import { findBuilding } from "@/lib/building";
import { missionParam, type SearchParams } from "@/lib/mission-param";

// The Drill screen (SPEC §2 beat 7). The building's CoStar record comes with
// the page (no tenant fields exist in it, SPEC §4.1); the floor is loaded in
// the browser by the Matterport adapter, and the drill runs there (SPEC §4.5).
export default async function DrillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  // Drill reads no level, so it carries any `m` through and never 404s on it;
  // a missing one still redirects, as on every /b/[id]/… route (C5).
  await missionParam(building.id, "drill", searchParams, { tolerant: true });
  return <DrillScreen building={building} heistMode={process.env.HEIST_MODE} />;
}
