// The hand-authored floor fixtures, one per building, as their raw JSON. The
// Matterport fake parses them into FIXTURE_FLOORS (the floors the board can
// load), and src/lib/levels.ts reads the same keys to say which buildings
// have a level, so the two cannot drift apart.
//
// This module sits outside the Matterport adapter because the adapter may be
// imported only from client modules (SPEC §4.5), and the map page that reads
// level readiness is a server component. The floors are fiction, not scan
// data, so serving them from the server is within that rule's intent.
// F4 and F5 floors are a later ticket (#40): add each file here.
import f1 from "../../fixtures/floors/F1.json";
import f2 from "../../fixtures/floors/F2.json";
import f3 from "../../fixtures/floors/F3.json";

/** Building id → its floor fixture, unparsed. */
export const FLOOR_FIXTURES: Readonly<Record<string, unknown>> = Object.freeze({
  F1: f1,
  F2: f2,
  F3: f3,
});
