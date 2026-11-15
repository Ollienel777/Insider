// A live scan's board, built once per tab (issue 157), so the Run screen
// opens on the floor the Plan screen already read, and Run → Plan → Run
// reads nothing again. Reading a scan's board costs the Showcase SDK's
// connect and its wait for the scan's rooms (#143), about ten seconds; the
// built `FloorGraph` costs nothing to keep.
//
// Memory only, as the rest of a scan's data (SPEC §4.5; Q2 is answered yes):
// nothing goes to storage or the server. One model's board is held at a
// time. It is let go, and a read still under way stopped, when another
// model's is read, when its read fails or comes back empty, when the stand-in
// floor plan is taken (`releaseFloor`), and on `pagehide`. The fixture floors
// never come here.
//
// The read belongs to the holder, not to the screen that started it: a screen
// that stops waiting (its `signal` aborts as it closes) stops waiting only,
// and the next screen takes the read where it is. The read's own deadlines
// (live.ts, #159: only time with the page showing counts) are untouched.
import type { FloorGraph } from "@/domain";

let held: { modelId: string; floor: Promise<FloorGraph | null>; stop: AbortController } | null = null;
let listening = false;

const aborted = (signal: AbortSignal): unknown => signal.reason ?? new DOMException("The load was given up on", "AbortError");

/** `floor`, or a rejection as soon as `signal` aborts: the caller stops waiting, the read goes on. */
function waitFor(floor: Promise<FloorGraph | null>, signal?: AbortSignal): Promise<FloorGraph | null> {
  if (!signal) return floor;
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    floor.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * The board of scan `modelId`: the one this tab already read (or is reading),
 * or `read()`'s, which runs with the holder's own signal. A read that throws
 * or finds no floor is not kept, so the next screen to ask reads it afresh.
 * `signal` is the caller's: it ends the caller's wait, never the read.
 */
export function holdFloor(
  modelId: string,
  read: (signal: AbortSignal) => Promise<FloorGraph | null>,
  signal?: AbortSignal,
): Promise<FloorGraph | null> {
  let entry = held;
  if (entry?.modelId !== modelId) {
    held?.stop.abort();
    const stop = new AbortController();
    const fresh = { modelId, floor: read(stop.signal), stop };
    held = fresh;
    entry = fresh;
    fresh.floor.then(
      (floor) => {
        if (!floor && held === fresh) held = null;
      },
      () => {
        if (held === fresh) held = null;
      },
    );
    if (!listening && typeof window !== "undefined") {
      listening = true;
      window.addEventListener("pagehide", releaseFloor);
    }
  }
  return waitFor(entry.floor, signal);
}

/** Lets the held board go, and stops its read if it is still under way. */
export function releaseFloor(): void {
  held?.stop.abort();
  held = null;
}
