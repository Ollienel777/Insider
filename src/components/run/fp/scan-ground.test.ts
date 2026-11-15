// The scan's ground (issue 118) on a made-up building, walked through the real
// collision code: a three.js mesh in a `MeshWorld` (spike/mesh/collider.ts),
// answered through `meshSolid`. Two rooms either side of a wall with a 1 m
// doorway in it, a floor plan made up to match, and no scan data.
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { MeshWorld } from "@/app/spike/mesh/collider";
import { FloorGraph } from "@/domain";
import type { Collision, Ground, Vec } from "./ground";
import { doorBar, SCAN, scanGround, type ScanHeights, type ScanSolid, type Vec3 } from "./scan-ground";
import { meshSolid } from "./scan-solid";
import { doorInView } from "./walker";
import type { RunState } from "@/engine";

const DT = 1 / 120;
const STEP_UP = 0.45;
/** The walls' height, and the doorway's head under it. */
const WALL_H = 2.5;
const HEAD_H = 2.1;
/** The wall between the rooms: 20 cm thick, its faces at these x. */
const WALL_W = 4.9;
const WALL_E = 5.1;
/** The doorway through it: 1 m wide, between these z. */
const DOOR_S = 3;
const DOOR_N = 4;
const DOOR_W = DOOR_N - DOOR_S;
const DOORWAY: Vec = { x: (WALL_W + WALL_E) / 2, y: (DOOR_S + DOOR_N) / 2 };
/** The rooms run from z = 0 to here, between an outer wall on either side. */
const ROOM_N = 7;
/** The tripod's hole in the floor, under node "d". */
const HOLE = { x0: 7.2, x1: 7.8, z0: 0.7, z1: 1.3 };

type Quad = readonly [Vec3, Vec3, Vec3, Vec3];

/** Quads in, two triangles each, as an indexed geometry like the scan's own. */
function geometryOf(quads: readonly Quad[]): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (const quad of quads) {
    const base = positions.length / 3;
    for (const corner of quad) positions.push(...corner);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(index), 1));
  return geometry;
}

/** A level rectangle at height `y`: floor, or a wall's top, or the underside of a doorway's head. */
const flat = (x0: number, z0: number, x1: number, z1: number, y = 0): Quad => [
  [x0, y, z0],
  [x1, y, z0],
  [x1, y, z1],
  [x0, y, z1],
];

/** An upright face from (x0, z0) to (x1, z1), from `bottom` to `top`. */
const upright = (x0: number, z0: number, x1: number, z1: number, bottom = 0, top = WALL_H): Quad => [
  [x0, bottom, z0],
  [x1, bottom, z1],
  [x1, top, z1],
  [x0, top, z0],
];

/**
 * The made-up building, y-up, metres, seen from above with x east and z south:
 *
 *   z=0  ───────────────────┬──────────────────── (outer wall, to x=10)
 *        west room          │  east room
 *        "c"                │            "d" (over a tripod's hole)
 *   z=3                     ┘
 *        "a"            doorway           "b"      bare floor on to x=20,
 *   z=4                     ┐                      past the leash
 *                           │
 *   z=7  ───────────────────┴──────────────────── (outer wall, to x=10)
 *       x=0                x=5                   x=10
 *
 * The west room has no west wall: its floor ends at x = 0, the mesh's edge.
 */
