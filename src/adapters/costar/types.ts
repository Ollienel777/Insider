// The one interface every CoStar implementation exports (SPEC §4.5).
import type { AvailableSpace, Building, City } from "@/domain";

export interface CoStarAdapter {
  /** Every building in `city` the game can stage, ordered by id. */
  listBuildings(city: City): Promise<Building[]>;
  /** One building, or `null` when no building has that id. */
  getBuilding(id: string): Promise<Building | null>;
  /** The building's available suites, or `null` when no building has that id. */
  getAvailableSpace(id: string): Promise<AvailableSpace[] | null>;
}
