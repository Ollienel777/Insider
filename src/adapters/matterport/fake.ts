// The fixture-backed Matterport adapter: hand-authored floors, one per
// building, read from fixtures/floors/. Each file is parsed against
// `FloorGraph` when this module loads, so a malformed fixture fails at
// startup, not on the board.
//
// The floors are fiction: no Matterport scan data is involved, so SPEC §4.5's
// terms stance (browser only, never persisted) does not apply to them.
import { FloorGraph } from "@/domain";
import f1 from "../../../fixtures/floors/F1.json";
import type { MatterportAdapter } from "./types";

/** Building id → its fixture floor. F2–F5 floors are later tickets. */
export const FIXTURE_FLOORS: Readonly<Record<string, FloorGraph>> = Object.freeze({
  F1: FloorGraph.parse(f1),
});

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

export function createFakeMatterport(
  floors: Readonly<Record<string, FloorGraph>> = FIXTURE_FLOORS,
): MatterportAdapter {
  return {
    async loadFloor(building) {
      const floor = Object.hasOwn(floors, building.id) ? floors[building.id] : undefined;
      // Callers get a copy, so nothing they do can change the fixture.
      return floor ? structuredClone(floor) : null;
    },
  };
}
