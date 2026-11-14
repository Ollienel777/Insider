import { notFound } from "next/navigation";
import { readCachedLevel } from "@/agents/builder/cache";
import { OwnerScreen } from "@/components/owner/owner-screen";
import { findBuilding } from "@/lib/building";
import { missionParam, type SearchParams } from "@/lib/mission-param";

// The Owner screen (Owner Mode, SPEC §13, issue 128). The cached manifest comes
// with the page; the floor loads in the browser, where the owner's setup is
// edited, kept and played (SPEC §4.5). Only the building's id ever reaches
// the server's crew and Chief routes, with a summary in zone ids.
export default async function OwnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();
  const missionId = await missionParam(building.id, "owner", searchParams);
  const cached = await readCachedLevel(building.id, missionId);
  return (
    <OwnerScreen
      building={{ id: building.id, name: building.name, matterportModelId: building.matterportModelId }}
      manifest={cached?.manifest ?? null}
      fixture={building.source === "fixture"}
      mission={missionId}
      heistMode={process.env.HEIST_MODE}
    />
  );
}
