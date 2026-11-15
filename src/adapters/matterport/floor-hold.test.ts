// A live scan's board, read once per tab (issue 157), with a stub in place of
// the Showcase SDK's read: Plan reads it and Run takes it; a screen that stops
// waiting doesn't stop the read; another model's read lets it go; a failed or
// empty read is not kept; the stand-in floor plan and `pagehide` let it go.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorGraph } from "@/domain";
import { holdFloor, releaseFloor } from "./floor-hold";

const board = (tag: string) => ({ source: "matterport", nodes: [], edges: [], rooms: [], sightlines: {}, tag }) as unknown as FloorGraph;

/** A read that finishes when told to, and remembers the signal it was given. */
function slowRead() {
  let finish: (floor: FloorGraph | null) => void = () => {};
  const signals: AbortSignal[] = [];
  const read = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<FloorGraph | null>((resolve) => (finish = resolve));
  });
  return { read, signals, finish: (floor: FloorGraph | null) => finish(floor) };
}

afterEach(() => releaseFloor());

describe("a live scan's board, kept for the tab", () => {
  it("is read once: Plan reads it, Run takes it, and Run after a trip to Plan takes it again", async () => {
    const read = vi.fn(async () => board("one"));
    const atPlan = await holdFloor("mOdel1", read);
    const atRun = await holdFloor("mOdel1", read);
    const again = await holdFloor("mOdel1", read);
    expect(atRun).toBe(atPlan);
    expect(again).toBe(atPlan);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("goes on reading when the screen that started it stops waiting, and the next screen takes it", async () => {
    const { read, signals, finish } = slowRead();
    const leaving = new AbortController();
    const atPlan = holdFloor("mOdel1", read, leaving.signal);
    // Plan closes before the board is in: its wait ends, the read does not.
    leaving.abort();
    await expect(atPlan).rejects.toBeDefined();
    expect(signals[0].aborted).toBe(false);
    const atRun = holdFloor("mOdel1", read, new AbortController().signal);
    finish(board("one"));
    expect(await atRun).toEqual(board("one"));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads another model's board afresh, stopping the first one's read", () => {
    const { read, signals } = slowRead();
    void holdFloor("mOdel1", read);
    void holdFloor("mOdel2", read);
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
  });

  it("keeps no read that failed or found no floor", async () => {
    const failing = vi.fn(async (): Promise<FloorGraph | null> => {
      throw new Error("the player did not load");
    });
    await expect(holdFloor("mOdel1", failing)).rejects.toThrow();
    const empty = vi.fn(async () => null);
    expect(await holdFloor("mOdel1", empty)).toBeNull();
    const good = vi.fn(async () => board("one"));
    expect(await holdFloor("mOdel1", good)).toEqual(board("one"));
    expect([failing, empty, good].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("lets the board go, and stops its read, when the stand-in floor plan is taken", async () => {
    const { read, signals } = slowRead();
    void holdFloor("mOdel1", read);
    releaseFloor();
    expect(signals[0].aborted).toBe(true);
    const next = vi.fn(async () => board("two"));
    expect(await holdFloor("mOdel1", next)).toEqual(board("two"));
  });

  it("lets the board go when the page is left", async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("window", { addEventListener: (type: string, listener: () => void) => listeners.set(type, listener) });
    try {
      const read = vi.fn(async () => board("one"));
      await holdFloor("mOdel1", read);
      listeners.get("pagehide")?.();
      await holdFloor("mOdel1", read);
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
