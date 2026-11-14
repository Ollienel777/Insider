// One building by id, from the CoStar adapter, for the server components of
// a building route. `cache` makes the layout and the page share one lookup
// per request.
import { cache } from "react";
import { getCoStar } from "@/adapters/costar";
import type { Building } from "@/domain";

export const findBuilding = cache(async (id: string): Promise<Building | null> => {
  return getCoStar().adapter.getBuilding(id);
});
