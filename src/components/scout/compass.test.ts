// The compass on Scout's photos and the ways in an oblique names: each view's
// edges point where the camera looks, and an oblique names only the entries on
// the face it looks at.
import { describe, expect, it } from "vitest";
import { compassEdges, entriesFacing } from "./massing";

describe("the photo compass", () => {
  it("puts north up on the ortho, and the side an oblique is taken from nearest, with its right hand a quarter turn on", () => {
    expect(compassEdges("ortho")).toEqual({ top: "N", right: "E", bottom: "S", left: "W" });
    expect(compassEdges("N")).toEqual({ top: "S", right: "W", bottom: "N", left: "E" });
    expect(compassEdges("S")).toEqual({ top: "N", right: "E", bottom: "S", left: "W" });
    expect(compassEdges("E")).toEqual({ top: "W", right: "N", bottom: "E", left: "S" });
    expect(compassEdges("W")).toEqual({ top: "E", right: "S", bottom: "W", left: "N" });
    // Every view shows all four directions once.
    for (const dir of ["ortho", "N", "E", "S", "W"] as const) expect(new Set(Object.values(compassEdges(dir))).size).toBe(4);
  });
});

describe("the ways in an oblique names", () => {
  const entry = (id: string, view: "N" | "E" | "S" | "W" | "ortho", kind: "dock" | "lobby" | "roof" = "dock") => ({
    id,
    kind,
    label: id,
    view,
    note: "",
  });
  const aerial = {
    heightM: 100,
    footprint: [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
    ] as [number, number][],
    entries: [entry("Dock", "N"), entry("Lobby", "S", "lobby"), entry("Side door", "N"), entry("Hatch", "N", "roof")],
  };

  it("names the entries on the face it looks at, not the roof's, and none on the ortho", () => {
    expect(entriesFacing("N", aerial)).toEqual(["Dock", "Side door"]);
    expect(entriesFacing("S", aerial)).toEqual(["Lobby"]);
    expect(entriesFacing("E", aerial)).toEqual([]);
    expect(entriesFacing("ortho", aerial)).toEqual([]);
  });
});
