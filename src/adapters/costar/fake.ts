// The fixture-backed CoStar adapter: the five buildings of SPEC §7, read from
// fixtures/costar/buildings.json. The file is parsed against `Building` when
// this module loads, so a malformed fixture fails at startup, not on screen.
import { z } from "zod";
import { Building, type City } from "@/domain";
import raw from "../../../fixtures/costar/buildings.json";
import type { CoStarAdapter } from "./types";

export const FIXTURE_BUILDINGS: readonly Building[] = Object.freeze(z.array(Building).parse(raw));

export interface FakeCoStarOptions {
  /**
   * Tests only: every call rejects with this message, so the map's error
   * state can be rendered (#154). Ignored unless NODE_ENV is `test`: a Next.js
   * build inlines `production`, and nothing a request carries reaches it.
   */
  failWith?: string;
}

export function createFakeCoStar(
  buildings: readonly Building[] = FIXTURE_BUILDINGS,
  { failWith }: FakeCoStarOptions = {},
): CoStarAdapter {
  if (failWith && process.env.NODE_ENV === "test") return failingCoStar(failWith);
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
  };
}

function failingCoStar(message: string): CoStarAdapter {
  const fail = async (): Promise<never> => {
    throw new Error(message);
  };
  return { listBuildings: fail, getBuilding: fail, getAvailableSpace: fail };
}
