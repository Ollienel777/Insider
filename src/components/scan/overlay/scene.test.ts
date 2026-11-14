// The overlay's scene (issue 108): what the board shows from above, as marks
// at the scan's floor points, filtered to what the player could see.
import { describe, expect, it } from "vitest";
import type { ScanPoint } from "@/adapters/matterport";
import { CAMERA_MOUNT_M, sceneOf, type Mark } from "./scene";
import { FLOOR_Y, POINTS, run } from "./testing";

const walkers = (marks: readonly Mark[]) =>
  Object.fromEntries(marks.flatMap((m) => (m.kind === "walker" ? [[m.id, m.seen]] : [])));
const of = <K extends Mark["kind"]>(marks: readonly Mark[], kind: K) =>
  marks.filter((m): m is Extract<Mark, { kind: K }> => m.kind === kind);

describe("sceneOf: guards and cleaners", () => {
  it("draws each on its node's floor point, solid in sight, an outline in hearing, and leaves the rest out", () => {
    const marks = sceneOf({ run: run(), points: POINTS });
    // G1 is down the hall; G2 is behind the office wall, two hops away; G3 and K1 are three hops away.
    expect(walkers(marks)).toEqual({ G1: "solid", G2: "outline" });
    const g1 = of(marks, "walker").find((m) => m.id === "G1")!;
    expect(g1).toMatchObject({ who: "guard", nodeId: "a3", foot: POINTS.get("a3") });
  });

  it("follows the player: from the hall's middle, the far office and the store come into hearing", () => {
    const marks = sceneOf({ run: run({ start: "a2" }), points: POINTS });
    expect(walkers(marks)).toEqual({ G1: "solid", G2: "outline", G3: "outline", K1: "outline" });
    expect(of(marks, "walker").find((m) => m.id === "K1")!.who).toBe("cleaner");
  });

  it("never draws a guard behind a wall solid, even beside the player", () => {
    // From a2, b1 is 3 m away through the door: still another room.
    const marks = sceneOf({ run: run({ start: "a2" }), points: POINTS });
    expect(walkers(marks).G2).toBe("outline");
  });

  it("glides a guard from its last node to its new one over the turn", () => {
    const from = new Map([["G1", "a2"]]);
    const at = (t: number) =>
      of(sceneOf({ run: run(), points: POINTS, glide: { from, t } }), "walker").find((m) => m.id === "G1")!.foot;
    expect(at(0)).toEqual(POINTS.get("a2"));
    expect(at(1)).toEqual(POINTS.get("a3"));
    const mid = at(0.5).z;
    expect(mid).toBeLessThan(-5);
    expect(mid).toBeGreaterThan(-8);
    // Eased: past halfway at half time, and never back.
    expect(mid).toBeLessThan(-6.5);
    expect(at(0.25).z).toBeGreaterThan(mid);
  });

  it("stands still when the glide's start is its own node or unknown", () => {
    const foot = (from: Map<string, string>) =>
      of(sceneOf({ run: run(), points: POINTS, glide: { from, t: 0.5 } }), "walker").find((m) => m.id === "G1")!.foot;
    expect(foot(new Map([["G1", "a3"]]))).toEqual(POINTS.get("a3"));
    expect(foot(new Map([["G1", "nowhere"]]))).toEqual(POINTS.get("a3"));
    expect(foot(new Map())).toEqual(POINTS.get("a3"));
  });

  it("leaves out a piece whose node has no floor point", () => {
    const points = new Map(POINTS);
    points.delete("a3");
    expect(walkers(sceneOf({ run: run(), points }))).toEqual({ G2: "outline" });
  });
});

