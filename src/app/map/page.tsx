import { Suspense } from "react";
import { getCoStar } from "@/adapters/costar";
import { MapError } from "@/components/map/map-error";
import { MapScreen } from "@/components/map/map-screen";
import { MapSkeleton } from "@/components/map/map-skeleton";
import { toMapBuilding } from "@/components/map/types";
import { AppShell } from "@/components/shell/app-shell";
import { FallbackReport } from "@/components/shell/demo-safety";
import { City } from "@/domain";
import { forcedServices } from "@/lib/forced-server";
import { buildingsWithLevel } from "@/lib/levels";

// The map of every prepared building (#10): each city's buildings from the
// CoStar adapter, pinned on a static basemap. It opened the old demo at `/`;
// SPEC §2 now opens on the mission picker and reuses this map on the cast
// screen, so the full map lives here, off the demo path. The skeleton shows
// while CoStar answers. A live CoStar failure is answered by the fixtures,
// and reported to the chip. The open city tab is `?city=`, read in the
// browser by the map itself.
export default function MapPage() {
  return (
    <AppShell>
      <Suspense fallback={<MapSkeleton />}>
        <MapData />
      </Suspense>
    </AppShell>
  );
}

async function MapData() {
  const forced = (await forcedServices()).has("costar");
  const { adapter } = getCoStar({ forced });
  let buildings;
  try {
    buildings = (await Promise.all(City.options.map((c) => adapter.listBuildings(c)))).flat();
  } catch (error) {
    return <MapError message={error instanceof Error ? error.message : String(error)} />;
  }
  const ready = buildingsWithLevel();
  return (
    <>
      <FallbackReport fallback={getCoStar({ forced }).fallback} />
      <MapScreen buildings={buildings.map((b) => toMapBuilding(b, ready.has(b.id)))} defaultCity="LA" />
    </>
  );
}
