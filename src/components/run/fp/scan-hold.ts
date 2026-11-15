// One live scan per tab, kept across screens (issue 157), so a warm-up before
// the pitch holds: the Plan screen starts the scan loading, the Run screen
// finds it in or on its way, and leaving Run and coming back loads nothing
// twice. The scan stays in this tab's memory, as before (no Cache API, no
// IndexedDB, nothing on disk); it is let go only when a different model is
// opened, when its load failed and it is asked for again, or on `pagehide`.
//
// Generic over what it holds, so it has no three.js in it and the tests can
// hold a stub.

export interface Held {
  /** True once the scan can be walked and drawn; false if it can't be. */
  ready: Promise<boolean>;
  dispose(): void;
}

let held: { modelId: string; handle: Held; failed: boolean } | null = null;
let listening = false;

/** The tab's scan of `modelId`: the one already held, or a new one from `open` (letting the old one go). */
export function holdScan<H extends Held>(modelId: string, open: (modelId: string) => H): H {
  if (held && held.modelId === modelId && !held.failed) return held.handle as H;
  held?.handle.dispose();
  const handle = open(modelId);
  const entry = { modelId, handle, failed: false };
  held = entry;
  // A scan that couldn't load is opened afresh the next time it is asked for.
  void handle.ready.then(
    (ok) => {
      if (!ok) entry.failed = true;
    },
    () => {
      entry.failed = true;
    },
  );
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("pagehide", releaseScan);
  }
  return handle;
}

/** Lets the held scan go. */
export function releaseScan(): void {
  held?.handle.dispose();
  held = null;
}
