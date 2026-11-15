// A live scan's board, read once per tab (issue 157), with a stub in place of
// the Showcase SDK's read: Plan reads it and Run takes it; another model's
// read lets it go; a failed or empty read is not kept; `pagehide` lets it go.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorGraph } from "@/domain";
import { holdFloor, releaseFloor } from "./floor-hold";

const board = (tag: string) => ({ source: "matterport", nodes: [], edges: [], rooms: [], sightlines: {}, tag }) as unknown as FloorGraph;

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

  it("hands a screen that asks while the read is on its way the same read", async () => {
    let finish: (floor: FloorGraph) => void = () => {};
    const read = vi.fn(() => new Promise<FloorGraph | null>((resolve) => (finish = resolve)));
    const atPlan = holdFloor("mOdel1", read);
    const atRun = holdFloor("mOdel1", read);
    finish(board("one"));
    expect(await atRun).toBe(await atPlan);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads another model's board afresh, and lets the first one go", async () => {
    const read = vi.fn(async () => board("x"));
    await holdFloor("mOdel1", read);
    await holdFloor("mOdel2", read);
    await holdFloor("mOdel1", read);
    expect(read).toHaveBeenCalledTimes(3);
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
