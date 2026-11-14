// A live scan as the first-person view's `Ground` (ground.ts, issue 118).
// The walker and the actors are the fixture floors' own; only the floor
// under them changes. Everything here is in the scan's ground plane, metres:
// a `Vec`'s x is the scan's x and its y the scan's z (y-up frame).
//
// - The nodes are the board's, carried into the scan by the plan-to-scan fit
//   (scan-fit.ts). A similarity keeps which node is nearest, so the areas cut
//   here are the plan's areas carried over: the engine's moves are still
//   decided on the plan, through the fit.
// - Bodies move against the scan's mesh (`MoveWorld`: its floor and walls)
//   and against each shut door's face.
// - A node's area is the part of the floor nearer it than any node in clear
//   view of the point, so an area does not reach through a wall to a node in
//   the next room. The mesh decides what is in view (`see`).
// - A door is drawn across the board's edge, midway between its nodes: a
//   scan says where its sweeps are, not where its door frames stand.
//
// Pure: no DOM, no three.js. The view hands in the mesh's two questions and a
// line-of-sight test over it; the tests hand in made-up rooms.
import type { FloorGraph } from "@/domain";
import type { MoveWorld } from "@/lib/scan-mesh/movement";
import type { Collision, Ground, GroundDoor, GroundNode, Seg, Vec } from "./ground";
import { toScan, type PlanToScan } from "./scan-fit";
import { FP } from "./tuning";

export interface ScanGroundOptions {
  floor: FloorGraph;
  fit: PlanToScan;
  world: MoveWorld;
  /** Whether nothing in the mesh stands between `p` and `q` at a body's chest height over feet at `y`. */
  see(p: Vec, q: Vec, y: number): boolean;
  /** Doors drawn and shut when the run locks them: every lockable one, and any the run starts locked. */
  doorIds: ReadonlySet<string>;
  /** Where the feet start, y-up height. */
  feetY: number;
}

export interface ScanGround extends Ground {
  /** The height of the feet after the last `collide`: where the view stands its eye. */
  readonly feetY: number;
  /** The floor's height under the board's nodes, and under the feet: for the actors to stand on. */
  floorUnder(p: Vec): number;
}

/** The body's radius against the scan's walls: a doorway in a scan is often narrower than ours. */
export const SCAN_RADIUS_M = 0.25;
/** The tallest step the feet climb. */
const STEP_UP_M = 0.45;
/** The deepest drop the feet follow; a step past it is not taken. */
const MAX_DROP_M = 1.2;
/** No single move longer than this, so nothing tunnels through a wall. */
const SUB_STEP_M = SCAN_RADIUS_M / 2;
/** How many of the nearest nodes are tried for a clear line before the nearest is taken anyway. */
const AREA_TRIES = 5;

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const len = (a: Vec) => Math.hypot(a.x, a.y);

/** The point on `s` nearest `p`. */
function nearestOn(s: Seg, p: Vec): Vec {
  const d = sub(s.b, s.a);
  const l2 = dot(d, d);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, s.a), d) / l2));
  return { x: s.a.x + d.x * t, y: s.a.y + d.y * t };
}

/** Whether segments pq and s cross. */
function crosses(p: Vec, q: Vec, s: Seg): boolean {
  const o = (a: Vec, b: Vec, c: Vec) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p, q, s.a) !== o(p, q, s.b) && o(s.a, s.b, p) !== o(s.a, s.b, q);
}

/** The board's doors as faces across their edges, in the scan. */
export function scanDoors(floor: FloorGraph, at: ReadonlyMap<string, Vec>, doorIds: ReadonlySet<string>): GroundDoor[] {
  const half = FP.doorWidthM / 2;
  return floor.edges.flatMap((edge) => {
    if (!edge.door || !doorIds.has(edge.door.id)) return [];
    const a = at.get(edge.a);
    const b = at.get(edge.b);
    if (!a || !b) return [];
    const d = sub(b, a);
    const l = len(d) || 1;
    const across = { x: -d.y / l, y: d.x / l };
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const bar = { a: { x: centre.x - across.x * half, y: centre.y - across.y * half }, b: { x: centre.x + across.x * half, y: centre.y + across.y * half } };
    return [{ doorId: edge.door.id, centre, bar, a: edge.a, b: edge.b }];
  });
}

/** The board's nodes, carried into the scan. */
export function scanNodes(floor: FloorGraph, fit: PlanToScan): Map<string, GroundNode> {
  return new Map(floor.nodes.map((n) => [n.id, { id: n.id, ...toScan(fit, n) }]));
}

