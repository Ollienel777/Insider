// A live scan's board, built once per tab (issue 157), so the Run screen
// opens on the floor the Plan screen already read, and Run → Plan → Run
// reads nothing again. Reading a scan's board costs the Showcase SDK's
// connect and its wait for the scan's rooms (#143), about ten seconds; the
// built `FloorGraph` costs nothing to keep.
//
// Memory only, as the rest of a scan's data (SPEC §4.5; Q2 is answered yes):
// nothing goes to storage or the server. One model's board is held at a
// time. It is let go when another model's is read, when its read fails or
// comes back empty, and on `pagehide`. The fixture floors never come here.
import type { FloorGraph } from "@/domain";

let held: { modelId: string; floor: Promise<FloorGraph | null> } | null = null;
let listening = false;

/**
 * The board of scan `modelId`: the one this tab already read (or is reading),
 * or `read()`'s. A read that throws or finds no floor is not kept, so the
 * next screen to ask reads it afresh.
 */
export function holdFloor(modelId: string, read: () => Promise<FloorGraph | null>): Promise<FloorGraph | null> {
  if (held?.modelId === modelId) return held.floor;
  const entry = { modelId, floor: read() };
  held = entry;
  entry.floor.then(
    (floor) => {
      if (!floor && held === entry) held = null;
    },
    () => {
      if (held === entry) held = null;
    },
  );
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("pagehide", releaseFloor);
  }
  return entry.floor;
}

/** Lets the held board go. */
export function releaseFloor(): void {
  held = null;
}
