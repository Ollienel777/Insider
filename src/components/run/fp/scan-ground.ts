// A live scan's floor as the `Ground` the first-person view stands on (issue
// 118), so the walker, the sight discs and the actors of the fixture floors
// (issue 115) walk a real building unchanged. Where world.ts builds walls
// from room rectangles, this reads the scan's own mesh:
//
// - The nodes are the board's: a scan's node ids are its sweep ids, and a
//   node's x and y are the sweep's x and z (adapters/matterport/mapping.ts),
//   which is the mesh's frame once it is y-up (lib/scan-mesh/coords.ts).
// - `collide` pushes the body out of the mesh's walls at floor level (the
//   capsule of spike/mesh/collider.ts), then out of each shut door, and never
//   takes a step that leaves the floor: off the mesh's floor, up or down a
//   storey, or too far from every scan position.
// - `clear` is a ray against the mesh at chest height, and the shut doors.
// - `path` is the straight line between two sweeps: they saw each other.
// - A node's area (`regionOf`, issue 136's areas) is the part of the floor
//   nearer it than any other node in clear view of the point: a scan has no
//   room rectangles to cut, and the mesh says what is in view, so an area
//   does not reach through a wall to a node in the next room. Every node is
//   looked at, not only the nearest few, since the nearest can all be behind
//   a wall. A shut door counts as a wall here, as it does for `clear`, so an
//   area never reaches across a locked door either; once the door opens, the
//   area behind it is in view again. A point with no node in view (a
//   walled-in pocket of the mesh) has no area: the walker then keeps the body
//   in the one it was in.
// - A scan has no door geometry. A door is an edge between two rooms
//   (`door:<sweepA>:<sweepB>`), so its leaf is a bar across that edge, put
//   where the way between the two sweeps is narrowest (the doorway) and as
//   wide as the gap there.
//
// Pure: the mesh comes in as `ScanSolid`, which the page answers from the
// scan's collision tree (scan-solid.ts) and the tests from made-up rooms.
import type { FloorGraph } from "@/domain";
import type { Collision, Ground, GroundDoor, GroundNode, Seg, Vec } from "./ground";
import { blocked, deflect, slide } from "./motion";

export type Vec3 = readonly [number, number, number];

/** What the scan view asks of the mesh. y-up, metres, as spike/mesh/collider.ts answers. */
export interface ScanSolid {
  /** The highest floor at (x, z) at or below `fromY` and no more than `depth` under it; null when there is none. */
  floorBelow(x: number, fromY: number, z: number, depth: number): number | null;
  /** Where an upright body of `radius` with its feet at `feetY` ends up once moved out of every wall. */
  pushOut(x: number, feetY: number, z: number, radius: number): { x: number; z: number };
  /** How far along the ray from `origin` in the unit direction `dir` the mesh is first hit, up to `far`; null when it isn't. */
  hit(origin: Vec3, dir: Vec3, far: number): number | null;
  /** As `hit`, for an eye: what can be seen through (glass) is no hit. Where absent, `hit`. */
  sight?(origin: Vec3, dir: Vec3, far: number): number | null;
}

/** Every number the scan's ground is tuned by. Metres. */
export const SCAN = Object.freeze({
  /** The body against the mesh: the free-walk sandbox's (lib/scan-mesh/movement.ts), slimmer than a fixture floor's. */
  radiusM: 0.25,
  /** The tallest step the feet climb. */
  stepUpM: 0.45,
  /** How far above or below the floor's own height the feet may go: past it is another storey. */
  riseM: 0.6,
  dropM: 1.0,
  /** No step goes further than this from every scan position: the mesh past it is not the scanned floor. */
  leashM: 4,
  /** Within this of a scan position, a hole in the mesh's floor is still floor. */
  holeM: 1.5,
  /** The line-of-sight ray's height above the floor: over a desk and a low partition, not a wall. */
  sightM: 1.4,
  /** The height a doorway's width is measured at, over the desks. */
  doorProbeM: 1.0,
  /** The furthest a door's bar reaches from the edge on either side. */
  doorReachM: 3,
  /** The spacing of the points along a door's edge where its gap is measured: under a thin partition's thickness. */
  doorProbeStepM: 0.04,
  /** How far beyond what it meets a door's bar goes, so the body cannot squeeze past its end. */
  doorOverlapM: 0.1,
});

export interface ScanGround extends Ground {
  /** The floor's own height: the median of the floor under each scan position, y-up. */
  floorY: number;
  /** The height of the floor under `p`, for the eye. */
  feetAt(p: Vec): number;
}

export interface ScanHeights {
  /** Node id → the scan camera's height there, y-up: where the floor is looked for under it. */
  eye: ReadonlyMap<string, number>;
  /** Node id → the scan's own floor spot height there, when it has one. */
  floor: ReadonlyMap<string, number>;
}

