// The first-person view's world (issue 115), built from the level's own
// `FloorGraph`: every room rectangle becomes four walls, every edge between
// two rooms a doorway through them. Pure geometry in metres, with no DOM and
// no renderer: the movement layer collides with it and the renderer draws it,
// so what stops the player is what they see.
//
// The floor plan's x runs east and its y south; the renderer puts y on its z.
import type { FloorGraph } from "@/domain";
import type { Ground, Seg, Vec } from "./ground";
import { blocked, deflect, slide } from "./motion";
import { FP } from "./tuning";

export type { Seg, Vec } from "./ground";

/** A wall face with the side it is seen from: `n` points into the room or doorway. */
export interface Face extends Seg {
  n: Vec;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldRoom {
  id: string;
  label: string;
  /** The room's rectangle on the plan. */
  outer: Rect;
  /** The floor a player can stand on: `outer` less half a wall on every side. */
  inner: Rect;
}

export interface WorldNode extends Vec {
  id: string;
  roomId: string;
}

/** A way through the walls between two rooms: a door, or an open boundary. */
export interface Opening {
  /** The door's id; null where an edge joins two rooms with no door. */
  doorId: string | null;
  lockable: boolean;
  /** The edge's nodes, `a` in `roomA`. */
  a: string;
  b: string;
  roomA: string;
  roomB: string;
  /** The way through runs along this axis; the walls it cuts run along the other. */
  axis: "x" | "y";
  centre: Vec;
  width: number;
  /** The floor between the two rooms' wall faces. */
  passage: Rect;
  jambs: readonly [Face, Face];
  /** Across the middle of the doorway: solid while the door is locked. */
  bar: Seg;
  /** A place to stand just inside each room, square on to the door. */
  sideA: Vec;
  sideB: Vec;
}

export interface World {
  rooms: readonly WorldRoom[];
  nodes: ReadonlyMap<string, WorldNode>;
  /** The rooms' walls, with every doorway cut out. */
  walls: readonly Face[];
  openings: readonly Opening[];
  bounds: Rect;
  /** Edges between rooms that no doorway could be cut for; none on the fixture floors. */
  unplaced: readonly { a: string; b: string }[];
}

/** The gap kept between a doorway and the end of the wall it is cut in. */
const DOOR_MARGIN = 0.05;
/** How far inside a room `sideA` and `sideB` stand from its wall. */
const STAND = FP.radiusM + 0.15;

const scale = (r: Rect): Rect => ({ x: r.x * FP.unitM, y: r.y * FP.unitM, w: r.w * FP.unitM, h: r.h * FP.unitM });
const inset = (r: Rect, by: number): Rect => ({ x: r.x + by, y: r.y + by, w: r.w - 2 * by, h: r.h - 2 * by });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Side = "north" | "south" | "west" | "east";

/** Builds the world for `floor`. Deterministic: the same floor gives the same walls. */
export function buildWorld(floor: FloorGraph): World {
  const rooms: WorldRoom[] = floor.rooms.map((room) => {
    const outer = scale(room.rect);
    return { id: room.id, label: room.label, outer, inner: inset(outer, FP.wallHalfM) };
  });
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const nodes = new Map<string, WorldNode>(
    floor.nodes.map((n) => [n.id, { id: n.id, roomId: n.roomId, x: n.x * FP.unitM, y: n.y * FP.unitM }]),
  );

  const openings: Opening[] = [];
  const unplaced: { a: string; b: string }[] = [];
  /** Room id → side → the stretches of that wall a doorway takes out. */
  const gaps = new Map<string, Record<Side, [number, number][]>>(
    rooms.map((r) => [r.id, { north: [], south: [], west: [], east: [] }]),
  );

  for (const edge of floor.edges) {
    const a = nodes.get(edge.a)!;
    const b = nodes.get(edge.b)!;
    if (a.roomId === b.roomId) continue;
    const placed = placeOpening(roomById.get(a.roomId)!, roomById.get(b.roomId)!, a, b, edge.door === undefined);
    if (!placed) {
      unplaced.push({ a: edge.a, b: edge.b });
      continue;
    }
    const { axis, from, to, cross, width, lowIsA } = placed;
    const half = width / 2;
    const mid = (from + to) / 2;
    const at = (along: number, across: number): Vec => (axis === "x" ? { x: along, y: across } : { x: across, y: along });
    const low = lowIsA ? a.roomId : b.roomId;
    const high = lowIsA ? b.roomId : a.roomId;
    gaps.get(low)![axis === "x" ? "east" : "south"].push([cross - half, cross + half]);
    gaps.get(high)![axis === "x" ? "west" : "north"].push([cross - half, cross + half]);
    const towards = (sign: 1 | -1): Vec => (axis === "x" ? { x: 0, y: sign } : { x: sign, y: 0 });
    const lowSide = at(from - STAND, cross);
    const highSide = at(to + STAND, cross);
    openings.push({
      doorId: edge.door?.id ?? null,
      lockable: edge.door?.lockable ?? false,
      a: edge.a,
      b: edge.b,
      roomA: a.roomId,
      roomB: b.roomId,
      axis,
      centre: at(mid, cross),
      width,
      passage: axis === "x" ? { x: from, y: cross - half, w: to - from, h: width } : { x: cross - half, y: from, w: width, h: to - from },
      jambs: [
        { a: at(from, cross - half), b: at(to, cross - half), n: towards(1) },
        { a: at(from, cross + half), b: at(to, cross + half), n: towards(-1) },
      ],
      bar: { a: at(mid, cross - half), b: at(mid, cross + half) },
      sideA: lowIsA ? lowSide : highSide,
      sideB: lowIsA ? highSide : lowSide,
    });
  }

  const walls: Face[] = [];
  for (const room of rooms) {
    const { x, y, w, h } = room.inner;
    const cut = gaps.get(room.id)!;
    for (const [lo, hi] of solid(x, x + w, cut.north)) walls.push({ a: { x: lo, y }, b: { x: hi, y }, n: { x: 0, y: 1 } });
    for (const [lo, hi] of solid(x, x + w, cut.south)) walls.push({ a: { x: lo, y: y + h }, b: { x: hi, y: y + h }, n: { x: 0, y: -1 } });
    for (const [lo, hi] of solid(y, y + h, cut.west)) walls.push({ a: { x, y: lo }, b: { x, y: hi }, n: { x: 1, y: 0 } });
    for (const [lo, hi] of solid(y, y + h, cut.east)) walls.push({ a: { x: x + w, y: lo }, b: { x: x + w, y: hi }, n: { x: -1, y: 0 } });
  }

  const x0 = Math.min(...rooms.map((r) => r.outer.x));
  const y0 = Math.min(...rooms.map((r) => r.outer.y));
  const x1 = Math.max(...rooms.map((r) => r.outer.x + r.outer.w));
  const y1 = Math.max(...rooms.map((r) => r.outer.y + r.outer.h));
  return { rooms, nodes, walls, openings, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, unplaced };
}

/**
 * Where the doorway between rooms `A` and `B` goes: through the walls that
 * face each other, as near as it fits to where the edge `a`–`b` crosses them.
 * Two rooms apart on the plan (a thick wall between them) get a longer way
 * through. Null when the rooms face each other along no wall wide enough.
 */
function placeOpening(
  A: WorldRoom,
  B: WorldRoom,
  a: Vec,
  b: Vec,
  open: boolean,
): { axis: "x" | "y"; from: number; to: number; cross: number; width: number; lowIsA: boolean } | null {
  const eps = 1e-6;
  const t = FP.wallHalfM;
  const ra = A.outer;
  const rb = B.outer;
  const spanY: [number, number] = [Math.max(ra.y, rb.y), Math.min(ra.y + ra.h, rb.y + rb.h)];
  const spanX: [number, number] = [Math.max(ra.x, rb.x), Math.min(ra.x + ra.w, rb.x + rb.w)];
  const options: { axis: "x" | "y"; from: number; to: number; span: [number, number]; lowIsA: boolean }[] = [];
  if (ra.x + ra.w <= rb.x + eps) options.push({ axis: "x", from: ra.x + ra.w - t, to: rb.x + t, span: spanY, lowIsA: true });
  if (rb.x + rb.w <= ra.x + eps) options.push({ axis: "x", from: rb.x + rb.w - t, to: ra.x + t, span: spanY, lowIsA: false });
  if (ra.y + ra.h <= rb.y + eps) options.push({ axis: "y", from: ra.y + ra.h - t, to: rb.y + t, span: spanX, lowIsA: true });
  if (rb.y + rb.h <= ra.y + eps) options.push({ axis: "y", from: rb.y + rb.h - t, to: ra.y + t, span: spanX, lowIsA: false });
  options.sort((p, q) => q.span[1] - q.span[0] - (p.span[1] - p.span[0]));
  const best = options[0];
  if (!best) return null;
  const lo = best.span[0] + t + DOOR_MARGIN;
  const hi = best.span[1] - t - DOOR_MARGIN;
  const room = hi - lo;
  if (room < 2 * FP.radiusM + 0.1) return null;
  // A door is a door's width; an open boundary takes the whole shared wall.
  const width = open ? room : Math.min(FP.doorWidthM, room);
  const along = (p: Vec) => (best.axis === "x" ? p.x : p.y);
  const across = (p: Vec) => (best.axis === "x" ? p.y : p.x);
  const mid = (best.from + best.to) / 2;
  const run = along(b) - along(a);
  const k = Math.abs(run) < eps ? 0.5 : clamp((mid - along(a)) / run, 0, 1);
  const cross = clamp(across(a) + k * (across(b) - across(a)), lo + width / 2, hi - width / 2);
  return { axis: best.axis, from: best.from, to: best.to, cross, width, lowIsA: best.lowIsA };
}

/** The stretches of `lo`–`hi` left once `gaps` are taken out. */
function solid(lo: number, hi: number, gaps: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let from = lo;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > from) out.push([from, Math.min(g0, hi)]);
    from = Math.max(from, g1);
  }
  if (from < hi) out.push([from, hi]);
  return out.filter(([s, e]) => e - s > 1e-9);
}

