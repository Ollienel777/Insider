// The fixture-backed Matterport adapter: hand-authored floors, one per
// building, listed in src/lib/fixture-floors.ts. Each file is parsed against
// `FloorGraph` when this module loads, so a malformed fixture fails at
// startup, not on the board.
//
// The floors are fiction: no Matterport scan data is involved, so SPEC §4.5's
// terms stance (browser only, never persisted) does not apply to them.
import { FloorGraph } from "@/domain";
import { FLOOR_FIXTURES } from "@/lib/fixture-floors";
import type { MatterportAdapter } from "./types";

/** Building id → its fixture floor. F4 and F5 floors are a later ticket (#40). */
export const FIXTURE_FLOORS: Readonly<Record<string, FloorGraph>> = Object.freeze(
  Object.fromEntries(Object.entries(FLOOR_FIXTURES).map(([id, raw]) => [id, FloorGraph.parse(raw)])),
);

/**
 * Named places on F1's floor 22 that the demo path relies on (SPEC §2, beats
 * 4 and 5). The placer and the fake crew may use these ids; the fixture tests
 * hold the properties stated here.
 */
export const F1_DEMO = Object.freeze({
  /** The freight lift car: the dock entry (the Vexcel dock tag reaches 22 by the freight lift). */
  dockEntry: "fl-car",
  /** The east stair landing: the roof entry (the Vexcel roof tag reaches 22 by the east stair). */
  roofEntry: "es-landing",
  /** "Wait one turn at the freight lift": next to the entry, outside C2's cover. */
  freightLiftWait: "fl-lobby",
  /**
   * Camera C2's cover: the dock corridor short of the records door. Its
   * nearest node is 2 moves from the dock entry and visible from it. The
   * corridor's east end, `dc-east`, is left uncovered: the records door is
   * picked from there (the placer keeps cameras off pick nodes).
   */
  c2Cover: Object.freeze(["dc-west", "dc-mid"]),
  /** The objective: the records room's file stacks, behind the lockable records door. */
  objective: "rr-files",
  /** The records room door, the one the Chief locks in beat 5. */
  recordsDoor: "d-records-room",
});

/**
 * The fixture floor a CoStar kit building plays on when its scan is not the
 * board (#95): in fake mode, when the live load fails, or when the scan can't
 * hold the level. Kit ids are integers and fixture ids are `F1`…, so the two
 * never collide. A kit building's level is built from its own record and
 * placed on this floor as on any other; the Run labels it a stand-in.
 */
export const STAND_IN_FLOOR = "F1";
const isKitId = (id: string): boolean => /^\d+$/.test(id);

export function createFakeMatterport(
  floors: Readonly<Record<string, FloorGraph>> = FIXTURE_FLOORS,
): MatterportAdapter {
  return {
    async loadFloor(building) {
      const id = Object.hasOwn(floors, building.id) ? building.id : isKitId(building.id) ? STAND_IN_FLOOR : undefined;
      const floor = id !== undefined && Object.hasOwn(floors, id) ? floors[id] : undefined;
      // Callers get a copy, so nothing they do can change the fixture.
      return floor ? structuredClone(floor) : null;
    },
  };
}
