import { notFound } from "next/navigation";
import { readCachedLevel, type CachedLevel } from "@/agents/builder/cache";
import { dataToLevelRows } from "@/components/dossier/data-to-level";
import { DossierScreen } from "@/components/dossier/dossier-screen";
import { DossierUnavailable } from "@/components/dossier/dossier-unavailable";
import { dossierFacts } from "@/components/dossier/facts";
import { findBuilding } from "@/lib/building";
import { cityName } from "@/lib/cities";

// The Dossier (SPEC §2 beat 3): the cached level and its recorded trace,
// read straight from data/levels/ (what GET /api/levels/[id] serves), so
// this beat never waits on a model.
export default async function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const building = await findBuilding(id);
  if (!building) notFound();

  let level: CachedLevel | null;
  try {
    level = await readCachedLevel(building.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return <DossierUnavailable buildingId={building.id} name={building.name} reason="invalid" detail={message} />;
  }
  if (!level) return <DossierUnavailable buildingId={building.id} name={building.name} reason="missing" />;

  return (
    <DossierScreen
      buildingId={building.id}
      name={building.name}
      place={`${building.neighbourhood}, ${cityName(building.city)}`}
      facts={dossierFacts(building)}
      rows={dataToLevelRows(level.manifest)}
      mission={level.manifest.mission}
      trace={level.trace}
    />
  );
}
