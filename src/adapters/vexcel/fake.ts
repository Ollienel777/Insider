// The fixture-backed Vexcel adapter: one massing per fixture building (SPEC
// §7), read from fixtures/vexcel/F*.json. A massing has no imagery: the Scout
// screen draws it from the footprint and height, and the hand-placed entries
// are anchored in space. Each file is parsed against `Aerial` when this
// module loads, so a malformed fixture fails at startup, not on screen.
import { Aerial } from "@/domain";
import F1 from "../../../fixtures/vexcel/F1.json";
import F2 from "../../../fixtures/vexcel/F2.json";
import F3 from "../../../fixtures/vexcel/F3.json";
import F4 from "../../../fixtures/vexcel/F4.json";
import F5 from "../../../fixtures/vexcel/F5.json";
import type { VexcelAdapter } from "./types";

const RAW: Record<string, unknown> = { F1, F2, F3, F4, F5 };

/** The fixture aerials, by building id. */
export const FIXTURE_AERIALS: ReadonlyMap<string, Aerial> = new Map(
  Object.entries(RAW).map(([id, raw]) => [id, Object.freeze(Aerial.parse(raw))]),
);

/** Where a fixture building stands: the mean of its footprint's corners. */
export function fixtureLocation(buildingId: string): { lat: number; lng: number } | null {
  const aerial = FIXTURE_AERIALS.get(buildingId);
  if (!aerial) return null;
  const n = aerial.footprint.length;
  const lng = aerial.footprint.reduce((sum, [x]) => sum + x, 0) / n;
  const lat = aerial.footprint.reduce((sum, [, y]) => sum + y, 0) / n;
  return { lat, lng };
}

export function createFakeVexcel(aerials: ReadonlyMap<string, Aerial> = FIXTURE_AERIALS): VexcelAdapter {
  return {
    async getAerial(buildingId: string) {
      const aerial = aerials.get(buildingId);
      // Callers get a copy, so nothing they do can change the fixtures.
      return aerial ? structuredClone(aerial) : null;
    },
    // A massing has no imagery to proxy.
    async getImage() {
      return null;
    },
  };
}
