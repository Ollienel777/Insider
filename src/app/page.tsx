import { Suspense } from "react";
import { getCoStar } from "@/adapters/costar";
import { MapError } from "@/components/map/map-error";
import { MapScreen } from "@/components/map/map-screen";
import { MapSkeleton } from "@/components/map/map-skeleton";
import { toMapBuilding } from "@/components/map/types";
import { AppShell } from "@/components/shell/app-shell";
import { City } from "@/domain";
import { buildingsWithLevel } from "@/lib/levels";

// The map (SPEC §2 beat 1): every city's buildings from the CoStar adapter,
// pinned on a static basemap. The skeleton shows while CoStar answers.
export default async function Home({ searchParams }: { searchParams: Promise<{ city?: string | string[] }> }) {
  const { city } = await searchParams;
  const parsed = City.safeParse(city);
  return (
    <AppShell>
      <Suspense fallback={<MapSkeleton />}>
        <MapData initialCity={parsed.success ? parsed.data : "LA"} />
      </Suspense>
    </AppShell>
  );
}

async function MapData({ initialCity }: { initialCity: City }) {
  const { adapter } = getCoStar();
  let buildings;
  try {
    buildings = (await Promise.all(City.options.map((c) => adapter.listBuildings(c)))).flat();
  } catch (error) {
    return <MapError message={error instanceof Error ? error.message : String(error)} />;
  }
  const ready = buildingsWithLevel();
  return <MapScreen buildings={buildings.map((b) => toMapBuilding(b, ready.has(b.id)))} initialCity={initialCity} />;
}
