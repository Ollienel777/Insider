// Which panorama paints a point of the scan, when the mesh also has its own
// texture to fall back on (issue 118). Pure, and the same sums as the
// shader's photo rule (app/spike/mesh/projection.ts).
//
// The picture should read as one photograph. So one panorama leads: the one
// the eye is nearest, kept until another is clearly nearer (no flipping back
// and forth on the line between two). It paints every point it saw. A point
// it did not see (its own depth cube says something stood in front) goes to
// the next panorama in line that did, and a point none of them saw keeps the
// mesh's texture. The lead changes by a short cross-fade, never a cut, and
// standing on a scan position the picture is that panorama alone.
//
// A panorama paints only what it saw well: a surface near it (its say fades
// out between `REACH_FULL` and `REACH_NONE` metres), not along the surface's
// own length, and not behind anything by its depth cube. Past that the
// surface keeps its texture: a photograph stretched over a wall from ten
// metres down the corridor is a smear, however sharp the photograph. And
// among the panoramas that did see a point well, the nearer and squarer one
// counts for more, so the lead does not paint alone what a neighbour saw
// better.
//
// A panorama counts for as much as its picture is worth. Each has a small
// cube from the start and a full-size one once it is near; the small one is
// coarser than the mesh's texture, so until the full-size cube has faded in
// a surface that has a texture keeps it rather than turn to a blur first.
import type { Vec3 } from "./coords";

/** Each rank's say: the lead, then the ones that paint only what the lead missed. */
export const PRIORITY: readonly number[] = [1, 0.4, 0.15, 0.05];
/** Another panorama takes the lead only when it is this much nearer the eye, metres. */
export const LEAD_MARGIN = 0.35;
/** A panorama keeps its place among those in use until one outside is this much nearer, metres. */
export const STAY_MARGIN = 0.15;
/** A panorama with a wall between it and the eye counts as this much farther, metres. */
export const BLOCKED = 3;

/** A point this much farther than the panorama saw in its direction (a part of the distance, and metres) is behind something... */
export const DEPTH_SCALE = 1.02;
export const DEPTH_SLACK = 0.05;
/** ...and over this many more metres the panorama's say falls to nothing. */
export const DEPTH_SOFT = 0.12;
/** The eye this close to a scan position stands on it: every point it sees, the panorama saw. Metres, full and none. */
export const ON_NEAR = 0.05;
export const ON_FAR = 0.45;
/** A surface seen at less than this cosine is too stretched in the panorama to use; at `GRAZE_FULL` it counts fully. */
export const GRAZE_NONE = 0.2;
export const GRAZE_FULL = 0.38;
/** A panorama paints a surface within `REACH_FULL` metres of it fully, and one past `REACH_NONE` not at all. */
export const REACH_FULL = 4.5;
export const REACH_NONE = 7.5;
/** At this many metres a panorama's picture of a surface counts half what it does up close. */
export const REACH_HALF = 3;
/** Standing on a scan position multiplies that panorama's say by one more than this: the picture there is its alone. */
export const ON_BOOST = 40;

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** How far the eye is from each panorama for the ranking: its distance, and `BLOCKED` more where `blocked` says a wall stands between. */
export function panoCosts(eye: Vec3, origins: readonly Vec3[], blocked: (index: number) => boolean = () => false): number[] {
  return origins.map((o, i) => Math.hypot(o[0] - eye[0], o[1] - eye[1], o[2] - eye[2]) + (blocked(i) ? BLOCKED : 0));
}

/**
 * The panoramas in use, the lead first: the `slots` cheapest by `costs`,
 * except that `previous` (last frame's answer) holds: its lead stays the
 * lead until another is `LEAD_MARGIN` cheaper, and its others stay in use
 * until one outside is `STAY_MARGIN` cheaper.
 */
