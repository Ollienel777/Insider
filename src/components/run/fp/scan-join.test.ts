// Whether a scan's board and its mesh are one building (issue 118), on a
// made-up floor and made-up panoramas. A node's x and y are its panorama's x
// and z, y-up; no scan data.
import { describe, expect, it } from "vitest";
import { FloorGraph } from "@/domain";
import { JOIN_TOLERANCE_M, joinRefusal, joinScan, type ScanJoin, type ScanPanoAt } from "./scan-join";

const floor = FloorGraph.parse({
  source: "matterport",
  rooms: [
    { id: "west", label: "West", rect: { x: 0, y: 0, w: 3, h: 8 } },
    { id: "east", label: "East", rect: { x: 3, y: 0, w: 3, h: 8 } },
  ],
  nodes: [
    { id: "a", x: 1, y: 2, roomId: "west", tags: [] },
    { id: "b", x: 4, y: 2, roomId: "east", tags: [] },
    { id: "c", x: 4, y: 6, roomId: "east", tags: [] },
  ],
  edges: [
    { a: "a", b: "b", door: { id: "door:a:b", lockable: true } },
    { a: "b", b: "c" },
  ],
  sightlines: { a: ["b"], b: ["a", "c"], c: ["b"] },
});

/** A panorama right over each node: the camera 1.5 m up (1.6 m at "c"), the floor spot under it. */
const exact = (): ScanPanoAt[] =>
  floor.nodes.map((n) => {
    const eye = n.id === "c" ? 1.6 : 1.5;
    return { id: n.id, position: [n.x, eye, n.y], floor: [n.x, 0.02, n.y] };
  });

/** `exact`, with the panorama of `id` changed by `change`. */
const changed = (id: string, change: (p: ScanPanoAt) => ScanPanoAt): ScanPanoAt[] =>
  exact().map((p) => (p.id === id ? change(p) : p));

describe("joining a scan's board to its panoramas", () => {
  it("matches every node to its panorama, and fills the heights from them", () => {
    const join = joinScan(floor, exact());
    expect(join.matched).toBe(3);
    expect(join.total).toBe(3);
    expect(join.worstM).toBe(0);
    expect(joinRefusal(join)).toBeNull();
    expect(Object.fromEntries(join.heights.eye)).toEqual({ a: 1.5, b: 1.5, c: 1.6 });
    expect(Object.fromEntries(join.heights.floor)).toEqual({ a: 0.02, b: 0.02, c: 0.02 });
  });

  it("leaves a node's floor spot out when its panorama has none", () => {
    const join = joinScan(floor, changed("b", (p) => ({ ...p, floor: null })));
    expect(joinRefusal(join)).toBeNull();
    expect([...join.heights.floor.keys()].sort()).toEqual(["a", "c"]);
    expect(join.heights.eye.get("b")).toBe(1.5);
  });

  it("ignores panoramas no node names, and their order", () => {
    const extra: ScanPanoAt = { id: "z", position: [40, 1.5, -40], floor: null };
    const join = joinScan(floor, [extra, ...exact().reverse()]);
    expect(join).toMatchObject({ matched: 3, total: 3, worstM: 0 });
    expect(joinRefusal(join)).toBeNull();
    expect(join.heights.eye.has("z")).toBe(false);
  });

  it("refuses a board with a node no panorama names", () => {
    const join = joinScan(floor, exact().filter((p) => p.id !== "c"));
    expect(join).toMatchObject({ matched: 2, total: 3 });
    expect(joinRefusal(join)).toEqual(expect.any(String));
    // A panorama at the right place under another id is not the same position.
    const renamed = joinScan(floor, changed("c", (p) => ({ ...p, id: "c2" })));
    expect(renamed.matched).toBe(2);
    expect(joinRefusal(renamed)).toEqual(expect.any(String));
    expect(joinRefusal(joinScan(floor, []))).toEqual(expect.any(String));
  });

  it("refuses an empty join", () => {
    const empty: ScanJoin = { matched: 0, total: 0, worstM: 0, heights: { eye: new Map(), floor: new Map() } };
    expect(joinRefusal(empty)).toEqual(expect.any(String));
  });

  it("allows a few centimetres of rounding, and refuses a panorama further off than the tolerance", () => {
    const near = joinScan(floor, changed("b", (p) => ({ ...p, position: [p.position[0] + 0.03, p.position[1], p.position[2] - 0.04] })));
    expect(near.worstM).toBeCloseTo(0.05, 9);
    expect(joinRefusal(near)).toBeNull();

    const off = JOIN_TOLERANCE_M + 0.05;
    const far = joinScan(floor, changed("b", (p) => ({ ...p, position: [p.position[0], p.position[1], p.position[2] + off] })));
    expect(far.matched).toBe(3);
    expect(far.worstM).toBeCloseTo(off, 9);
    expect(joinRefusal(far)).toEqual(expect.any(String));
  });

  it("measures the offset on the floor plan only: the camera's height is not a distance", () => {
    const tall = joinScan(floor, changed("a", (p) => ({ ...p, position: [p.position[0], 3, p.position[2]] })));
    expect(tall.worstM).toBe(0);
    expect(joinRefusal(tall)).toBeNull();
  });

  it("refuses panoramas with z flipped in sign, the frame mistake the check is for", () => {
    const flipped = exact().map((p): ScanPanoAt => ({ ...p, position: [p.position[0], p.position[1], -p.position[2]] }));
    const join = joinScan(floor, flipped);
    expect(join.matched).toBe(3);
    // Node "c" stands at y = 6: flipped, its panorama is 12 m off.
    expect(join.worstM).toBeCloseTo(12, 9);
    expect(joinRefusal(join)).toEqual(expect.any(String));
    // And x and z swapped, the other way to get the frame wrong.
    const swapped = exact().map((p): ScanPanoAt => ({ ...p, position: [p.position[2], p.position[1], p.position[0]] }));
    expect(joinRefusal(joinScan(floor, swapped))).toEqual(expect.any(String));
  });

  it("names no node and no position in what it says", () => {
    const join = joinScan(floor, changed("c", (p) => ({ ...p, id: "q7-sweep", position: [123.45, 1.5, 678.9] })));
    const refusal = joinRefusal(join)!;
    expect(refusal).not.toMatch(/q7-sweep|123|678/);
    expect(joinRefusal(joinScan(floor, changed("c", (p) => ({ ...p, position: [123.45, 1.5, 678.9] }))))).not.toMatch(/123|678/);
  });
});
