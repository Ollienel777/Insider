"use client";

// A live scan the level can't be placed on (no entry, no room for the
// objective) falls back to the building's fixture floor, as a failed load
// does (SPEC §2: fake mode is the fallback for every beat; SPEC §7: the chip
// says which service is on fixtures). The Run and Plan screens both place on
// the floor they load, so both go through here.
import { fixtureFloor, unplaceableFallback } from "@/adapters/matterport";
import type { Building, FloorGraph } from "@/domain";
import { PlacementError } from "@/level/placer";
import { reportFallback } from "@/lib/demo-status";

/**
 * `place(floor)`, or, when `floor` is a live scan and the placer can't hold
 * the level on it, `place` on the fixture floor, with the fallback reported so
 * the chip and a toast say so. Any other error is thrown as it was. Null when
 * the building has no fixture floor either.
 */
export async function placeOrFixture<T>(
  building: Pick<Building, "id" | "matterportModelId">,
  floor: FloorGraph,
  place: (floor: FloorGraph) => T,
  report: typeof reportFallback = reportFallback,
): Promise<T | null> {
  try {
    return place(floor);
  } catch (error) {
    if (floor.source !== "matterport" || !(error instanceof PlacementError)) throw error;
    console.warn(`Matterport: the scan can't hold the level, so the board uses the fixture floor (${error.message})`);
    report(unplaceableFallback(building.id));
    const fixture = await fixtureFloor(building);
    return fixture ? place(fixture) : null;
  }
}