describe("sceneOf: cameras", () => {
  it("hangs each at its mount on the wall, over the floor, seen by the cover node nearest it", () => {
    const cameras = of(sceneOf({ run: run(), points: POINTS }), "camera");
    // C1 hangs on the hall's far end wall (z -9), C2 on the office's west wall behind the door (x 2).
    expect(cameras.map((c) => [c.id, c.seen, c.nodeId])).toEqual([
      ["C1", "solid", "a3"],
      ["C2", "outline", "b1"],
    ]);
    expect(cameras[0].mount).toEqual({ x: 0, y: FLOOR_Y + CAMERA_MOUNT_M, z: -9 });
    expect(cameras[1].mount).toEqual({ x: 2, y: FLOOR_Y + CAMERA_MOUNT_M, z: -5 });
  });

  it("leaves out a camera out of sight and hearing", () => {
    const cameras = of(sceneOf({ run: run({ start: "c2", hearing: 0 }), points: POINTS }), "camera");
    expect(cameras.map((c) => c.id)).toEqual([]);
  });

  it("leaves out a camera none of whose cover has a floor point", () => {
    const points: Map<string, ScanPoint> = new Map(POINTS);
    points.delete("a2");
    points.delete("a3");
    expect(of(sceneOf({ run: run(), points }), "camera").map((c) => c.id)).toEqual(["C2"]);
  });
});

describe("sceneOf: watched floor", () => {
  it("rings every watched node in the player's sight, and none behind a wall", () => {
    const watched = of(sceneOf({ run: run(), points: POINTS }), "watch").map((m) => m.nodeId);
    // C1 watches a2 and a3; C2, G2 and G3 watch the office, which is out of sight.
    expect(watched).toEqual(expect.arrayContaining(["a2", "a3"]));
    expect(watched.every((id) => ["a1", "a2", "a3"].includes(id))).toBe(true);
    const ring = of(sceneOf({ run: run(), points: POINTS }), "watch").find((m) => m.nodeId === "a2")!;
    expect(ring.by).toContain("C1");
    expect(ring.at).toEqual(POINTS.get("a2"));
  });
});

describe("sceneOf: legal hops", () => {
  it("rings each of the player's moves, highlighting the aimed one", () => {
    const hops = of(sceneOf({ run: run({ start: "a2" }), points: POINTS, aimed: "b1" }), "hop");
    expect(hops.map((h) => [h.nodeId, h.aimed]).sort()).toEqual([
      ["a1", false],
      ["a3", false],
      ["b1", true],
    ]);
  });

  it("draws every hop unhighlighted with no aimed hop, or one that is not legal", () => {
    for (const aimed of [undefined, null, "c2"]) {
      const hops = of(sceneOf({ run: run({ start: "a2" }), points: POINTS, aimed }), "hop");
      expect(hops).toHaveLength(3);
      expect(hops.some((h) => h.aimed)).toBe(false);
    }
  });

  it("marks a hop through a locked door, which the move key picks", () => {
    const hops = of(sceneOf({ run: run({ start: "a3", guards: [{ id: "G2", patrol: ["b1"] }] }), points: POINTS }), "hop");
    expect(hops.map((h) => [h.nodeId, h.locked]).sort()).toEqual([
      ["a2", false],
      ["c1", true],
    ]);
  });

  it("draws hops in or out of sight: they are where the player can go", () => {
    const hops = of(sceneOf({ run: run({ start: "a2" }), points: POINTS }), "hop");
    expect(hops.find((h) => h.nodeId === "b1")).toBeDefined();
  });

  it("draws none once the run is over", () => {
    const over = { ...run({ start: "a2" }), status: "caught" as const };
    expect(of(sceneOf({ run: over, points: POINTS }), "hop")).toEqual([]);
  });
});

describe("sceneOf: the beacon", () => {
  it("marks the objective until it is taken, an outline while out of sight", () => {
    const beacons = of(sceneOf({ run: run(), points: POINTS }), "beacon");
    expect(beacons).toEqual([{ kind: "beacon", role: "objective", nodeId: "c2", at: POINTS.get("c2"), seen: "outline" }]);
    const near = of(sceneOf({ run: run({ start: "c1" }), points: POINTS }), "beacon");
    expect(near[0].seen).toBe("solid");
  });

  it("marks the exits once carrying, and the objective no more", () => {
    const carrying = { ...run({ start: "c2", exits: ["a1", "b2"] }), carrying: true };
    const beacons = of(sceneOf({ run: carrying, points: POINTS }), "beacon");
    expect(beacons.map((b) => [b.role, b.nodeId])).toEqual([
      ["exit", "a1"],
      ["exit", "b2"],
    ]);
  });
});
