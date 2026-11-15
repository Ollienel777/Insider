import { notFound } from "next/navigation";
import { levelFor } from "@/agents/builder/live-levels";
import { OwnerScreen } from "@/components/owner/owner-screen";
import { findBuilding } from "@/lib/building";
import { missionParam, type SearchParams } from "@/lib/mission-param";
import { showcaseMission } from "@/lib/showcase";

// The Owner screen (Owner Mode, SPEC §13, issue 128). The cached manifest comes
// with the page (a kit building's from the server's memory, #93); the floor
// loads in the browser, where the owner's setup is edited, kept and played
// (SPEC §4.5). Only the building's id ever reaches the server's crew and Chief
// routes, with a summary in zone ids. It runs on the fixture buildings and on
// the showcase's kit buildings (issue 205), never on any other kit building.
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
  const scope = building.source === "fixture" ? "fixture" : showcaseMission(building.id) === missionId ? "showcase" : null;
  const cached = scope ? await levelFor(building, missionId) : null;
  return (
    <OwnerScreen
      building={{ id: building.id, name: building.name, matterportModelId: building.matterportModelId }}
      manifest={cached?.manifest ?? null}
      scope={scope}
      mission={missionId}
      heistMode={process.env.HEIST_MODE}
    />
  );
}
