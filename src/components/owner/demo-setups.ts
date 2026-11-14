// The prepared demo pair for Owner Mode's compare beat (issue 31, SPEC §13
// step 4): a made-up night shift on the F1 fixture building, and the same
// shift with one camera moved. Nothing here describes a real building: F1 is a
// fixture, and the setup is invented for the demo and says so on screen.
//
// Both are ordinary owner setups, every element the owner's: the editor loads
// them, the batch plays them, and the compare reads them like any saved setup.
// On the recorded strategies they give 7 of 50 out and then 1 of 50, the same
// on every run (owner.test.tsx pins both).
import { OWNER_SETUP_VERSION, type OwnerSetup } from "@/domain/owner-setup";

export interface DemoSetup {
  setup: OwnerSetup;
  /** What the setup is, in a line, for the editor's list. */
  note: string;
}

/** The night shift: four guards, two cameras, both key-locked doors, and a staffed desk in the elevator lobby. */
const NIGHT_SHIFT: OwnerSetup = {
  version: OWNER_SETUP_VERSION,
  name: "Demo: night shift",
  buildingId: "F1",
  guards: [
    { id: "G1", post: "mc-w", round: ["mc-w", "mc-1", "mc-2", "mc-1"], tempo: 1 },
    { id: "G2", post: "mc-3", round: ["mc-3", "mc-4", "mc-e", "mc-4"], tempo: 1 },
    { id: "G3", post: "ws-landing", round: [], tempo: 1 },
    { id: "G4", post: "el-south", round: [], tempo: 1 },
  ],
  cameras: [
    { id: "C1", node: "mc-e", kind: "sweeping", facing: "sw" },
    // Over the freight lift lobby, facing south: it watches the lobby floor alone.
    { id: "C2", node: "fl-lobby", kind: "sweeping", facing: "s" },
  ],
  doors: { "d-records-room": "key", "d-server-closet": "key" },
  desks: ["el-north"],
  cleaners: [],
};

/** The one change: C2 moves one step, into the dock corridor, where it sees the corridor, the lobby and the lift. */
const C2_MOVED: OwnerSetup = {
  ...NIGHT_SHIFT,
  name: "Demo: night shift, C2 moved",
  cameras: NIGHT_SHIFT.cameras.map((c) => (c.id === "C2" ? { ...c, node: "dc-west" } : c)),
};

const DEMO: Readonly<Record<string, readonly DemoSetup[]>> = {
  F1: [
    { setup: NIGHT_SHIFT, note: "Made up for the demo. Four guards, two cameras, a desk in the elevator lobby." },
    { setup: C2_MOVED, note: "The same night shift with C2 moved from the freight lift lobby into the dock corridor." },
  ],
};

/** The prepared setups for `buildingId`: F1's demo pair, none elsewhere. */
export function demoSetups(buildingId: string): readonly DemoSetup[] {
  return DEMO[buildingId] ?? [];
}

/** True when `setup` is one of the prepared setups, unchanged (its name included). */
export function isDemoSetup(setup: OwnerSetup): boolean {
  const json = JSON.stringify(setup);
  return demoSetups(setup.buildingId).some((d) => JSON.stringify(d.setup) === json);
}
