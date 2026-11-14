import { BuildingScreen } from "@/components/shell/building-screen";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The map while CoStar answers: the same frame as the loaded screen, the
 * tabs and three rows as skeletons at their final height, so nothing moves
 * when the buildings arrive.
 */
export function MapSkeleton() {
  return (
    <div data-testid="map-skeleton" aria-busy="true" aria-label="Loading buildings" className="flex min-h-0 flex-1 flex-col">
      <BuildingScreen
        visualLabel="Map, loading"
        visual={<Skeleton className="absolute inset-0 rounded-none bg-surface-1" />}
        panel={
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-lg font-semibold text-text-1">Pick a building</h1>
              <Skeleton className="mt-2 h-4 w-64" />
            </div>
            <Skeleton className="h-12 w-full" />
            <ul className="flex flex-col">
              {[0, 1, 2].map((row) => (
                <li key={row} data-testid="skeleton-row" className="flex h-16 flex-col justify-center gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-64" />
                </li>
              ))}
            </ul>
          </div>
        }
        action={
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-10 w-full" />
          </div>
        }
      />
    </div>
  );
}
