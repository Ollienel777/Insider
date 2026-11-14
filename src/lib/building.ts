// One building by id, from the CoStar adapter, for the server components of
// a building route. `cache` makes the layout and the page share one lookup
// per request. CoStar forced to fixtures in the demo settings answers from
// the fixtures.
import { cache } from "react";
import { getCoStar } from "@/adapters/costar";
import type { Building } from "@/domain";
import { forcedServices } from "./forced-server";

export const findBuilding = cache(async (id: string): Promise<Building | null> => {
  const forced = (await forcedServices()).has("costar");
  return getCoStar({ forced }).adapter.getBuilding(id);
});
