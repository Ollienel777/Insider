// The Run screen's view choice (issue 115): one per browser, the board unless
// first person was chosen, and never an error when storage is blocked.
import { describe, expect, it } from "vitest";
import type { FloorGraph } from "@/domain";
import { firstPersonOn } from "./run-view";
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
  it("is the board until first person is chosen", () => {
    expect(DEFAULT_RUN_VIEW).toBe("board");
    expect(loadRunView(memory())).toBe("board");
  });

  it("remembers first person, and the board again after", () => {
    const storage = memory();
    saveRunView("first-person", storage);
    expect(storage.map.get(RUN_VIEW_KEY)).toBe("first-person");
    expect(loadRunView(storage)).toBe("first-person");
    saveRunView("board", storage);
    expect(loadRunView(storage)).toBe("board");
  });

  it("reads anything else in storage as the board", () => {
    const storage = memory();
    storage.setItem(RUN_VIEW_KEY, "isometric");
    expect(loadRunView(storage)).toBe("board");
  });

  it("is the board, without an error, when storage is blocked", () => {
    expect(loadRunView(blocked)).toBe("board");
    expect(() => saveRunView("first-person", blocked)).not.toThrow();
  });
});

describe("whether the Run screen shows first person", () => {
  const state = (view: RunViewState["view"]): RunViewState => ({ view, choose: () => {}, unavailable: false, fail: () => {} });
  const floor = (source: FloorGraph["source"]) => ({ source }) as FloorGraph;

  it("shows it on a fixture floor once chosen", () => {
    expect(firstPersonOn(state("first-person"), floor("fixture"))).toBe(true);
    expect(firstPersonOn(state("board"), floor("fixture"))).toBe(false);
  });

  it("never shows it on a floor from a live scan, whatever was chosen", () => {
    expect(firstPersonOn(state("first-person"), floor("matterport"))).toBe(false);
  });
});