export function createScanGround(options: ScanGroundOptions): ScanGround {
  const { floor, fit, world, see, doorIds } = options;
  const nodes = scanNodes(floor, fit);
  const doors = scanDoors(floor, nodes, doorIds);
  let feetY = options.feetY;
  const list = [...nodes.values()];

  /** Out of each shut door's face, and which pushed. */
  const outOfDoors = (p: Vec, locked: readonly string[]) => {
    let pos = p;
    const pressed: { doorId: string; n: Vec }[] = [];
    for (const door of doors) {
      if (!locked.includes(door.doorId)) continue;
      const on = nearestOn(door.bar, pos);
      const away = sub(pos, on);
      const d = len(away);
      if (d >= SCAN_RADIUS_M) continue;
      // Exactly on the face: push back the way the door's near node lies.
      const n = d > 1e-9 ? { x: away.x / d, y: away.y / d } : (() => {
        const home = nodes.get(door.a)!;
        const back = sub(home, door.centre);
        const l = len(back) || 1;
        return { x: back.x / l, y: back.y / l };
      })();
      pos = { x: on.x + n.x * SCAN_RADIUS_M, y: on.y + n.y * SCAN_RADIUS_M };
      pressed.push({ doorId: door.doorId, n });
    }
    return { pos, pressed };
  };

  const floorUnder = (p: Vec): number => world.floorBelow(p.x, feetY + STEP_UP_M, p.y, MAX_DROP_M + STEP_UP_M) ?? feetY;

  const ground: ScanGround = {
    get feetY() {
      return feetY;
    },
    unitM: fit.scale,
    nodes,
    doors,
    floorUnder,
    collide(pos: Vec, vel: Vec, dt: number, locked: readonly string[]): Collision {
      const total = { x: vel.x * dt, y: vel.y * dt };
      const steps = Math.max(1, Math.ceil(len(total) / SUB_STEP_M));
      let at = pos;
      const pressed = new Map<string, Vec>();
      for (let i = 0; i < steps; i++) {
        const want = { x: at.x + total.x / steps, y: at.y + total.y / steps };
        const walled = world.pushOut(want.x, feetY, want.y, SCAN_RADIUS_M);
        const doored = outOfDoors({ x: walled.x, y: walled.z }, locked);
        for (const { doorId, n } of doored.pressed) pressed.set(doorId, n);
        const next = doored.pos;
        const under = world.floorBelow(next.x, feetY + STEP_UP_M, next.y, MAX_DROP_M + STEP_UP_M);
        // No floor there (a hole in the mesh, a balcony's edge): the step is not taken.
        if (under === null) break;
        feetY = under;
        at = next;
      }
      // What is left of the velocity once what pushed into something solid is taken out.
      const went = sub(at, pos);
      const out = dt > 0 ? { x: went.x / dt, y: went.y / dt } : { x: 0, y: 0 };
      // Never faster than asked: a push out of a corner does not speed the body up.
      const speed = len(out);
      const cap = len(vel);
      const v = speed > cap ? { x: (out.x / speed) * cap, y: (out.y / speed) * cap } : out;
      return { pos: at, vel: v, pressed: [...pressed].map(([doorId, n]) => ({ doorId, n })) };
    },
    clear(p: Vec, q: Vec, locked: readonly string[]): boolean {
      for (const door of doors) if (locked.includes(door.doorId) && crosses(p, q, door.bar)) return false;
      return see(p, q, feetY);
    },
    path(a: string, b: string): Vec[] {
      const p = nodes.get(a);
      const q = nodes.get(b);
      return p && q ? [{ x: p.x, y: p.y }, { x: q.x, y: q.y }] : [];
    },
    regionOf(pos: Vec): string | null {
      let best: GroundNode | null = null;
      let bestD = Infinity;
      const near: { node: GroundNode; d: number }[] = [];
      for (const node of list) {
        const d = Math.hypot(node.x - pos.x, node.y - pos.y);
        if (d < bestD) {
          bestD = d;
          best = node;
        }
        near.push({ node, d });
      }
      if (!best) return null;
      near.sort((p, q) => p.d - q.d);
      for (const { node } of near.slice(0, AREA_TRIES)) if (see(pos, node, feetY)) return node.id;
      return best.id;
    },
  };
  return ground;
}

/** Each camera's mount and the middle of what it covers, carried into the scan (`Marks.cameras`). */
export function scanCameraMarks(
  floor: FloorGraph,
  fit: PlanToScan,
  cameras: readonly { id: string; parts: readonly (readonly string[])[] }[],
  mount: (cover: string[]) => Vec,
): { id: string; mount: Vec; looksAt: Vec }[] {
  const at = new Map(floor.nodes.map((n) => [n.id, n]));
  return cameras.flatMap((c) => {
    const cover = c.parts.flat();
    const seen = cover.flatMap((id) => (at.has(id) ? [at.get(id)!] : []));
    if (seen.length === 0) return [];
    const middle = { x: seen.reduce((s, n) => s + n.x, 0) / seen.length, y: seen.reduce((s, n) => s + n.y, 0) / seen.length };
    return [{ id: c.id, mount: toScan(fit, mount(cover)), looksAt: toScan(fit, middle) }];
  });
}