export function rankPanos(costs: readonly number[], previous: readonly number[], slots: number): number[] {
  const lead = previous[0];
  const held = new Set(previous);
  const effective = costs.map((c, i) => c - (i === lead ? LEAD_MARGIN : 0) - (held.has(i) ? STAY_MARGIN : 0));
  return costs
    .map((_, i) => i)
    .filter((i) => Number.isFinite(effective[i]))
    .sort((a, b) => effective[a] - effective[b] || a - b)
    .slice(0, slots);
}

/** Each panorama's target say from the ranking: `PRIORITY` by rank, 0 for one not in use. */
export function priorities(count: number, ranked: readonly number[]): number[] {
  const out = new Array<number>(count).fill(0);
  ranked.forEach((index, rank) => {
    if (index < count) out[index] = PRIORITY[rank] ?? 0;
  });
  return out;
}

/** How much the eye stands on a scan position `distance` metres away: 1 on it, 0 from `ON_FAR`. */
export function standingOn(distance: number): number {
  return 1 - smoothstep(ON_NEAR, ON_FAR, distance);
}

/**
 * Whether a panorama saw a point `reach` metres from it, when its depth
 * cube says it could see `seenTo` metres that way: 1 when it did, 0 when the
 * point is behind what it saw, and soft in between.
 */
export function seenBy(reach: number, seenTo: number): number {
  const limit = seenTo * DEPTH_SCALE + DEPTH_SLACK;
  return 1 - smoothstep(limit, limit + DEPTH_SOFT, reach);
}

/** What a panorama's small cube counts for beside a surface's own texture: nothing. Its full-size cube counts fully. */
export const SMALL_CUBE = 0;

export interface PhotoSample {
  /** The panorama's say from its rank, eased over time (`PRIORITY`). */
  priority: number;
  /** `seenBy`. */
  seen: number;
  /**
   * The cosine between the surface's normal and the direction back to the
   * panorama, either way round: a wall the scan has one skin of is painted
   * on both faces by the panorama that saw the one.
   */
  facing: number;
  /**
   * `standingOn` for the eye and this panorama. It overrides the two above:
   * from the panorama's own position everything in view was seen, whatever
   * the depth cube's coarse texels say and however the surface slants.
   */
  on?: number;
  /**
   * How far the panorama's full-size cube has faded in, 0 to 1, for a
   * surface that has a texture of its own to show meanwhile. Leave out for a
   * surface with none: the small cube is then better than nothing.
   */
  sharp?: number;
  /** Metres from the panorama to the point. Left out, the panorama counts as beside it. */
  reach?: number;
}

export interface PhotoBlend {
  /** Each sample's part of the panoramas' colour, summing to 1 (all 0 when none has a say). */
  weights: number[];
  /** How much of the point is painted from the panoramas; the rest keeps the mesh's texture. */
  cover: number;
}

export function photoBlend(samples: readonly PhotoSample[]): PhotoBlend {
  const floor = PRIORITY[PRIORITY.length - 1];
  let cover = 0;
  const raw = samples.map((s) => {
    if (s.priority <= 0) return 0;
    const worth = SMALL_CUBE + (1 - SMALL_CUBE) * (s.sharp ?? 1);
    const reach = s.reach ?? 0;
    const on = s.on ?? 0;
    const near = 1 - smoothstep(REACH_FULL, REACH_NONE, reach);
    const usable = Math.max(s.seen * smoothstep(GRAZE_NONE, GRAZE_FULL, Math.abs(s.facing)) * near, on) * worth;
    // A panorama fading in or out of use takes its points with it.
    cover += usable * Math.min(1, s.priority / floor);
    // The nearer and the squarer its view of the point, the more its picture of it is worth.
    const view = (0.25 + Math.abs(s.facing)) / (1 + (reach / REACH_HALF) ** 2);
    // Standing on it, its picture is the eye's own view: as good as a picture gets.
    const quality = (view + (1.25 - view) * on) * (1 + ON_BOOST * on);
    return s.priority * usable * quality;
  });
  const total = raw.reduce((a, b) => a + b, 0);
  return { weights: total > 0 ? raw.map((w) => w / total) : raw.map(() => 0), cover: Math.min(1, cover) };
}
