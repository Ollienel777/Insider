// How the player moves in first person (issue 115): a shooter's feet. Speed is
// constant, the same in every direction; starting and stopping take a few
// frames; nothing drifts. The body is a circle that slides along walls. Pure:
// no DOM, no renderer, no clock but the `dt` it is given.
import { FP } from "./tuning";
import type { Seg, Vec } from "./ground";

/** What the keys ask for: forwards and sideways from -1 to 1, and whether Shift is held. */
export interface Wish {
  forward: number;
  strafe: number;
  walk: boolean;
}

/** The view's forward direction on the floor plan: yaw 0 looks east, and it grows turning right. */
export const facing = (yaw: number): Vec => ({ x: Math.cos(yaw), y: Math.sin(yaw) });

/**
 * The velocity the keys ask for. Forward and strafe together are normalised,
 * so a diagonal is no faster than straight ahead.
 */
export function wishVelocity(wish: Wish, yaw: number): Vec {
  const f = facing(yaw);
  const x = f.x * wish.forward - f.y * wish.strafe;
  const y = f.y * wish.forward + f.x * wish.strafe;
  const length = Math.hypot(x, y);
  if (length < 1e-9) return { x: 0, y: 0 };
  const speed = wish.walk ? FP.walkMps : FP.runMps;
  return { x: (x / length) * speed, y: (y / length) * speed };
}

/**
 * `vel` after `dt` of heading for `wish`: it closes on the wished velocity at
 * `accelMps2`, or at `stopMps2` when no key is held, and lands on it exactly
 * rather than easing towards it, so there is no float at either end.
 */
export function accelerate(vel: Vec, wish: Vec, dt: number): Vec {
  const stopping = wish.x === 0 && wish.y === 0;
  const dx = wish.x - vel.x;
  const dy = wish.y - vel.y;
  const gap = Math.hypot(dx, dy);
  const step = (stopping ? FP.stopMps2 : FP.accelMps2) * dt;
  if (gap <= step) return { x: wish.x, y: wish.y };
  return { x: vel.x + (dx / gap) * step, y: vel.y + (dy / gap) * step };
}

/** The point of `seg` nearest `p`. */
export function nearestOn(seg: Seg, p: Vec): Vec {
  const ex = seg.b.x - seg.a.x;
  const ey = seg.b.y - seg.a.y;
  const length2 = ex * ex + ey * ey;
  const k = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - seg.a.x) * ex + (p.y - seg.a.y) * ey) / length2));
  return { x: seg.a.x + ex * k, y: seg.a.y + ey * k };
}

export const distanceTo = (seg: Seg, p: Vec): number => {
  const q = nearestOn(seg, p);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

/** Whether the straight line from `p` to `q` crosses any of `segs`: a wall is in the way. */
export function blocked(segs: readonly Seg[], p: Vec, q: Vec): boolean {
  const side = (a: Vec, b: Vec, c: Vec) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const s of segs) {
    const d1 = side(p, q, s.a);
    const d2 = side(p, q, s.b);
    const d3 = side(s.a, s.b, p);
    const d4 = side(s.a, s.b, q);
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  }
  return false;
}

/** How deep a touch counts as inside a wall rather than against it. */
const SKIN = 1e-3;

export interface Slide {
  pos: Vec;
  /** What the body touched on the way, each with the direction it was pushed back in. */
  touched: { seg: Seg; n: Vec }[];
}

/**
 * Moves a circle of `radius` from `pos` by `delta`, sliding along whatever it
 * meets. It never tunnels: the move is cut into steps of at most half the
 * radius, each one pushed back out of every wall it enters, and a step that
 * cannot be pushed clear (a pinch between two walls) is not taken.
 */
export function slide(pos: Vec, delta: Vec, segs: readonly Seg[], radius: number = FP.radiusM): Slide {
  const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.y) / (radius * 0.5)));
  const touched: { seg: Seg; n: Vec }[] = [];
  let p = { x: pos.x, y: pos.y };
  const startedClear = clear(p, segs, radius);
  for (let i = 0; i < steps; i++) {
    const before = p;
    p = { x: p.x + delta.x / steps, y: p.y + delta.y / steps };
    for (let pass = 0; pass < 4; pass++) {
      let pushed = false;
      for (const seg of segs) {
        const q = nearestOn(seg, p);
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const d = Math.hypot(dx, dy);
        if (d >= radius) continue;
        let n: Vec;
        if (d > 1e-9) {
          n = { x: dx / d, y: dy / d };
        } else {
          // Dead on the wall: back the way it came, square to the wall.
          const ex = seg.b.x - seg.a.x;
          const ey = seg.b.y - seg.a.y;
          const length = Math.hypot(ex, ey) || 1;
          const nx = -ey / length;
          const ny = ex / length;
          const back = (before.x - q.x) * nx + (before.y - q.y) * ny >= 0 ? 1 : -1;
          n = { x: nx * back, y: ny * back };
        }
        p = { x: q.x + n.x * radius, y: q.y + n.y * radius };
        touched.push({ seg, n });
        pushed = true;
      }
      if (!pushed) break;
    }
    // Still inside something after pushing: do not take the step. A body that started inside a
    // wall (a door shut on it) is let out instead.
    if (startedClear && !clear(p, segs, radius)) {
      p = before;
      break;
    }
  }
  return { pos: p, touched };
}

function clear(p: Vec, segs: readonly Seg[], radius: number): boolean {
  for (const seg of segs) if (distanceTo(seg, p) < radius - SKIN) return false;
  return true;
}

/** `vel` with the part that pushes into each touched wall taken out, so the rest slides along it. */
export function deflect(vel: Vec, touched: readonly { n: Vec }[]): Vec {
  let v = vel;
  for (const { n } of touched) {
    const into = v.x * n.x + v.y * n.y;
    if (into < 0) v = { x: v.x - into * n.x, y: v.y - into * n.y };
  }
  return v;
}