/** Whether the segments p–q and a–b cross. */
function crosses(p: Vec, q: Vec, a: Vec, b: Vec): boolean {
  const side = (u: Vec, v: Vec, w: Vec) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  return side(p, q, a) * side(p, q, b) < 0 && side(a, b, p) * side(a, b, q) < 0;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((p, q) => p - q);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The floor's height under each node: the mesh's floor below the scan camera, else the scan's floor spot. */
export function nodeFloors(floor: FloorGraph, solid: ScanSolid, heights: ScanHeights): Map<string, number> {
  const out = new Map<string, number>();
  for (const node of floor.nodes) {
    const eye = heights.eye.get(node.id);
    const spot = heights.floor.get(node.id);
    const found = eye === undefined ? null : solid.floorBelow(node.x, eye, node.y, 3);
    const y = found ?? spot;
    if (y !== undefined && y !== null) out.set(node.id, y);
  }
  return out;
}

/**
 * Where the shut door on the edge from `a` to `b` stands: a bar square to the
 * edge, at the point between 20% and 80% of the way along it where the gap
 * across is narrowest with the mesh on both sides (the doorway). Where no
 * point has the mesh on both sides within `doorReachM` (an open floor), it is
 * the narrowest anyway, as wide as it reaches.
 */
export function doorBar(a: Vec, b: Vec, solid: ScanSolid, probeY: number): { centre: Vec; bar: Seg } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const n = { x: -dy / length, y: dx / length };
  const reach = SCAN.doorReachM;
  let best: { c: Vec; plus: number; minus: number; score: number } | null = null;
  // Probed every few centimetres, so a thin partition's doorway is not stepped over.
  const probes = Math.min(400, Math.max(12, Math.ceil((0.6 * length) / SCAN.doorProbeStepM)));
  for (let i = 0; i <= probes; i++) {
    const t = 0.2 + (0.6 * i) / probes;
    const c = { x: a.x + dx * t, y: a.y + dy * t };
    const plus = solid.hit([c.x, probeY, c.y], [n.x, 0, n.y], reach);
    const minus = solid.hit([c.x, probeY, c.y], [-n.x, 0, -n.y], reach);
    const open = plus === null || minus === null;
    const score = (plus ?? reach) + (minus ?? reach) + (open ? 100 : 0) + Math.abs(t - 0.5) * 0.01;
    if (!best || score < best.score) best = { c, plus: plus ?? reach, minus: minus ?? reach, score };
  }
  const { c, plus, minus } = best!;
  const end = (side: number, d: number): Vec => ({ x: c.x + n.x * side * (d + SCAN.doorOverlapM), y: c.y + n.y * side * (d + SCAN.doorOverlapM) });
  const bar = { a: end(-1, minus), b: end(1, plus) };
  return { centre: { x: (bar.a.x + bar.b.x) / 2, y: (bar.a.y + bar.b.y) / 2 }, bar };
}

/**
 * The scan's `floor` (the board's own `FloorGraph`) as a `Ground`, over the
 * scan's mesh. `heights` places each node's floor; nodes the mesh has no floor
 * under take the floor's median height. `leashM` is how far from every scan
 * position a body may go (`SCAN.leashM` by default; a scan's plan, whose floor
 * already ends where it was scanned, reaches further).
 */