const solidsCache = new WeakMap<World, Map<string, readonly Seg[]>>();

/**
 * Everything that stops the player: the walls, every doorway's jambs, and the
 * door itself across each doorway whose door is in `locked` (the run's own
 * list, so a door the engine opens is open here on the same turn).
 */
export function solids(world: World, locked: readonly string[]): readonly Seg[] {
  const key = locked.join("|");
  let byKey = solidsCache.get(world);
  if (!byKey) solidsCache.set(world, (byKey = new Map()));
  let segs = byKey.get(key);
  if (!segs) {
    const shut = new Set(locked);
    segs = [
      ...world.walls,
      ...world.openings.flatMap((o) => [...o.jambs, ...(o.doorId !== null && shut.has(o.doorId) ? [o.bar] : [])]),
    ];
    byKey.set(key, segs);
  }
  return segs;
}

const within = (r: Rect, p: Vec, slack: number) =>
  p.x >= r.x - slack && p.x <= r.x + r.w + slack && p.y >= r.y - slack && p.y <= r.y + r.h + slack;

/** Whether `p` is on the floor: inside a room's walls or in a doorway. */
export function onFloor(world: World, p: Vec, slack = 1e-6): boolean {
  return world.rooms.some((r) => within(r.inner, p, slack)) || world.openings.some((o) => within(o.passage, p, slack));
}

