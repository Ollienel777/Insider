// The fixture-backed CoStar adapter: the five buildings of SPEC §7, read from
// fixtures/costar/buildings.json, and the casting inventory, read from
// fixtures/inventory.json. Both files are parsed when this module loads, so a
// malformed fixture fails at startup, not on screen.
import { z } from "zod";
import { Building, CastingFilter, type City, Inventory, type InventoryProperty } from "@/domain";
import raw from "../../../fixtures/costar/buildings.json";
import inventoryRaw from "../../../fixtures/inventory.json";
import { searchInventory } from "./search";
import type { CoStarAdapter } from "./types";

export const FIXTURE_BUILDINGS: readonly Building[] = Object.freeze(z.array(Building).parse(raw));
export const FIXTURE_INVENTORY: readonly InventoryProperty[] = Object.freeze(Inventory.parse(inventoryRaw));

export function createFakeCoStar(
  buildings: readonly Building[] = FIXTURE_BUILDINGS,
  inventory: readonly InventoryProperty[] = FIXTURE_INVENTORY,
): CoStarAdapter {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  // Callers get copies, so nothing they do can change the fixtures.
  const copy = <T>(value: T): T => structuredClone(value);

  return {
    async listBuildings(city: City) {
      return buildings
        .filter((b) => b.city === city)
        .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))
        .map(copy);
    },
    async getBuilding(id: string) {
      const building = byId.get(id);
      return building ? copy(building) : null;
    },
    async getAvailableSpace(id: string) {
      const building = byId.get(id);
      return building ? copy(building.availableSpace) : null;
    },
    async searchInventory(filters) {
      return searchInventory(inventory, z.array(CastingFilter).parse(filters), "fixture");
    },
  };
}
