// Which panoramas to fetch, sharpen and let go, and in what order (issue 118).
// Pure: positions and sets in, choices out.
//
// Every panorama's bytes are fetched once, nearest the player first, and a
// small cube of each stays on the GPU for good. The full-size ("sharp") cubes
// are too big for that, so only a handful are resident: the ones the player
// is at, and the ones they are heading for.
import type { Vec3 } from "./coords";
import { panoDistance } from "./skybox";

/** Every index, the nearest panorama to `eye` first. */
export function nearestFirst(positions: readonly Vec3[], eye: Vec3): number[] {
  return positions
    .map((p, i) => ({ i, d: panoDistance(eye, p) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(({ i }) => i);
}

export interface SharpQuery {
  positions: readonly Vec3[];
  eye: Vec3;
  /** The player's horizontal velocity, m/s: [x, z]. */
  velocity: readonly [number, number];
  /** The panoramas the scan recommends walking to from the one the player is nearest. */
  neighbours?: readonly number[];
  /** How far ahead to look, seconds. */
  horizon?: number;
}

/** Counted against a panorama that is near where the player will be, not where they are: metres. */
const AHEAD_HANDICAP = 0.3;
/** A recommended neighbour counts as this much nearer. */
const NEIGHBOUR_PULL = 0.85;

/**
 * Every index, the panorama most worth having sharp first. A panorama counts
 * as near when it is near the player now or near where they will be in
 * `horizon` seconds at their present velocity, so the cubes on the way are
 * ready before the player arrives; the scan's own neighbours of the nearest
 * panorama are pulled a little closer, since that is where its doors lead.
 */
export function sharpOrder(query: SharpQuery): number[] {
  const { positions, eye, velocity, neighbours = [], horizon = 1 } = query;
  const ahead: Vec3 = [eye[0] + velocity[0] * horizon, eye[1], eye[2] + velocity[1] * horizon];
  const moving = Math.hypot(velocity[0], velocity[1]) > 0.1;
  const pulled = new Set(neighbours);
  return positions
    .map((p, i) => {
      const now = panoDistance(eye, p);
      const then = moving ? panoDistance(ahead, p) + AHEAD_HANDICAP : Infinity;
      return { i, score: Math.min(now, then) * (pulled.has(i) ? NEIGHBOUR_PULL : 1) };
    })
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map(({ i }) => i);
}

export interface SharpPlan {
  /** The panorama to start sharpening now, or null. */
  start: number | null;
  /** A sharp cube to let go of now, to make room, or null. */
  drop: number | null;
}

/**
 * One step of keeping the right sharp cubes resident.
 *
 * `order` is `sharpOrder`'s; the first `want` of it are wanted. `have` holds
 * every panorama that has a sharp cube or is getting or losing one, and never
 * grows past `capacity`. A wanted panorama starts when its bytes are in
 * (`held`) and there is room. When there is none, the cube least worth
 * keeping goes, but only one that is not wanted: `want` is smaller than
 * `capacity`, so a player standing on the line between two panoramas does not
 * make the two take turns.
 */
export function planSharp(
  order: readonly number[],
  have: ReadonlySet<number>,
  held: (index: number) => boolean,
  capacity: number,
  want: number,
): SharpPlan {
  const wanted = order.slice(0, Math.max(0, Math.min(want, capacity)));
  const next = wanted.find((i) => !have.has(i) && held(i));
  if (next === undefined) return { start: null, drop: null };
  if (have.size < capacity) return { start: next, drop: null };
  const keep = new Set(wanted);
  for (let at = order.length - 1; at >= 0; at--) {
    const i = order[at];
    if (have.has(i) && !keep.has(i)) return { start: null, drop: i };
  }
  return { start: null, drop: null };
}