export function scanGround(floor: FloorGraph, solid: ScanSolid, heights: ScanHeights, options: { leashM?: number } = {}): ScanGround {
  const leashM = options.leashM ?? SCAN.leashM;
  const floors = nodeFloors(floor, solid, heights);
  const floorY = median([...floors.values()]) ?? median([...heights.eye.values()].map((y) => y - 1.5)) ?? 0;
  const nodes = new Map<string, GroundNode>(floor.nodes.map((n) => [n.id, { id: n.id, x: n.x, y: n.y }]));
  const all = [...nodes.values()];

  const doors: GroundDoor[] = [];
  for (const edge of floor.edges) {
    if (!edge.door?.lockable) continue;
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) continue;
    doors.push({ doorId: edge.door.id, ...doorBar(a, b, solid, floorY + SCAN.doorProbeM), a: edge.a, b: edge.b });
  }
  const barDoor = new Map<Seg, string>(doors.map((d) => [d.bar, d.doorId]));
  // Two board edges can cross one doorway, each with its own door. A doorway is shut only while
  // every edge through it is: the bar of a locked door stands only when no open edge crosses it.
  const through = new Map<string, (string | null)[]>(
    doors.map((d) => [
      d.doorId,
      floor.edges
        .filter((e) => {
          const a = nodes.get(e.a);
          const b = nodes.get(e.b);
          return a && b && crosses(a, b, d.bar.a, d.bar.b);
        })
        .map((e) => (e.door?.lockable ? e.door.id : null)),
    ]),
  );
  const shutCache = new Map<string, Seg[]>();
  const shut = (locked: readonly string[]): Seg[] => {
    const key = locked.join("|");
    let segs = shutCache.get(key);
    if (!segs) {
      const set = new Set(locked);
      segs = doors
        .filter((d) => set.has(d.doorId) && (through.get(d.doorId) ?? []).every((id) => id === d.doorId || (id !== null && set.has(id))))
        .map((d) => d.bar);
      shutCache.set(key, segs);
    }
    return segs;
  };

  const nearestNode = (p: Vec): number => {
    let best = Infinity;
    for (const n of all) best = Math.min(best, Math.hypot(n.x - p.x, n.y - p.y));
    return best;
  };
  /** The floor under `p` within the storey's band, or null over a hole. */
  const floorAt = (p: Vec): number | null => {
    const y = solid.floorBelow(p.x, floorY + SCAN.riseM, p.y, SCAN.riseM + SCAN.dropM);
    return y;
  };
  const feetAt = (p: Vec): number => floorAt(p) ?? floorY;
  /** Whether the mesh leaves the line from `p` to `q` clear at chest height. Doors are not walls here: `clear` and `regionOf` add the shut ones. */
  const inView = (p: Vec, q: Vec, eye = false): boolean => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const far = Math.hypot(dx, dy);
    if (far < 1e-6) return true;
    const ray = eye && solid.sight ? solid.sight.bind(solid) : solid.hit.bind(solid);
    const hit = ray([p.x, floorY + SCAN.sightM, p.y], [dx / far, 0, dy / far], far);
    return hit === null || hit >= far - 0.05;
  };
  /** Whether a body may stand at `p`: near the scan's positions, over the floor or close enough to a position that a hole is still floor. */
  const standable = (p: Vec): boolean => {
    const near = nearestNode(p);
    if (near > leashM) return false;
    return floorAt(p) !== null || near <= SCAN.holeM;
  };

  return {
    // A scan's board is in metres already.
    unitM: 1,
    nodes,
    doors,
    floorY,
    feetAt,
    collide(pos, vel, dt, locked): Collision {
      const bars = shut(locked);
      const r = SCAN.radiusM;
      const delta = { x: vel.x * dt, y: vel.y * dt };
      const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.y) / (r * 0.5)));
      let p = { x: pos.x, y: pos.y };
      let feet = feetAt(p);
      const normals: { n: Vec }[] = [];
      const pressed: { doorId: string; n: Vec }[] = [];
      let stopped = false;
      for (let i = 0; i < steps; i++) {
        const want = { x: p.x + delta.x / steps, y: p.y + delta.y / steps };
        const out = solid.pushOut(want.x, feet, want.y, r);
        const push = { x: out.x - want.x, y: out.z - want.y };
        const pushed = Math.hypot(push.x, push.y);
        if (pushed > 1e-9) normals.push({ n: { x: push.x / pushed, y: push.y / pushed } });
        let q = { x: out.x, y: out.z };
        if (bars.length > 0) {
          const moved = slide(p, { x: q.x - p.x, y: q.y - p.y }, bars, r);
          q = moved.pos;
          for (const { seg, n } of moved.touched) {
            normals.push({ n });
            const doorId = barDoor.get(seg);
            if (doorId !== undefined && !pressed.some((d) => d.doorId === doorId)) pressed.push({ doorId, n });
          }
        }
        // Never off the floor: a step that would leave it is not taken.
        if (!standable(q)) {
          stopped = true;
          break;
        }
        p = q;
        feet = feetAt(p);
      }
      const v = stopped ? { x: 0, y: 0 } : deflect(vel, normals);
      return { pos: p, vel: v, pressed };
    },
    clear: (p, q, locked) => !blocked(shut(locked), p, q) && inView(p, q, true),
    regionOf(pos, locked = []) {
      if (!standable(pos)) return null;
      const bars = shut(locked);
      const byDistance = all.map((n) => ({ n, d: Math.hypot(n.x - pos.x, n.y - pos.y) })).sort((p, q) => p.d - q.d);
      // The nearest node in view, of all of them. With none in view (pressed into a walled-in pocket of the
      // mesh), no area: never the nearest node through a wall, which would move the engine into the next room.
      // A shut door is a wall here too, as in `clear`: a node behind a locked door is not in view.
      for (const { n } of byDistance) if (!blocked(bars, pos, n) && inView(pos, n)) return n.id;
      return null;
    },
    path(a, b) {
      const from = nodes.get(a);
      const to = nodes.get(b);
      return from && to ? [{ x: from.x, y: from.y }, { x: to.x, y: to.y }] : [];
    },
  };
}
