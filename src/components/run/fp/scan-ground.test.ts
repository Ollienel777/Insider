import { describe, expect, it } from "vitest";
import type { FloorGraph } from "@/domain";
import type { MoveWorld } from "@/lib/scan-mesh/movement";
import type { Vec } from "./ground";
import { fitPairs, IDENTITY, type PlanToScan } from "./scan-fit";
import { createScanGround, scanCameraMarks, scanDoors, scanNodes, SCAN_RADIUS_M } from "./scan-ground";

// A made-up scan, in its ground plane (x, z): two rooms side by side, x 0..10 and z 0..10, a wall
// at x = 5 with a doorway at z 4..6. The floor is at height 0, and there is none past x = 10.
const WALL_X = 5;
const GAP = [4, 6] as const;
const inGap = (z: number) => z > GAP[0] && z < GAP[1];

const world: MoveWorld = {
  floorBelow: (x, _fromY, z) => (x >= 0 && x <= 10 && z >= 0 && z <= 10 ? 0 : null),
  pushOut(x, _feetY, z, radius) {
    if (inGap(z)) return { x, z };
    if (x < WALL_X && x > WALL_X - radius) return { x: WALL_X - radius, z };
    if (x >= WALL_X && x < WALL_X + radius) return { x: WALL_X + radius, z };
    return { x, z };
  },
};
/** Blocked where the line crosses the wall outside the doorway. */
const see = (p: Vec, q: Vec) => {
  if ((p.x - WALL_X) * (q.x - WALL_X) >= 0) return true;
  const t = (WALL_X - p.x) / (q.x - p.x);
  return inGap(p.y + (q.y - p.y) * t);
};

// The board: plan units, turned a quarter and shifted from the scan, as a real board might be.
const SCAN = { a: { x: 2, y: 5 }, b: { x: 8, y: 5 }, c: { x: 2, y: 1 }, d: { x: 8, y: 9 } };
const planOf = (q: Vec) => ({ x: q.y + 100, y: -q.x });
const floor = {
  nodes: Object.entries(SCAN).map(([id, q]) => ({ id, ...planOf(q), roomId: id === "a" || id === "c" ? "west" : "east", tags: [] })),
  edges: [
    { a: "a", b: "b", door: { id: "door:a:b", lockable: true } },
    { a: "a", b: "c" },
    { a: "b", b: "d" },
  ],
  rooms: [],
  sightlines: {},
  source: "matterport",
} as unknown as FloorGraph;
const fit: PlanToScan = fitPairs(Object.values(SCAN).map((scan) => ({ plan: planOf(scan), scan })));

const ground = () => createScanGround({ floor, fit, world, see, doorIds: new Set(["door:a:b"]), feetY: 0 });

describe("placing the board in the scan", () => {
  it("puts each node, so each actor standing on one, on its sweep", () => {
    const nodes = scanNodes(floor, fit);
    for (const [id, q] of Object.entries(SCAN)) {
      expect(nodes.get(id)!.x).toBeCloseTo(q.x, 9);
      expect(nodes.get(id)!.y).toBeCloseTo(q.y, 9);
    }
  });

  it("carries a camera's mount and the middle of what it covers", () => {
    const [cam] = scanCameraMarks(floor, fit, [{ id: "cam1", parts: [["a"], ["c"]] }], () => planOf({ x: 1, y: 3 }));
    expect(cam.mount.x).toBeCloseTo(1, 9);
    expect(cam.mount.y).toBeCloseTo(3, 9);
    expect(cam.looksAt.x).toBeCloseTo(2, 9);
    expect(cam.looksAt.y).toBeCloseTo(3, 9);
  });

  it("stands a door across its edge, midway, and only the ones asked for", () => {
    const nodes = scanNodes(floor, IDENTITY);
    expect(scanDoors(floor, nodes, new Set())).toEqual([]);
    const [door] = scanDoors(floor, scanNodes(floor, fit), new Set(["door:a:b"]));
    expect(door.centre.x).toBeCloseTo(5, 9);
    expect(door.centre.y).toBeCloseTo(5, 9);
    // Across the edge (which runs along x): the face runs along z.
    expect(Math.abs(door.bar.a.x - door.bar.b.x)).toBeLessThan(1e-9);
    expect(Math.abs(door.bar.a.y - door.bar.b.y)).toBeCloseTo(1.2, 9);
  });

  it("gives the fit's scale as metres per plan unit", () => {
    expect(ground().unitM).toBeCloseTo(1, 9);
  });
});

describe("walking the scan", () => {
  it("stops at the wall and slides along it", () => {
    const g = ground();
    let pos = { x: 4, y: 2 };
    for (let i = 0; i < 60; i++) pos = g.collide(pos, { x: 3, y: 1 }, 1 / 60, []).pos;
    expect(pos.x).toBeCloseTo(WALL_X - SCAN_RADIUS_M, 6);
    expect(pos.y).toBeGreaterThan(2.5);
  });

  it("goes through the doorway while it is open, and is held by the door while it is shut", () => {
    const g = ground();
    let open = { x: 4, y: 5 };
    for (let i = 0; i < 60; i++) open = g.collide(open, { x: 3, y: 0 }, 1 / 60, []).pos;
    expect(open.x).toBeGreaterThan(6);

    let shut = { x: 4, y: 5 };
    let pressed: string[] = [];
    for (let i = 0; i < 60; i++) {
      const out = g.collide(shut, { x: 3, y: 0 }, 1 / 60, ["door:a:b"]);
      shut = out.pos;
      if (out.pressed.length > 0) pressed = out.pressed.map((p) => p.doorId);
    }
    expect(shut.x).toBeLessThan(WALL_X);
    expect(pressed).toEqual(["door:a:b"]);
  });

  it("does not step off the mesh's floor", () => {
    const g = ground();
    let pos = { x: 9.5, y: 8 };
    for (let i = 0; i < 60; i++) pos = g.collide(pos, { x: 3, y: 0 }, 1 / 60, []).pos;
    expect(pos.x).toBeLessThanOrEqual(10);
  });

  it("never moves faster than asked", () => {
    const out = ground().collide({ x: 4.9, y: 2 }, { x: 0, y: 1 }, 1 / 60, []);
    expect(Math.hypot(out.vel.x, out.vel.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("areas and sight", () => {
  it("keeps an area on its own side of a wall, though a node through the wall is nearer", () => {
    // Nearer d (8, 9) through the wall than a (2, 5), but d is out of sight.
    expect(ground().regionOf({ x: 4.7, y: 8.5 })).toBe("a");
    expect(ground().regionOf({ x: 7.5, y: 8.5 })).toBe("d");
  });

  it("is blocked by a shut door and by the mesh", () => {
    const g = ground();
    expect(g.clear({ x: 3, y: 5 }, { x: 7, y: 5 }, [])).toBe(true);
    expect(g.clear({ x: 3, y: 5 }, { x: 7, y: 5 }, ["door:a:b"])).toBe(false);
    expect(g.clear({ x: 3, y: 2 }, { x: 7, y: 2 }, [])).toBe(false);
  });

  it("walks an edge straight from node to node", () => {
    const [p, q] = ground().path("a", "b");
    expect(p.x).toBeCloseTo(2, 9);
    expect(q.x).toBeCloseTo(8, 9);
  });
});