function building(): BufferGeometry {
  const floor: Quad[] = [
    flat(0, 0, 20, HOLE.z0),
    flat(0, HOLE.z1, 20, ROOM_N),
    flat(0, HOLE.z0, HOLE.x0, HOLE.z1),
    flat(HOLE.x1, HOLE.z0, 20, HOLE.z1),
  ];
  const outer: Quad[] = [upright(0, 0, 10, 0), upright(0, ROOM_N, 10, ROOM_N)];
  /** One length of the dividing wall, from z0 to z1: both faces, its end and its top. */
  const length = (z0: number, z1: number, end: number): Quad[] => [
    upright(WALL_W, z0, WALL_W, z1),
    upright(WALL_E, z0, WALL_E, z1),
    upright(WALL_W, end, WALL_E, end),
    flat(WALL_W, z0, WALL_E, z1, WALL_H),
  ];
  const head: Quad[] = [
    flat(WALL_W, DOOR_S, WALL_E, DOOR_N, HEAD_H),
    upright(WALL_W, DOOR_S, WALL_W, DOOR_N, HEAD_H, WALL_H),
    upright(WALL_E, DOOR_S, WALL_E, DOOR_N, HEAD_H, WALL_H),
  ];
  return geometryOf([...floor, ...outer, ...length(0, DOOR_S, DOOR_S), ...length(DOOR_N, ROOM_N, DOOR_N), ...head]);
}

const board = FloorGraph.parse({
  source: "matterport",
  rooms: [
    { id: "west", label: "West", rect: { x: 0, y: 0, w: 5, h: ROOM_N } },
    { id: "east", label: "East", rect: { x: 5, y: 0, w: 5, h: ROOM_N } },
  ],
  nodes: [
    { id: "a", x: 2.5, y: 3.5, roomId: "west", tags: [] },
    { id: "b", x: 7.5, y: 3.5, roomId: "east", tags: [] },
    { id: "c", x: 2.5, y: 1, roomId: "west", tags: [] },
    { id: "d", x: 7.5, y: 1, roomId: "east", tags: [] },
  ],
  edges: [
    { a: "a", b: "b", door: { id: "door:a:b", lockable: true } },
    { a: "a", b: "c" },
    { a: "b", b: "d" },
  ],
  sightlines: { a: ["b", "c"], b: ["a", "d"], c: ["a"], d: ["b"] },
});

const heights = (eye = 1.5, floor = 0): ScanHeights => ({
  eye: new Map(board.nodes.map((n) => [n.id, eye])),
  floor: new Map(board.nodes.map((n) => [n.id, floor])),
});

const solid = meshSolid(new MeshWorld(building(), STEP_UP));
const ground = scanGround(board, solid, heights());
const node = (id: string): Vec => {
  const n = ground.nodes.get(id)!;
  return { x: n.x, y: n.y };
};
const distance = (p: Vec, q: Vec) => Math.hypot(p.x - q.x, p.y - q.y);
const LOCKED = ["door:a:b"] as const;

/** Holds `vel` for `seconds`, as a player holds a key: one `collide` every 1/120 s. */
function walk(on: Ground, from: Vec, vel: Vec, seconds: number, locked: readonly string[] = []) {
  let pos = { ...from };
  const trail: Vec[] = [pos];
  const pressed = new Set<string>();
  let last: Collision | null = null;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    last = on.collide(pos, vel, DT, locked);
    pos = { ...last.pos };
    trail.push(pos);
    for (const d of last.pressed) pressed.add(d.doorId);
  }
  return { pos, trail, pressed, last: last! };
}

