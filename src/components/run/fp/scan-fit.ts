// The floor plan's place in the scan (issue 118): a live-scan board's nodes
// are its sweeps, so each node's plan position (x, y) and that sweep's place
// in the scan's mesh (x, z of the y-up frame) are the same spot measured in
// two frames. This fits the one similarity (turn, uniform scale, shift, and a
// mirror when the frames' handedness differs) that carries the first onto the
// second, by least squares over the pairs.
//
// The pairs come from ids where the two sides share them. Where they don't,
// they come from the positions alone: each of the eight quarter turns and
// mirrors of the plan, centred and scaled onto the scan, is refined by
// iterating nearest-neighbour pairs and refits, and the one that ends closest
// wins. A scan's sweeps are tens of irregular points, so the right turn wins
// by a wide margin.
//
// Pure: no DOM, no three.js.
import type { Vec } from "./ground";

/** A scan point on the floor, in the y-up frame's ground plane: `x` is x, `y` is z. */
export type Pair = { plan: Vec; scan: Vec };

export interface PlanToScan {
  /** scan = M · plan + t, M = [[m00, m01], [m10, m11]]. */
  m00: number;
  m01: number;
  m10: number;
  m11: number;
  tx: number;
  ty: number;
  /** Scan metres per plan unit. */
  scale: number;
  /** Whether the plan had to be mirrored to fit. */
  mirrored: boolean;
  /** The root-mean-square distance between each fitted plan point and its scan point, scan metres. */
  rms: number;
  /** How many pairs the fit used. */
  pairs: number;
}

export const IDENTITY: PlanToScan = { m00: 1, m01: 0, m10: 0, m11: 1, tx: 0, ty: 0, scale: 1, mirrored: false, rms: 0, pairs: 0 };

export function toScan(t: PlanToScan, p: Vec): Vec {
  return { x: t.m00 * p.x + t.m01 * p.y + t.tx, y: t.m10 * p.x + t.m11 * p.y + t.ty };
}

export function toPlan(t: PlanToScan, q: Vec): Vec {
  const det = t.m00 * t.m11 - t.m01 * t.m10;
  const x = q.x - t.tx;
  const y = q.y - t.ty;
  return { x: (t.m11 * x - t.m01 * y) / det, y: (-t.m10 * x + t.m00 * y) / det };
}

/** A heading on the plan (radians from +x towards +y) as the same direction in the scan. */
export function headingToScan(t: PlanToScan, heading: number): number {
  const d = { x: Math.cos(heading), y: Math.sin(heading) };
  return Math.atan2(t.m10 * d.x + t.m11 * d.y, t.m00 * d.x + t.m01 * d.y);
}

const centroid = (ps: readonly Vec[]): Vec => ({
  x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
  y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
});

function rmsOf(t: PlanToScan, pairs: readonly Pair[]): number {
  let sum = 0;
  for (const { plan, scan } of pairs) {
    const q = toScan(t, plan);
    sum += (q.x - scan.x) ** 2 + (q.y - scan.y) ** 2;
  }
  return Math.sqrt(sum / Math.max(1, pairs.length));
}

/** The least-squares similarity over `pairs` with the handedness given (Umeyama, in two dimensions). */
function fitHanded(pairs: readonly Pair[], mirrored: boolean): PlanToScan {
  const flip = mirrored ? -1 : 1;
  const ps = pairs.map(({ plan }) => ({ x: plan.x, y: flip * plan.y }));
  const qs = pairs.map(({ scan }) => scan);
  const cp = centroid(ps);
  const cq = centroid(qs);
  let a = 0;
  let b = 0;
  let spread = 0;
  for (let i = 0; i < ps.length; i++) {
    const px = ps[i].x - cp.x;
    const py = ps[i].y - cp.y;
    const qx = qs[i].x - cq.x;
    const qy = qs[i].y - cq.y;
    a += qx * px + qy * py;
    b += qy * px - qx * py;
    spread += px * px + py * py;
  }
  const norm = Math.hypot(a, b);
  const scale = spread > 1e-12 && norm > 1e-12 ? norm / spread : 1;
  const c = norm > 1e-12 ? a / norm : 1;
  const s = norm > 1e-12 ? b / norm : 0;
  // M = scale · R · diag(1, flip)
  const m00 = scale * c;
  const m01 = -scale * s * flip;
  const m10 = scale * s;
  const m11 = scale * c * flip;
  const tx = cq.x - (m00 * cp.x + m01 * cp.y * flip);
  const ty = cq.y - (m10 * cp.x + m11 * cp.y * flip);
  const t: PlanToScan = { m00, m01, m10, m11, tx, ty, scale, mirrored, rms: 0, pairs: pairs.length };
  return { ...t, rms: rmsOf(t, pairs) };
}

