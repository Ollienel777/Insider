// The Run screen's view choice (issue 115): one per browser, the board unless
// first person was chosen, and never an error when storage is blocked.
import { describe, expect, it } from "vitest";
import type { FloorGraph } from "@/domain";
import { firstPersonOffered, firstPersonOn, SCAN_NO_MESH, scanStageOf, type ScanHandle, type ScanPreload } from "./run-view";
import { DEFAULT_RUN_VIEW, loadRunView, RUN_VIEW_KEY, saveRunView, type RunViewState } from "./view-store";

function memory(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

const blocked = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("the Run screen's view choice", () => {
  it("is first person until the board is chosen (issue 166)", () => {
    expect(DEFAULT_RUN_VIEW).toBe("first-person");
    expect(loadRunView(memory())).toBe("first-person");
  });

  it("remembers first person, and the board again after", () => {
    const storage = memory();
    saveRunView("first-person", storage);
    expect(storage.map.get(RUN_VIEW_KEY)).toBe("first-person");
    expect(loadRunView(storage)).toBe("first-person");
    saveRunView("board", storage);
    expect(loadRunView(storage)).toBe("board");
  });

  it("reads anything else in storage as first person", () => {
    const storage = memory();
    storage.setItem(RUN_VIEW_KEY, "isometric");
    expect(loadRunView(storage)).toBe("first-person");
  });

  it("is first person, without an error, when storage is blocked", () => {
    expect(loadRunView(blocked)).toBe("first-person");
    expect(() => saveRunView("first-person", blocked)).not.toThrow();
  });
});

describe("whether the Run screen shows first person", () => {
  const state = (view: RunViewState["view"]): RunViewState => ({ view, choose: () => {}, unavailable: false, reason: null, fail: () => {} });
  const floor = (source: FloorGraph["source"]) => ({ source }) as FloorGraph;
  const loading: ScanPreload = { handle: null, failed: null, ready: false };
  const failed: ScanPreload = { handle: null, failed: "No mesh for this scan.", ready: false };

  it("shows it on a fixture floor once chosen", () => {
    expect(firstPersonOn(state("first-person"), floor("fixture"))).toBe(true);
    expect(firstPersonOn(state("board"), floor("fixture"))).toBe(false);
  });

  it("shows it on a floor from a live scan only while the scan's mesh is loading or in", () => {
    expect(firstPersonOn(state("first-person"), floor("matterport"))).toBe(false);
    expect(firstPersonOn(state("first-person"), floor("matterport"), null)).toBe(false);
    expect(firstPersonOn(state("first-person"), floor("matterport"), loading)).toBe(true);
    expect(firstPersonOn(state("first-person"), floor("matterport"), failed)).toBe(false);
    expect(firstPersonOn(state("board"), floor("matterport"), loading)).toBe(false);
  });

  it("offers it on a fixture floor always, and on a scan only with a mesh on its way", () => {
    expect(firstPersonOffered(floor("fixture"))).toBe(true);
    expect(firstPersonOffered(floor("matterport"))).toBe(false);
    expect(firstPersonOffered(floor("matterport"), loading)).toBe(true);
    expect(firstPersonOffered(floor("matterport"), failed)).toBe(false);
  });
});

describe("what first person does on a live scan with the preload as it stands", () => {
  // A stand-in: the choice only looks at whether there is a handle, never into it.
  const handle = { canvas: null } as unknown as ScanHandle;
  const loading: ScanPreload = { handle: null, failed: null, ready: false };

  it("waits while the preload's module is still on its way, and walks the scan once its handle comes", () => {
    // First person mounts first (its chunk is the lighter one): offered, and waiting, not refused.
    expect(firstPersonOffered({ source: "matterport" } as FloorGraph, loading)).toBe(true);
    expect(scanStageOf(loading)).toEqual({ kind: "wait" });
    // Then the handle: the scan is walked, and the board is not given back.
    expect(scanStageOf({ handle, failed: null, ready: false })).toEqual({ kind: "walk", handle });
    expect(scanStageOf({ handle, failed: null, ready: true })).toEqual({ kind: "walk", handle });
  });

  it("gives the board back with the preload's own line when it fails, and the no-mesh line only with no preload", () => {
    const line = "The scan's mesh didn't download. You're on the board.";
    expect(scanStageOf({ handle: null, failed: line, ready: false })).toEqual({ kind: "refuse", line });
    expect(scanStageOf(null)).toEqual({ kind: "refuse", line: SCAN_NO_MESH });
  });
});
