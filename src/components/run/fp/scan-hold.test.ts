// The tab's one live scan (issue 157), with a stub in place of the renderer:
// asked for again by a remounted screen, it is the same scan; a different
// model lets the old one go; a failed load is opened afresh; `pagehide` lets
// it go.
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdScan, releaseScan, type Held } from "./scan-hold";

function stubs() {
  const opened: { modelId: string; disposed: boolean }[] = [];
  const open = (ok = true) =>
    vi.fn((modelId: string): Held & { modelId: string } => {
      const record = { modelId, disposed: false };
      opened.push(record);
      return {
        modelId,
        ready: Promise.resolve(ok),
        dispose: () => {
          record.disposed = true;
        },
      };
    });
  return { opened, open };
}

afterEach(() => releaseScan());

describe("the tab's live scan", () => {
  it("is the same scan when a screen asks for it again, as Plan and then Run do, or Run after a trip home", () => {
    const { opened, open } = stubs();
    const load = open();
    const first = holdScan("mOdel1", load);
    // Run unmounts (nothing is let go), the player goes home, comes back through Plan to Run.
    const again = holdScan("mOdel1", load);
    const atRun = holdScan("mOdel1", load);
    expect(again).toBe(first);
    expect(atRun).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    expect(opened.map((o) => o.disposed)).toEqual([false]);
  });

  it("lets the old scan go when a different model is opened", () => {
    const { opened, open } = stubs();
    const load = open();
    const first = holdScan("mOdel1", load);
    const second = holdScan("mOdel2", load);
    expect(second).not.toBe(first);
    expect(opened).toEqual([
      { modelId: "mOdel1", disposed: true },
      { modelId: "mOdel2", disposed: false },
    ]);
  });

  it("opens a scan afresh after its load failed", async () => {
    const { opened, open } = stubs();
    const failing = open(false);
    const first = holdScan("mOdel1", failing);
    await first.ready;
    await Promise.resolve();
    const retry = holdScan("mOdel1", open());
    expect(retry).not.toBe(first);
    expect(opened.map((o) => o.disposed)).toEqual([true, false]);
  });

  it("lets the scan go when the page is left", () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("window", { addEventListener: (type: string, listener: () => void) => listeners.set(type, listener) });
    try {
      const { opened, open } = stubs();
      holdScan("mOdel1", open());
      listeners.get("pagehide")?.();
      expect(opened[0].disposed).toBe(true);
      // The next screen to ask opens it again.
      holdScan("mOdel1", open());
      expect(opened).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