/** The least-squares similarity over `pairs`, mirrored or not, whichever fits closer. Needs two pairs or more. */
export function fitPairs(pairs: readonly Pair[]): PlanToScan {
  if (pairs.length < 2) throw new Error("a fit needs two pairs or more");
  const proper = fitHanded(pairs, false);
  // Two or three points fit a proper similarity and its mirror about equally; only prefer the mirror clearly.
  if (pairs.length < 4) return proper;
  const mirror = fitHanded(pairs, true);
  return mirror.rms < proper.rms * 0.9 ? mirror : proper;
}

/** For each plan point, the index of the nearest scan point to it once placed by `t`. */
function nearestPairs(t: PlanToScan, plan: readonly Vec[], scan: readonly Vec[]): Pair[] {
  return plan.map((p) => {
    const q = toScan(t, p);
    let best = scan[0];
    let bestD = Infinity;
    for (const s of scan) {
      const d = (s.x - q.x) ** 2 + (s.y - q.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return { plan: p, scan: best };
  });
}

/**
 * The similarity carrying `plan` onto `scan` when which point is which isn't
 * known: the closest of the eight quarter turns and mirrors, each refined by
 * iterated nearest-neighbour refits (`ITERATIONS`).
 */
export function fitClouds(plan: readonly Vec[], scan: readonly Vec[]): PlanToScan {
  if (plan.length < 2 || scan.length < 2) throw new Error("a fit needs two points or more on each side");
  const cp = centroid(plan);
  const cq = centroid(scan);
  const spread = (ps: readonly Vec[], c: Vec) => Math.sqrt(ps.reduce((s, p) => s + (p.x - c.x) ** 2 + (p.y - c.y) ** 2, 0) / ps.length);
  const ratio = spread(scan, cq) / Math.max(1e-9, spread(plan, cp));
  let best: PlanToScan | null = null;
  for (const mirrored of [false, true]) {
    for (let quarter = 0; quarter < 4; quarter++) {
      const angle = (quarter * Math.PI) / 2;
      const flip = mirrored ? -1 : 1;
      const c = Math.cos(angle) * ratio;
      const s = Math.sin(angle) * ratio;
      const m00 = c;
      const m01 = -s * flip;
      const m10 = s;
      const m11 = c * flip;
      let t: PlanToScan = {
        m00,
        m01,
        m10,
        m11,
        tx: cq.x - (m00 * cp.x + m01 * cp.y),
        ty: cq.y - (m10 * cp.x + m11 * cp.y),
        scale: ratio,
        mirrored,
        rms: 0,
        pairs: plan.length,
      };
      for (let i = 0; i < ITERATIONS; i++) {
        const next = fitHanded(nearestPairs(t, plan, scan), mirrored);
        const settled = Math.abs(next.rms - t.rms) < 1e-9;
        t = next;
        if (settled) break;
      }
      if (!best || t.rms < best.rms) best = t;
    }
  }
  return best!;
}

const ITERATIONS = 30;

export interface FitInput {
  /** The board's nodes: their ids and plan positions. */
  nodes: readonly { id: string; x: number; y: number }[];
  /** The scan's positions: an id, the floor-spot id it stands on when known, and where it is (y-up). */
  scans: readonly { id: string; anchor?: string | null; position: readonly [number, number, number] }[];
}

/**
 * The plan-to-scan similarity for a live-scan board. By id when three or more
 * nodes share an id with a scan position (or its floor spot), else from the
 * positions alone (`fitClouds`). Null with too little to fit.
 */
export function fitPlanToScan({ nodes, scans }: FitInput): PlanToScan | null {
  const ground = (p: readonly [number, number, number]): Vec => ({ x: p[0], y: p[2] });
  const byId = new Map<string, Vec>();
  for (const s of scans) {
    byId.set(s.id, ground(s.position));
    if (s.anchor && !byId.has(s.anchor)) byId.set(s.anchor, ground(s.position));
  }
  const pairs = nodes.flatMap((n) => {
    const scan = byId.get(n.id);
    return scan ? [{ plan: { x: n.x, y: n.y }, scan }] : [];
  });
  if (pairs.length >= 3) return fitPairs(pairs);
  if (nodes.length < 2 || scans.length < 2) return null;
  return fitClouds(
    nodes.map((n) => ({ x: n.x, y: n.y })),
    scans.map((s) => ground(s.position)),
  );
}
