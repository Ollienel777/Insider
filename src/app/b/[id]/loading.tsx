import { BuildingScreen } from "@/components/shell/building-screen";
import { Skeleton } from "@/components/ui/skeleton";

// A building screen while its server work (the building, the cached level)
// is under way: the two-column frame, with placeholders shaped like the
// visual and the panel, inside the shell.
export default function BuildingLoading() {
  return (
    <BuildingScreen
      visualLabel="Loading"
      visual={
        <div data-testid="building-loading" role="status" aria-label="Loading" className="flex h-full flex-col gap-3 p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="min-h-0 flex-1" />
        </div>
      }
      panel={
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      }
      action={<Skeleton className="h-10" />}
    />
  );
}