describe("the scan's ground on a made-up building", () => {
  it("stands every board node at its own x and y, in metres, on the mesh's floor", () => {
    expect([...ground.nodes.keys()].sort()).toEqual(board.nodes.map((n) => n.id).sort());
    for (const n of board.nodes) expect(ground.nodes.get(n.id)).toEqual({ id: n.id, x: n.x, y: n.y });
    expect(ground.unitM).toBe(1);
    expect(ground.floorY).toBeCloseTo(0, 6);
    expect(ground.feetAt(node("a"))).toBeCloseTo(0, 6);
    // Over the tripod's hole there is no mesh: the feet stay at the floor's own height.
    expect(ground.feetAt(node("d"))).toBe(ground.floorY);
  });

  it("takes the floor's height from the mesh under the scan camera, not the scan's floor spot", () => {
    // The spots say 0.2 m: the mesh under every camera but "d"'s says 0.
    expect(scanGround(board, solid, heights(1.5, 0.2)).floorY).toBeCloseTo(0, 6);
    // With no camera heights, only the spots are left.
    const spotsOnly: ScanHeights = { eye: new Map(), floor: heights(1.5, 0.2).floor };
    expect(scanGround(board, solid, spotsOnly).floorY).toBeCloseTo(0.2, 6);
  });

  it("puts the door's bar across the doorway, as wide as the gap and a little over, not across the room", () => {
    expect(ground.doors.map((d) => d.doorId)).toEqual(["door:a:b"]);
    const [door] = ground.doors;
    expect(door).toEqual({ doorId: "door:a:b", ...doorBar(node("a"), node("b"), solid, ground.floorY + SCAN.doorProbeM), a: "a", b: "b" });
    expect(distance(door.centre, DOORWAY)).toBeLessThan(0.3);
    const length = distance(door.bar.a, door.bar.b);
    expect(length).toBeGreaterThan(1.0);
    expect(length).toBeLessThan(1.5);
    expect(length).toBeCloseTo(DOOR_W + 2 * SCAN.doorOverlapM, 3);
    // Square to the edge from "a" to "b" (which runs along x): the bar runs along z, in the wall.
    expect(door.bar.a.x).toBeCloseTo(door.bar.b.x, 6);
    expect(door.bar.a.x).toBeGreaterThan(WALL_W);
    expect(door.bar.a.x).toBeLessThan(WALL_E);
    // Each end goes past its jamb, into the wall, by the overlap.
    const [south, north] = [door.bar.a.y, door.bar.b.y].sort((p, q) => p - q);
    expect(south).toBeCloseTo(DOOR_S - SCAN.doorOverlapM, 3);
    expect(north).toBeCloseTo(DOOR_N + SCAN.doorOverlapM, 3);
  });

  it("finds a doorway in a wall thinner than a door's edge is long", () => {
    // A 12 cm wall, x from 5.05 to 5.17, between nodes 6 m apart: probed every few centimetres along the
    // edge, some probe falls inside the wall and sees both jambs, where 13 probes 30 cm apart would miss it
    // and put a 6.2 m bar down the middle of the edge.
    const thinW = 5.05;
    const thinE = 5.17;
    const thin = geometryOf([
      flat(0, 0, 10, ROOM_N),
      upright(0, 0, 10, 0),
      upright(0, ROOM_N, 10, ROOM_N),
      upright(thinW, 0, thinW, DOOR_S),
      upright(thinE, 0, thinE, DOOR_S),
      upright(thinW, DOOR_S, thinE, DOOR_S),
      upright(thinW, DOOR_N, thinW, ROOM_N),
      upright(thinE, DOOR_N, thinE, ROOM_N),
      upright(thinW, DOOR_N, thinE, DOOR_N),
    ]);
    const { centre, bar } = doorBar({ x: 2, y: 3.5 }, { x: 8, y: 3.5 }, meshSolid(new MeshWorld(thin, STEP_UP)), SCAN.doorProbeM);
    expect(distance(centre, { x: (thinW + thinE) / 2, y: DOORWAY.y })).toBeLessThan(0.3);
    expect(distance(bar.a, bar.b)).toBeLessThan(1.5);
  });

  it("stops a body walking straight at the wall short of it, and never lets it through", () => {
    const { pos, trail, last } = walk(ground, node("c"), { x: 2, y: 0 }, 2);
    for (const p of trail) expect(p.x).toBeLessThanOrEqual(WALL_W - SCAN.radiusM + 1e-3);
    expect(pos.x).toBeCloseTo(WALL_W - SCAN.radiusM, 2);
    expect(pos.y).toBeCloseTo(node("c").y, 6);
    expect(last.vel.x).toBeCloseTo(0, 6);
    expect(last.pressed).toEqual([]);
  });

  it("slides a body along the wall, keeping the velocity along it", () => {
    const from = { x: 4.3, y: 0.8 };
    const { pos, trail, last } = walk(ground, from, { x: 1, y: 0.5 }, 1);
    for (const p of trail) expect(p.x).toBeLessThanOrEqual(WALL_W - SCAN.radiusM + 1e-3);
    expect(pos.x).toBeCloseTo(WALL_W - SCAN.radiusM, 2);
    expect(last.vel.x).toBeCloseTo(0, 6);
    expect(last.vel.y).toBeCloseTo(0.5, 6);
    // Half a metre a second along the wall for the whole second, none of it lost against it.
    expect(pos.y - from.y).toBeCloseTo(0.5, 2);
  });

  it("never tunnels through a thin wall in one long frame", () => {
    // The outer wall at z = 7 is a single face. Two metres in one call, from 1 m short of it.
    const from = { x: 4, y: ROOM_N - 1 };
    const hit = ground.collide(from, { x: 0, y: 4 }, 0.5, []);
    expect(hit.pos.y).toBeLessThanOrEqual(ROOM_N - SCAN.radiusM + 1e-3);
    expect(hit.pos.y).toBeCloseTo(ROOM_N - SCAN.radiusM, 2);
    expect(hit.pos.x).toBeCloseTo(from.x, 6);
    expect(hit.vel.y).toBeCloseTo(0, 6);
  });

  it.fails("holds a body pushed straight into a wall in place along it, wherever the wall's triangles meet (known bug, in MeshWorld)", () => {
    // The outer wall at z = 7 is one quad, split along its diagonal, which at x = 2.5 runs 7.5 cm below the
    // bottom of the body's capsule. `MeshWorld.pushOut` pushes the capsule off that edge of the lower
    // triangle at a slant, so each frame's push has a sideways part, and the body creeps along the wall.
    const from = { x: 2.5, y: ROOM_N - 1 };
    const { pos, last } = walk(ground, from, { x: 0, y: 2 }, 2);
    expect(pos.y).toBeCloseTo(ROOM_N - SCAN.radiusM, 2);
    expect(Math.abs(pos.x - from.x)).toBeLessThan(0.01);
    expect(last.vel.x).toBeCloseTo(0, 3);
  });

  it("stops a body at a locked door, and says which door it pressed", () => {
    const { pos, trail, pressed, last } = walk(ground, node("a"), { x: 2, y: 0 }, 3, LOCKED);
    const [door] = ground.doors;
    for (const p of trail) expect(p.x).toBeLessThanOrEqual(door.bar.a.x - SCAN.radiusM + 1e-3);
    expect(pos.x).toBeCloseTo(door.bar.a.x - SCAN.radiusM, 2);
    expect(pressed).toEqual(new Set(["door:a:b"]));
    expect(last.pressed).toHaveLength(1);
    expect(last.pressed[0].doorId).toBe("door:a:b");
    // Pushed back towards "a", the way it came.
    expect(last.pressed[0].n.x).toBeCloseTo(-1, 6);
    expect(last.vel.x).toBeCloseTo(0, 6);
  });

  it("lets a body through the doorway into the other room while its door is not locked", () => {
    const { pos, pressed } = walk(ground, node("a"), { x: 2, y: 0 }, 3, []);
    expect(pos.x).toBeGreaterThan(WALL_E + SCAN.radiusM);
    expect(distance(pos, node("b"))).toBeLessThan(distance(pos, node("a")));
    expect(pos).toEqual({ x: expect.closeTo(node("a").x + 6, 3), y: expect.closeTo(node("a").y, 6) });
    expect(pressed.size).toBe(0);
    // A door locked elsewhere is not this one.
    expect(walk(ground, node("a"), { x: 2, y: 0 }, 3, ["door:x:y"]).pos.x).toBeGreaterThan(WALL_E + SCAN.radiusM);
  });

  it("sees through the open doorway, not through the wall, and not through a locked door", () => {
    expect(ground.clear(node("a"), node("b"), [])).toBe(true);
    expect(ground.clear(node("a"), node("c"), [])).toBe(true);
    expect(ground.clear(node("c"), node("d"), [])).toBe(false);
    expect(ground.clear(node("d"), node("c"), [])).toBe(false);
    expect(ground.clear(node("a"), node("b"), LOCKED)).toBe(false);
    expect(ground.clear(node("b"), node("a"), LOCKED)).toBe(false);
    // The locked door shuts only its doorway.
    expect(ground.clear(node("a"), node("c"), LOCKED)).toBe(true);
    expect(ground.clear(node("a"), node("a"), LOCKED)).toBe(true);
  });

  it("never walks a body off the mesh's edge", () => {
    // West from "a": the floor ends at x = 0, more than a hole's width from every node.
    const { pos, trail, last } = walk(ground, node("a"), { x: -1.7, y: 0 }, 3);
    for (const p of trail) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(solid.floorBelow(p.x, SCAN.riseM, p.y, SCAN.riseM + SCAN.dropM)).not.toBeNull();
    }
    expect(pos.x).toBeLessThan(0.05);
    expect(last.vel).toEqual({ x: 0, y: 0 });
  });

  it("never walks a body further than the leash from every node, though the mesh's floor goes on", () => {
    // East from "b", out past the rooms' walls onto bare floor that runs on to x = 20.
    const { pos, trail, last } = walk(ground, node("b"), { x: 2, y: 0 }, 5);
    const nearest = (p: Vec) => Math.min(...[...ground.nodes.values()].map((n) => distance(p, n)));
    for (const p of trail) expect(nearest(p)).toBeLessThanOrEqual(SCAN.leashM);
    expect(pos.x).toBeCloseTo(node("b").x + SCAN.leashM, 1);
    expect(last.vel).toEqual({ x: 0, y: 0 });
    // It was the leash that stopped it: there is floor a metre further on.
    expect(solid.floorBelow(pos.x + 1, SCAN.riseM, pos.y, SCAN.riseM + SCAN.dropM)).toBeCloseTo(0, 6);
  });

  it("walks a body across the hole the tripod left under a scan position", () => {
    expect(solid.floorBelow(node("d").x, SCAN.riseM, node("d").y, SCAN.riseM + SCAN.dropM)).toBeNull();
    const { pos, last } = walk(ground, { x: 6.5, y: node("d").y }, { x: 1, y: 0 }, 2);
    expect(pos.x).toBeCloseTo(8.5, 3);
    expect(last.vel).toEqual({ x: 1, y: 0 });
  });

  it("splits the floor into one area per node: the nearest node in view, never through a wall", () => {
    expect(ground.regionOf(node("a"))).toBe("a");
    expect(ground.regionOf(node("b"))).toBe("b");
    // Nearer "a" than "c", in the west room.
    expect(ground.regionOf({ x: 2.5, y: 3 })).toBe("a");
    // Just west of the wall, south of the doorway: "b" is nearer, but the wall is between, so it is "a"'s or "c"'s.
    expect(["a", "c"]).toContain(ground.regionOf({ x: WALL_W - 0.3, y: 2 }));
    // In the doorway's line of sight: east of the wall it is the east room's.
    expect(ground.regionOf({ x: WALL_E + 0.4, y: 3.5 })).toBe("b");
    // Off the floor: no area.
    expect(ground.regionOf({ x: -1, y: 3.5 })).toBeNull();
    expect(ground.regionOf({ x: 15, y: 3.5 })).toBeNull();
  });

  it("walks an edge as the straight line between its two nodes", () => {
    expect(ground.path("a", "b")).toEqual([node("a"), node("b")]);
    expect(ground.path("b", "a")).toEqual([node("b"), node("a")]);
    expect(ground.path("a", "nowhere")).toEqual([]);
  });
});

