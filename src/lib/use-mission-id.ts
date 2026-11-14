// The chosen mission in the current address (`?m=`, issue 119), for client
// screens; a client-only hook, apart from `buildingHref` so server code can
// import that.
import { useSearchParams } from "next/navigation";

/** The `?m=` of the current address; null when there is none, or outside the app router. */
export function useMissionId(): string | null {
  return useSearchParams()?.get("m") || null;
}
