// Which buildings have a playable level yet (spec review R1-M1).
//
// A level needs a board, and a board is a floor. The floors the board can
// load are the Matterport fake's FIXTURE_FLOORS, parsed from FLOOR_FIXTURES;
// this reads the same registry (the adapter itself is client only), so a pin
// is never enabled for a floor the board cannot open. Until the F2–F5 floor
// tickets land only F1 has one, and the map marks every other pin "level in
// prep". When the cached manifests arrive (data/levels/, the Level Builder
// ticket), this is the one place to also require one.
import { FLOOR_FIXTURES } from "@/lib/fixture-floors";

/** Ids of the buildings with a loadable floor. */
export function buildingsWithLevel(floors: Readonly<Record<string, unknown>> = FLOOR_FIXTURES): Set<string> {
  return new Set(Object.keys(floors));
}