describe("a doorway two board edges cross, each with its own door", () => {
  // "e" sits in the west room so that its edge to "b" also runs through the doorway.
  const twoDoors = (extra: { a: string; b: string; door?: { id: string; lockable: boolean } }[] = []) =>
    FloorGraph.parse({
      ...board,
      nodes: [...board.nodes, { id: "e", x: 2, y: 3, roomId: "west", tags: [] }],
      edges: [...board.edges, { a: "e", b: "b", door: { id: "door:e:b", lockable: true } }, { a: "a", b: "e" }, ...extra],
      sightlines: { ...board.sightlines, e: ["a"] },
    });
  const both = ["door:a:b", "door:e:b"];

  it("puts both doors' bars in the one doorway", () => {
    const on = scanGround(twoDoors(), solid, { eye: new Map(), floor: new Map() });
    expect(on.doors.map((d) => d.doorId).sort()).toEqual(both);
    for (const d of on.doors) expect(distance(d.centre, DOORWAY)).toBeLessThan(0.3);
  });

  it("is shut while every door through it is locked, and open once one of them is picked", () => {
    const on = scanGround(twoDoors(), solid, { eye: new Map(), floor: new Map() });
    const at = (id: string) => on.nodes.get(id)!;
    expect(walk(on, at("a"), { x: 3, y: 0 }, 2, both).pos.x).toBeLessThan(WALL_W);
    expect(on.clear(at("a"), at("b"), both)).toBe(false);
    // "a"'s door picked: the doorway is open, though "e"'s door is still locked.
    expect(walk(on, at("a"), { x: 3, y: 0 }, 2, ["door:e:b"]).pos.x).toBeGreaterThan(WALL_E);
    expect(on.clear(at("a"), at("b"), ["door:e:b"])).toBe(true);
  });

  it("names the door on the edge out of the area the body stands in, from either side's area", () => {
    const on = scanGround(twoDoors(), solid, { eye: new Map(), floor: new Map() });
    const run = { locked: both } as unknown as RunState;
    // Facing east (+x), at the doorway's height, from inside "a"'s area and then from inside "e"'s.
    const inA: Vec = { x: 3.8, y: DOORWAY.y };
    const inE: Vec = { x: 1.6, y: DOORWAY.y - 0.6 };
    expect(on.regionOf(inA)).toBe("a");
    expect(on.regionOf(inE)).toBe("e");
    // Both doors' bars are in the line of the view from each place: the nearest alone can't name both.
    expect(doorInView(on, run, inA, 0)?.doorId).toBe("door:a:b");
    expect(doorInView(on, run, inE, Math.atan2(0.6, DOORWAY.x - inE.x), 4)?.doorId).toBe("door:e:b");
  });

  it("is open whatever is locked when an edge with no lock runs through it", () => {
    // "g" stands just inside the east room; its edge from "a" runs through the doorway with no door on it.
    const floor = FloorGraph.parse({
      ...twoDoors(),
      nodes: [...twoDoors().nodes, { id: "g", x: 7, y: 3.6, roomId: "east", tags: [] }],
      edges: [...twoDoors().edges, { a: "a", b: "g" }],
      sightlines: { ...twoDoors().sightlines, g: ["b"] },
    });
    const on = scanGround(floor, solid, { eye: new Map(), floor: new Map() });
    expect(walk(on, on.nodes.get("a")!, { x: 3, y: 0 }, 2, both).pos.x).toBeGreaterThan(WALL_E);
    expect(on.clear(on.nodes.get("a")!, on.nodes.get("b")!, both)).toBe(true);
  });
});

describe("the scan's ground over a solid that answers nothing", () => {
  // No mesh under any camera: the floor comes from the spots, or from the cameras' heights.
  const none: ScanSolid = { floorBelow: () => null, pushOut: (x, _y, z) => ({ x, z }), hit: () => null };

  it("puts the floor a camera's height under the cameras when the scan has no floor spots", () => {
    const eyesOnly: ScanHeights = { eye: heights(1.9).eye, floor: new Map() };
    expect(scanGround(board, none, eyesOnly).floorY).toBeCloseTo(0.4, 6);
  });
});