/** The room whose floor `p` is on; in a doorway, null. */
export function roomAt(world: World, p: Vec): WorldRoom | null {
  return world.rooms.find((r) => within(r.inner, p, 1e-6)) ?? null;
}

/** The doorway the edge between nodes `a` and `b` goes through, if it goes through one. */
export function openingBetween(world: World, a: string, b: string): Opening | null {
  return world.openings.find((o) => (o.a === a && o.b === b) || (o.a === b && o.b === a)) ?? null;
}

/**
 * The way to walk the edge from node `a` to node `b`: straight across a room,
 * or to the doorway, through it and on. A guard glides along this, so it
 * goes through the door the engine's edge names and not through the wall.
 */
export function edgePath(world: World, a: string, b: string): Vec[] {
  const from = world.nodes.get(a);
  const to = world.nodes.get(b);
  if (!from || !to) return [];
  const p = { x: from.x, y: from.y };
  const q = { x: to.x, y: to.y };
  const opening = openingBetween(world, a, b);
  if (!opening) return [p, q];
  return opening.a === a ? [p, opening.sideA, opening.sideB, q] : [p, opening.sideB, opening.sideA, q];
}

/**
 * The fixture floor as the `Ground` the walker and the actors stand on
 * (ground.ts): its nodes, its lockable doors, and collision against its
 * walls. This is the only place the room rectangles meet the movement layer.
 */
export function groundOf(world: World): Ground {
  const barDoor = new Map<Seg, string>(world.openings.flatMap((o) => (o.doorId === null ? [] : [[o.bar, o.doorId] as const])));
  return {
    nodes: world.nodes,
    doors: world.openings.flatMap((o) => (o.doorId === null ? [] : [{ doorId: o.doorId, centre: o.centre, bar: o.bar }])),
    collide(pos, vel, dt, locked) {
      const moved = slide(pos, { x: vel.x * dt, y: vel.y * dt }, solids(world, locked));
      // Never off the floor: a step that would leave it is not taken.
      if (!onFloor(world, moved.pos)) return { pos, vel: { x: 0, y: 0 }, pressed: [] };
      const pressed = moved.touched.flatMap(({ seg, n }) => {
        const doorId = barDoor.get(seg);
        return doorId === undefined ? [] : [{ doorId, n }];
      });
      return { pos: moved.pos, vel: deflect(vel, moved.touched), pressed };
    },
    clear: (p, q, locked) => !blocked(solids(world, locked), p, q),
    path: (a, b) => edgePath(world, a, b),
  };
}
