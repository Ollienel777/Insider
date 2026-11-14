import { notFound } from "next/navigation";
import { readCachedLevel, type CachedLevel } from "@/agents/builder/cache";
import { findMission } from "@/agents/builder/missions";
import { dataToLevelRows } from "@/components/dossier/data-to-level";
import { DossierScreen } from "@/components/dossier/dossier-screen";
import { DossierUnavailable } from "@/components/dossier/dossier-unavailable";
import { dossierFacts } from "@/components/dossier/facts";
import { findBuilding } from "@/lib/building";
import { castFinalist } from "@/lib/cast-because";
import { missionParam, type SearchParams } from "@/lib/mission-param";
import { cityName } from "@/lib/cities";

// The Dossier (SPEC §2 beat 4): the cached level for the building and the
// chosen mission (`?m=`) and its recorded trace, read straight from
// data/levels/ (what GET /api/levels/[id]?m=… serves), so this beat never
// waits on a model.
export default async function DossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();

  const missionId = await missionParam(building.id, "dossier", searchParams);

  let level: CachedLevel | null;
  try {
    level = await readCachedLevel(building.id, missionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return <DossierUnavailable buildingId={building.id} missionId={missionId} name={building.name} reason="invalid" detail={message} />;
  }
  if (!level) return <DossierUnavailable buildingId={building.id} missionId={missionId} name={building.name} reason="missing" />;

  // Why this building was cast for the mission: the table's first row (beat 4).
  const mission = findMission(level.manifest.missionId);
  // castFinalist never throws on a bad shortlist; anything else it throws drops the row, not the page.
  const finalist = mission
    ? await castFinalist(mission, building.id).catch((error: unknown) => {
        console.error(`dossier: casting ${building.id} for ${mission.id} failed; dropping the cast-because row:`, error);
        return null;
      })
    : null;
  const cast = mission && finalist ? { candidate: finalist.candidate, mission, derived: finalist.source === "derived" } : null;

  return (
    <DossierScreen
      buildingId={building.id}
      name={building.name}
      place={`${building.neighbourhood}, ${cityName(building.city)}`}
      facts={dossierFacts(building)}
      rows={dataToLevelRows(level.manifest, cast)}
      mission={level.manifest.mission}
      trace={level.trace}
    />
  );
}
