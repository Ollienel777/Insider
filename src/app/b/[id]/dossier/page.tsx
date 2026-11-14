import { notFound } from "next/navigation";
import type { CachedLevel } from "@/agents/builder/cache";
import { buildState, buildsOnDemand, canBuildFor, levelFor } from "@/agents/builder/live-levels";
import { findMission, missionsFor } from "@/agents/builder/missions";
import { dataToLevelRows } from "@/components/dossier/data-to-level";
import { DossierScreen } from "@/components/dossier/dossier-screen";
import { DossierUnavailable } from "@/components/dossier/dossier-unavailable";
import { dossierFacts } from "@/components/dossier/facts";
import { MODEL_FIXTURES_NOTE, MODEL_FORCED_NOTE } from "@/components/shell/steps";
import { findBuilding } from "@/lib/building";
import { configuredModes } from "@/lib/mode";
import { forcedServices } from "@/lib/forced-server";
import { castFinalist } from "@/lib/cast-because";
import { optionalMissionParam, type SearchParams } from "@/lib/mission-param";
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

  const missionId = await optionalMissionParam(building.id, "dossier", searchParams);
  // A kit building's level is built on demand (#93): it offers its city's missions, then the build.
  const onDemand = buildsOnDemand(building);
  // The build route refuses while the model is on fixtures, configured or forced in the demo settings.
  const modelForced = onDemand && (await forcedServices()).has("llm");
  const modelLive = configuredModes(process.env).llm === "live" && !modelForced;
  const missions = onDemand ? missionsFor(building.city).map(({ id, title }) => ({ id, title })) : undefined;
  const state = onDemand && missionId ? buildState(building.id, missionId) : null;
  const kitProps = {
    missions,
    buildable: Boolean(onDemand && missionId && canBuildFor(building, missionId) && modelLive),
    unbuildable:
      onDemand && missionId
        ? !canBuildFor(building, missionId)
          ? "That mission is not staged in this building's city. Pick one below."
          : modelForced
            ? MODEL_FORCED_NOTE
            : !modelLive
              ? MODEL_FIXTURES_NOTE
              : undefined
        : undefined,
    buildError: state?.status === "failed" ? state.error : undefined,
    building: state?.status === "building",
  };
  // No mission (a kit building from the map): no level to read, only its facts and its missions.
  if (!missionId) return <DossierUnavailable buildingId={building.id} missionId={null} name={building.name} reason="missing" facts={dossierFacts(building)} source={building.source} {...kitProps} />;

  let level: CachedLevel | null;
  try {
    level = await levelFor(building, missionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return <DossierUnavailable buildingId={building.id} missionId={missionId} name={building.name} reason="invalid" detail={message} source={building.source} />;
  }
  if (!level) return <DossierUnavailable buildingId={building.id} missionId={missionId} name={building.name} reason="missing" facts={dossierFacts(building)} source={building.source} {...kitProps} />;

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
