// A live scan's floor plan (issue 118), worked out in the browser from the
// scan's mesh, so first person can draw a scanned building the way it draws a
// fixture floor (scene.ts): straight walls, door frames, a flat floor and
// ceiling, in the fixture's colours and light, at the scan's own scale and
// layout. Nothing of it is stored: the plan lives as long as the view.
//
// How:
// - The mesh is sliced at a few heights over the walked floor, above the
//   desks (`PLAN.sliceM`). What cuts every slice is wall; a desk, a chair or
//   a low partition reaches one at most.
// - The slices' pieces vote for the building's square: the direction most of
//   their length runs along, modulo a right angle. Pieces square to it are
//   kept, the rest (curves, clutter) dropped, and the kept ones gathered into
//   lines: one wall per line, its two faces taken as one.
// - Along each line, the stretches covered at enough heights are its walls,
//   short gaps closed and short pieces dropped.
// - Wherever a walk between two scan positions crosses a wall, or a scan
//   position stands on one, a doorway is cut: the scanner walked through.
// - The floor is what can be reached from the scan positions on the mesh's
//   own floor without crossing a wall, near enough to a position to have been
//   scanned. Walls with floor on neither side go; where the floor ends with no
//   wall, a wall is put, so what stops the player is always drawn.
//
// Pure: the mesh comes in as arrays and its floor as a question, so the tests
// build made-up buildings. Plan x and y are the scan's x and z, as in
// scan-ground.ts.
import type { Seg, Vec } from "./ground";
import type { ScanSolid, Vec3 } from "./scan-ground";

/** A door's height: what is over it is wall. */
const FP_DOOR_M = 2.1;

/** Every number the plan is worked out by. Metres. */
export const PLAN = Object.freeze({
  /** The slice just under the ceiling, over any door, that tells a doorway (wall over it) from glass (none). */
  headUnderM: 0.12,
  /** The slices' heights above the floor: over the desks, under the ceiling. */
  sliceM: [1.1, 1.5, 1.9] as readonly number[],
  /** A triangle this flat (|normal y|) is a floor, a desk top or a ceiling, not a wall. */
  uprightMax: 0.55,
  /** A slice piece within this of the building's square is kept. */
  squareRad: (12 * Math.PI) / 180,
  /** The bins a line's pieces are gathered in. */
  binM: 0.05,
  /** A wall's two faces, or a face and its noise, this close are one line. */
  mergeM: 0.2,
  /** Less slice than this along a line is not a wall. */
  lineMinM: 0.6,
  /** Gaps this short along a line's walls are closed. */
  closeM: 0.3,
  /** Gaps this short are bridged too: a stretch of glass or a hole in the scan. */
  bridgeM: 0.8,
  /** A wall's end this close to a square wall's line is taken to it. */
  cornerM: 0.4,
  /** A wall shorter than this is clutter. */
  minRunM: 0.4,
  /** The doorway cut where a walk crosses a wall. */
  doorM: 1.0,
  /** A scan position this close to a wall's line opens a doorway in it. */
  nodeClearM: 0.45,
  /** A wall's thickness, drawn and collided with. */
  thickM: 0.12,
  /** The floor's cells. */
  cellM: 0.25,
  /** No floor further than this from every scan position: past it was not scanned. Far enough to reach the walls of a room seen through its door. */
  leashM: 6.5,
  /** Within this of a scan position, a hole in the mesh's floor is still floor. */
  holeM: 1.5,
  /** A walked gap between two walls on a line up to this wide is a doorway, framed; wider is open floor. */
  doorwayMaxM: 2.6,
  /** A gap no one walked through this wide or wider is a pane of glass; narrower than a door, a hole in the scan, closed. Wider than the most is open. */
  glassMinM: 1.25,
  /** A gap no one walked through, a door's width (to `glassMinM`): a doorway, its door shut. */
  doorMinM: 0.6,
  glassMaxM: 8,
  /** A doorway up to this wide has a lintel over it, as a fixture floor's doors do. */
  lintelMaxM: 1.8,
});

export interface PlanInput {
  /** The mesh, y-up, metres: xyz triples. */
  positions: ArrayLike<number>;
  /** Its triangles; null for a plain list of triangles. */
  index: ArrayLike<number> | null;
  /** The walked floor's height. */
  floorY: number;
  ceilingY: number;
  /** The scan positions on this floor. */
  nodes: readonly Vec[];
  /** The straight walks between them: the board's edges. */
  paths: readonly Seg[];
  /** Whether the mesh has this floor (within a step of `floorY`) under (x, y). */
  hasFloor: (x: number, y: number) => boolean;
}

export interface PlanWall extends Seg {
  /** Put where the floor ends with no wall of the scan's. */
  boundary: boolean;
  /** A shut door across a doorway: solid, but drawn as a door, not wall. */
  door?: boolean;
}

/** A gap between two walls on one line. `a` and `b` are the walls' ends either side. */
export interface PlanDoorway extends Seg {
  width: number;
  lintel: boolean;
  /** No one went through it: its door is drawn shut, and is a wall (`PlanWall.door`). */
  shut: boolean;
}

/** The floor as cells on the building's square. */
export interface PlanFloor {
  /** The square's turn: plan (x, y) to cell frame (u, v) is a rotation by minus this. */
  angle: number;
  u0: number;
  v0: number;
  cell: number;
  cols: number;
  rows: number;
  /** 1 where the floor is, by row then column. */
  cells: Uint8Array;
}

/** A piece of furniture: a box standing on the floor, square to the building. */
export interface PlanBox {
  /** Its footprint's corners, plan (x, y), in order round it. */
  corners: [Vec, Vec, Vec, Vec];
  /** Its top, y-up, absolute. */
  top: number;
}

export interface ScanPlan {
  angle: number;
  /** The furniture (`addFurniture`); none until it is added. */
  furniture: PlanBox[];
  floorY: number;
  ceilingY: number;
  walls: PlanWall[];
  doorways: PlanDoorway[];
  /** Panes of glass across a wall line: solid to walk into, clear to see through. */
  glass: Seg[];
  floor: PlanFloor;
  /** Counts, for the console and the tests: no positions. */
  stats: { pieces: number; lines: number; cuts: number; boundary: number };
}

interface Piece {
  /** Where across the line it lies, and its stretch along. */
  c: number;
  lo: number;
  hi: number;
  level: number;
}

interface Line {
  /** Constant v (an east-west wall in the cell frame) or constant u. */
  along: "u" | "v";
  c: number;
  runs: [number, number][];
  /** Where the line has wall over door height: over a doorway, not over glass. */
  head: [number, number][];
}

const rot = (p: Vec, angle: number): { u: number; v: number } => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { u: p.x * c + p.y * s, v: -p.x * s + p.y * c };
};
const unrot = (u: number, v: number, angle: number): Vec => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: u * c - v * s, y: u * s + v * c };
};

/** The slice of every upright triangle near the nodes, at each of `heights`, as 2D pieces (plan x, y). */
export function slicePieces(input: PlanInput, heights: readonly number[]): { a: Vec; b: Vec; level: number }[] {
  const { positions, index, nodes } = input;
  const count = index ? index.length : positions.length / 3;
  const near = PLAN.leashM + 1;
  const out: { a: Vec; b: Vec; level: number }[] = [];
  const lowest = Math.min(...heights);
  const highest = Math.max(...heights);
  const corner = (k: number) => {
    const i = (index ? index[k] : k) * 3;
    return [positions[i], positions[i + 1], positions[i + 2]] as const;
  };
  for (let t = 0; t + 2 < count; t += 3) {
    const p = corner(t);
    const q = corner(t + 1);
    const r = corner(t + 2);
    const yMin = Math.min(p[1], q[1], r[1]);
    const yMax = Math.max(p[1], q[1], r[1]);
    if (yMax < lowest || yMin > highest) continue;
    // Upright only.
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12 || Math.abs(ny) / nl > PLAN.uprightMax) continue;
    const mx = (p[0] + q[0] + r[0]) / 3;
    const mz = (p[2] + q[2] + r[2]) / 3;
    let close = false;
    for (const n of nodes) {
      if (Math.abs(n.x - mx) < near && Math.abs(n.y - mz) < near && Math.hypot(n.x - mx, n.y - mz) < near) {
        close = true;
        break;
      }
    }
    if (!close) continue;
    for (let level = 0; level < heights.length; level++) {
      const h = heights[level] + 1e-5;
      if (h < yMin || h > yMax) continue;
      const hits: Vec[] = [];
      for (const [s, e] of [[p, q], [q, r], [r, p]] as const) {
        if ((s[1] - h) * (e[1] - h) < 0) {
          const k = (h - s[1]) / (e[1] - s[1]);
          hits.push({ x: s[0] + k * (e[0] - s[0]), y: s[2] + k * (e[2] - s[2]) });
        }
      }
      if (hits.length === 2 && Math.hypot(hits[1].x - hits[0].x, hits[1].y - hits[0].y) > 1e-4) out.push({ a: hits[0], b: hits[1], level });
    }
  }
  return out;
}

/** The building's square: the turn, within ±45°, that most of the pieces' length runs along or across. */
export function squareOf(pieces: readonly Seg[]): number {
  const BINS = 90;
  const hist = new Float64Array(BINS);
  const quarter = Math.PI / 2;
  for (const { a, b } of pieces) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let ang = Math.atan2(b.y - a.y, b.x - a.x) % quarter;
    if (ang < 0) ang += quarter;
    hist[Math.min(BINS - 1, Math.floor((ang / quarter) * BINS))] += len;
  }
  let best = 0;
  let bestW = -1;
  for (let i = 0; i < BINS; i++) {
    let w = 0;
    for (let d = -2; d <= 2; d++) w += hist[(i + d + BINS) % BINS];
    if (w > bestW) {
      bestW = w;
      best = i;
    }
  }
  // Refine: the length-weighted mean of the pieces within 5° of the peak, on a circle of period 90°.
  const peak = ((best + 0.5) / BINS) * quarter;
  let sx = 0;
  let sy = 0;
  for (const { a, b } of pieces) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const off = Math.atan2(Math.sin(4 * (ang - peak)), Math.cos(4 * (ang - peak))) / 4;
    if (Math.abs(off) > (5 * Math.PI) / 180) continue;
    sx += Math.cos(4 * ang) * len;
    sy += Math.sin(4 * ang) * len;
  }
  let angle = sx === 0 && sy === 0 ? peak : Math.atan2(sy, sx) / 4;
  while (angle >= Math.PI / 4) angle -= quarter;
  while (angle < -Math.PI / 4) angle += quarter;
  return angle;
}

/** Sorted, merged intervals, gaps shorter than `close` closed. */
function union(intervals: [number, number][], close: number): [number, number][] {
  const sorted = [...intervals].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + close) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** `runs` less the stretches in `cuts`. */
function subtract(runs: [number, number][], cuts: [number, number][]): [number, number][] {
  let out = runs;
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [lo, hi] of out) {
      if (c1 <= lo || c0 >= hi) next.push([lo, hi]);
      else {
        if (c0 > lo) next.push([lo, c0]);
        if (c1 < hi) next.push([c1, hi]);
      }
    }
    out = next;
  }
  return out;
}

/** Gathers one direction's pieces into lines, each with the stretches covered at `need` heights. */
function linesOf(pieces: Piece[], along: "u" | "v", levels: number): Line[] {
  if (pieces.length === 0) return [];
  const need = Math.min(2, levels);
  const lo = Math.min(...pieces.map((p) => p.c)) - 1;
  const hi = Math.max(...pieces.map((p) => p.c)) + 1;
  const bins = Math.ceil((hi - lo) / PLAN.binM) + 1;
  const weight = new Float64Array(bins);
  const binOf = (c: number) => Math.min(bins - 1, Math.max(0, Math.floor((c - lo) / PLAN.binM)));
  for (const p of pieces) weight[binOf(p.c)] += p.hi - p.lo;
  const smooth = new Float64Array(bins);
  for (let i = 0; i < bins; i++) smooth[i] = (weight[i - 1] ?? 0) + weight[i] + (weight[i + 1] ?? 0);
  const taken = new Uint8Array(pieces.length);
  const order = pieces.map((_, i) => i).sort((p, q) => pieces[p].c - pieces[q].c);
  const reach = Math.ceil(PLAN.mergeM / PLAN.binM);
  const lines: Line[] = [];
  for (;;) {
    let best = -1;
    for (let i = 0; i < bins; i++) if (best < 0 || smooth[i] > smooth[best]) best = i;
    if (best < 0 || smooth[best] < PLAN.lineMinM) break;
    const centre = lo + (best + 0.5) * PLAN.binM;
    for (let i = Math.max(0, best - reach); i <= Math.min(bins - 1, best + reach); i++) smooth[i] = 0;
    const mine: Piece[] = [];
    for (const k of order) {
      if (taken[k] || Math.abs(pieces[k].c - centre) > PLAN.mergeM) continue;
      taken[k] = 1;
      mine.push(pieces[k]);
    }
    if (mine.length === 0) continue;
    let sum = 0;
    let wsum = 0;
    for (const p of mine) {
      sum += p.c * (p.hi - p.lo);
      wsum += p.hi - p.lo;
    }
    // Where enough heights cover the line.
    const events: [number, number][] = [];
    for (let level = 0; level < levels; level++) {
      for (const [s, e] of union(mine.filter((p) => p.level === level).map((p) => [p.lo, p.hi]), PLAN.closeM)) {
        events.push([s, 1], [e, -1]);
      }
    }
    events.sort((p, q) => p[0] - q[0] || q[1] - p[1]);
    const covered: [number, number][] = [];
    let depth = 0;
    let start = 0;
    for (const [at, d] of events) {
      const was = depth;
      depth += d;
      if (was < need && depth >= need) start = at;
      if (was >= need && depth < need) covered.push([start, at]);
    }
    const runs = union(covered, PLAN.bridgeM).filter(([s, e]) => e - s >= PLAN.minRunM);
    const head = union(mine.filter((p) => p.level >= levels).map((p) => [p.lo, p.hi]), PLAN.closeM);
    if (runs.length > 0) lines.push({ along, c: sum / wsum, runs, head });
  }
  return lines;
}

/**
 * Closes the corners: a wall's end within `PLAN.cornerM` of a square wall
 * that reaches across its line is taken to that wall's line, so walls meet
 * at corners and tees with no crack between them.
 */
function joinCorners(lines: Line[]): void {
  const reach = PLAN.cornerM;
  for (const line of lines) {
    const others = lines.filter((l) => l.along !== line.along);
    const meets = (at: number) => {
      let best: number | null = null;
      for (const o of others) {
        if (Math.abs(o.c - at) > reach) continue;
        if (!o.runs.some(([lo, hi]) => line.c >= lo - reach && line.c <= hi + reach)) continue;
        if (best === null || Math.abs(o.c - at) < Math.abs(best - at)) best = o.c;
      }
      return best;
    };
    line.runs = union(
      line.runs.map(([lo, hi]) => [meets(lo) ?? lo, meets(hi) ?? hi] as [number, number]).filter(([lo, hi]) => hi > lo),
      0,
    );
  }
}

/** Works out the plan of the walked floor. Deterministic: the same mesh gives the same plan. */
export function derivePlan(input: PlanInput): ScanPlan {
  const { floorY, ceilingY, nodes, paths, hasFloor } = input;
  const top = ceilingY - floorY - 0.2;
  const heights = PLAN.sliceM.filter((h) => h < top).map((h) => floorY + h);
  if (heights.length === 0) heights.push(floorY + Math.min(1.1, Math.max(0.5, top)));
  // One more slice over door height, if the ceiling allows: a doorway has wall over it, glass none.
  const headY = ceilingY - floorY - PLAN.headUnderM;
  const sliced = headY > FP_DOOR_M + 0.05 ? [...heights, floorY + headY] : heights;
  const raw = slicePieces(input, sliced);
  const angle = squareOf(raw.filter((p) => p.level < heights.length));

  // Square pieces, in the cell frame.
  const across: Piece[] = [];
  const down: Piece[] = [];
  for (const { a, b, level } of raw) {
    const p = rot(a, angle);
    const q = rot(b, angle);
    const dir = Math.atan2(q.v - p.v, q.u - p.u);
    const flat = Math.abs(Math.atan2(Math.sin(2 * dir), Math.cos(2 * dir))) / 2; // 0 along u, π/2 along v
    if (flat < PLAN.squareRad) across.push({ c: (p.v + q.v) / 2, lo: Math.min(p.u, q.u), hi: Math.max(p.u, q.u), level });
    else if (Math.PI / 2 - flat < PLAN.squareRad) down.push({ c: (p.u + q.u) / 2, lo: Math.min(p.v, q.v), hi: Math.max(p.v, q.v), level });
  }
  const lines = [...linesOf(across, "v", heights.length), ...linesOf(down, "u", heights.length)];
  joinCorners(lines);

  // Doorways: wherever a walk crosses a wall, or a scan position stands on one.
  const nodesUV = nodes.map((n) => rot(n, angle));
  const pathsUV = paths.map((s) => [rot(s.a, angle), rot(s.b, angle)] as const);
  let cuts = 0;
  for (const line of lines) {
    // `along` "v" is a line of constant v: its runs are stretches of u.
    const acrossOf = (p: { u: number; v: number }) => (line.along === "v" ? p.v : p.u);
    const alongOf = (p: { u: number; v: number }) => (line.along === "v" ? p.u : p.v);
    const holes: [number, number][] = [];
    for (const [p, q] of pathsUV) {
      const dp = acrossOf(p) - line.c;
      const dq = acrossOf(q) - line.c;
      if (dp * dq >= 0) continue;
      const t = dp / (dp - dq);
      const at = alongOf(p) + t * (alongOf(q) - alongOf(p));
      const len = Math.hypot(q.u - p.u, q.v - p.v) || 1;
      const sin = Math.abs(acrossOf(q) - acrossOf(p)) / len;
      const w = Math.min(1.6, PLAN.doorM / Math.max(sin, 0.6));
      holes.push([at - w / 2, at + w / 2]);
    }
    for (const n of nodesUV) {
      if (Math.abs(acrossOf(n) - line.c) < PLAN.nodeClearM) holes.push([alongOf(n) - PLAN.doorM / 2, alongOf(n) + PLAN.doorM / 2]);
    }
    line.runs = subtract(line.runs, union(holes, 0)).filter(([s, e]) => e - s >= PLAN.minRunM);
    cuts += holes.length;
  }

  // The floor: cells on the mesh's floor, holes in it filled, reached from the scan positions without crossing a wall.
  const cell = PLAN.cellM;
  const pad = PLAN.leashM + 0.5;
  const u0 = Math.min(...nodesUV.map((n) => n.u)) - pad;
  const v0 = Math.min(...nodesUV.map((n) => n.v)) - pad;
  const cols = Math.max(1, Math.ceil((Math.max(...nodesUV.map((n) => n.u)) + pad - u0) / cell));
  const rows = Math.max(1, Math.ceil((Math.max(...nodesUV.map((n) => n.v)) + pad - v0) / cell));
  const centreU = (i: number) => u0 + (i + 0.5) * cell;
  const centreV = (j: number) => v0 + (j + 0.5) * cell;
  const nearest = new Float32Array(cols * rows).fill(Infinity);
  // Distance to the nearest node, cell by cell, only near the nodes.
  const span = Math.ceil(pad / cell);
  for (const n of nodesUV) {
    const ci = Math.floor((n.u - u0) / cell);
    const cj = Math.floor((n.v - v0) / cell);
    for (let j = Math.max(0, cj - span); j <= Math.min(rows - 1, cj + span); j++) {
      for (let i = Math.max(0, ci - span); i <= Math.min(cols - 1, ci + span); i++) {
        const d = Math.hypot(centreU(i) - n.u, centreV(j) - n.v);
        if (d < nearest[j * cols + i]) nearest[j * cols + i] = d;
      }
    }
  }
  const candidate = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const d = nearest[k];
      if (d > PLAN.leashM) continue;
      if (d <= PLAN.holeM) candidate[k] = 1;
      else {
        const w = unrot(centreU(i), centreV(j), angle);
        if (hasFloor(w.x, w.y)) candidate[k] = 1;
      }
    }
  }
  // Holes in the mesh's floor (under a desk, a tripod's shadow): what the outside cannot reach is floor.
  const outside = new Uint8Array(cols * rows);
  const queue: number[] = [];
  for (let i = 0; i < cols; i++) for (const j of [0, rows - 1]) queue.push(j * cols + i);
  for (let j = 0; j < rows; j++) for (const i of [0, cols - 1]) queue.push(j * cols + i);
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h];
    if (outside[k] || candidate[k]) continue;
    outside[k] = 1;
    const i = k % cols;
    const j = (k - i) / cols;
    if (i > 0) queue.push(k - 1);
    if (i < cols - 1) queue.push(k + 1);
    if (j > 0) queue.push(k - cols);
    if (j < rows - 1) queue.push(k + cols);
  }
  for (let k = 0; k < candidate.length; k++) if (!outside[k] && nearest[k] <= PLAN.leashM) candidate[k] = 1;

  // The steps between cells a wall stands across.
  const stopRight = new Uint8Array(cols * rows); // from (i, j) to (i + 1, j)
  const stopDown = new Uint8Array(cols * rows); // from (i, j) to (i, j + 1)
  for (const line of lines) {
    for (const [lo, hi] of line.runs) {
      if (line.along === "u") {
        const i = Math.floor((line.c - u0) / cell - 0.5);
        if (i < 0 || i >= cols - 1) continue;
        for (let j = Math.max(0, Math.ceil((lo - v0) / cell - 0.5)); j <= Math.min(rows - 1, Math.floor((hi - v0) / cell - 0.5)); j++) stopRight[j * cols + i] = 1;
      } else {
        const j = Math.floor((line.c - v0) / cell - 0.5);
        if (j < 0 || j >= rows - 1) continue;
        for (let i = Math.max(0, Math.ceil((lo - u0) / cell - 0.5)); i <= Math.min(cols - 1, Math.floor((hi - u0) / cell - 0.5)); i++) stopDown[j * cols + i] = 1;
      }
    }
  }
  const cells = new Uint8Array(cols * rows);
  const fill: number[] = [];
  for (const n of nodesUV) {
    const i = Math.floor((n.u - u0) / cell);
    const j = Math.floor((n.v - v0) / cell);
    if (i >= 0 && j >= 0 && i < cols && j < rows) fill.push(j * cols + i);
  }
  for (let h = 0; h < fill.length; h++) {
    const k = fill[h];
    if (cells[k] || !candidate[k]) continue;
    cells[k] = 1;
    const i = k % cols;
    const j = (k - i) / cols;
    if (i < cols - 1 && !stopRight[k]) fill.push(k + 1);
    if (i > 0 && !stopRight[k - 1]) fill.push(k - 1);
    if (j < rows - 1 && !stopDown[k]) fill.push(k + cols);
    if (j > 0 && !stopDown[k - cols]) fill.push(k - cols);
  }
  const floorAt = (u: number, v: number) => {
    const i = Math.floor((u - u0) / cell);
    const j = Math.floor((v - v0) / cell);
    return i >= 0 && j >= 0 && i < cols && j < rows && cells[j * cols + i] === 1;
  };

  // Walls with floor on neither side go.
  const side = cell * 0.9;
  for (const line of lines) {
    const kept: [number, number][] = [];
    for (const [lo, hi] of line.runs) {
      let start: number | null = null;
      const step = 0.1;
      for (let s = lo; s <= hi + 1e-9; s += step) {
        const at = Math.min(s, hi);
        const has = line.along === "v" ? floorAt(at, line.c - side) || floorAt(at, line.c + side) : floorAt(line.c - side, at) || floorAt(line.c + side, at);
        if (has && start === null) start = at;
        if (!has && start !== null) {
          kept.push([start, at]);
          start = null;
        }
      }
      if (start !== null) kept.push([start, hi]);
    }
    line.runs = union(kept, PLAN.closeM).filter(([s, e]) => e - s >= PLAN.minRunM);
  }

  const walls: PlanWall[] = [];
  const doorways: PlanDoorway[] = [];
  const glass: Seg[] = [];
  const toWorld = (line: { along: "u" | "v"; c: number }, at: number) => (line.along === "v" ? unrot(at, line.c, angle) : unrot(line.c, at, angle));
  const headOver = (line: Line, lo: number, hi: number) => {
    let covered = 0;
    for (const [a, b] of line.head) covered += Math.max(0, Math.min(b, hi) - Math.max(a, lo));
    return covered / Math.max(1e-6, hi - lo);
  };
  // Each gap between two walls on a line: a doorway where the scanner went through it or stood in
  // it; else, if wide, a pane of glass the scan saw through; else a hole in the scan, closed.
  for (const line of lines) {
    const acrossOf = (p: { u: number; v: number }) => (line.along === "v" ? p.v : p.u);
    const alongOf = (p: { u: number; v: number }) => (line.along === "v" ? p.u : p.v);
    const walked = (lo: number, hi: number) =>
      pathsUV.some(([p, q]) => {
        const dp = acrossOf(p) - line.c;
        const dq = acrossOf(q) - line.c;
        if (dp * dq >= 0) return false;
        const at = alongOf(p) + (dp / (dp - dq)) * (alongOf(q) - alongOf(p));
        return at > lo - 0.1 && at < hi + 0.1;
      }) || nodesUV.some((n) => Math.abs(acrossOf(n) - line.c) < PLAN.nodeClearM && alongOf(n) > lo - 0.1 && alongOf(n) < hi + 0.1);
    const runs = [...line.runs].sort((p, q) => p[0] - q[0]);
    const kept: [number, number][] = [];
    for (const run of runs) {
      const last = kept[kept.length - 1];
      if (!last) {
        kept.push([run[0], run[1]]);
        continue;
      }
      const [lo, hi] = [last[1], run[0]];
      const width = hi - lo;
      if (walked(lo, hi)) {
        if (width <= PLAN.doorwayMaxM) doorways.push({ a: toWorld(line, lo), b: toWorld(line, hi), width, lintel: width <= PLAN.lintelMaxM, shut: false });
        kept.push([run[0], run[1]]);
      } else if ((headOver(line, lo, hi) >= 0.6 && width <= PLAN.doorwayMaxM && width >= 0.5) || (width >= PLAN.doorMinM && width < PLAN.glassMinM)) {
        // Wall over it: a doorway no one went through. Its door stands shut, a wall to walk into.
        doorways.push({ a: toWorld(line, lo), b: toWorld(line, hi), width, lintel: width <= PLAN.lintelMaxM, shut: true });
        walls.push({ a: toWorld(line, lo), b: toWorld(line, hi), boundary: false, door: true });
        kept.push([run[0], run[1]]);
      } else if (width >= PLAN.glassMinM && width <= PLAN.glassMaxM) {
        glass.push({ a: toWorld(line, lo), b: toWorld(line, hi) });
        kept.push([run[0], run[1]]);
      } else if (width < PLAN.glassMinM) {
        last[1] = run[1];
      } else {
        kept.push([run[0], run[1]]);
      }
    }
    line.runs = kept;
    for (const [lo, hi] of kept) walls.push({ a: toWorld(line, lo), b: toWorld(line, hi), boundary: false });
  }

  // Where the floor ends with no wall, a wall: what stops the player is drawn.
  const covered = (along: "u" | "v", c: number, at: number) =>
    lines.some((l) => l.along === along && Math.abs(l.c - c) <= 0.35 && l.runs.some(([lo, hi]) => at >= lo - 0.15 && at <= hi + 0.15));
  let boundary = 0;
  const edge = (along: "u" | "v", c: number, from: number, to: number) => {
    const line = { along, c };
    walls.push({ a: toWorld(line, from), b: toWorld(line, to), boundary: true });
    boundary++;
  };
  const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && cells[j * cols + i] === 1;
  // Lines of constant v, between rows j - 1 and j.
  for (let j = 0; j <= rows; j++) {
    const v = v0 + j * cell;
    let from: number | null = null;
    for (let i = 0; i <= cols; i++) {
      const on = i < cols && filled(i, j - 1) !== filled(i, j) && !covered("v", v, centreU(i));
      if (on && from === null) from = u0 + i * cell;
      if (!on && from !== null) {
        edge("v", v, from, u0 + i * cell);
        from = null;
      }
    }
  }
  for (let i = 0; i <= cols; i++) {
    const u = u0 + i * cell;
    let from: number | null = null;
    for (let j = 0; j <= rows; j++) {
      const on = j < rows && filled(i - 1, j) !== filled(i, j) && !covered("u", u, centreV(j));
      if (on && from === null) from = v0 + j * cell;
      if (!on && from !== null) {
        edge("u", u, from, v0 + j * cell);
        from = null;
      }
    }
  }

  // Each wall runs half its thickness past its ends, so walls that meet close the corner between them.
  const over = PLAN.thickM / 2;
  for (const wall of walls) {
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    if (len < 1e-9) continue;
    const dx = ((wall.b.x - wall.a.x) / len) * over;
    const dy = ((wall.b.y - wall.a.y) / len) * over;
    wall.a = { x: wall.a.x - dx, y: wall.a.y - dy };
    wall.b = { x: wall.b.x + dx, y: wall.b.y + dy };
  }

  return {
    angle,
    furniture: [],
    floorY,
    ceilingY,
    walls,
    doorways,
    glass,
    floor: { angle, u0, v0, cell, cols, rows, cells },
    stats: { pieces: raw.length, lines: lines.filter((l) => l.runs.length > 0).length, cuts, boundary },
  };
}

/** Whether (x, y) is on the plan's floor. */
export function onPlanFloor(floor: PlanFloor, x: number, y: number): boolean {
  const { u, v } = rot({ x, y }, floor.angle);
  const i = Math.floor((u - floor.u0) / floor.cell);
  const j = Math.floor((v - floor.v0) / floor.cell);
  return i >= 0 && j >= 0 && i < floor.cols && j < floor.rows && floor.cells[j * floor.cols + i] === 1;
}

/** A cell's centre in plan (x, y). */
export function cellCentre(floor: PlanFloor, i: number, j: number): Vec {
  return unrot(floor.u0 + (i + 0.5) * floor.cell, floor.v0 + (j + 0.5) * floor.cell, floor.angle);
}

/** A point of the cell frame in plan (x, y). */
export function fromCellFrame(floor: PlanFloor, u: number, v: number): Vec {
  return unrot(u, v, floor.angle);
}

/**
 * The plan as the `ScanSolid` the scan's ground walks on (scan-ground.ts), in
 * place of the mesh: its floor is the plan's floor, flat at `floorY`; its
 * walls are the plan's walls, full height, as thick as they are drawn. So
 * the player is stopped by exactly the walls in the picture.
 */
export function planSolid(plan: ScanPlan): ScanSolid & { hit(origin: Vec3, dir: Vec3, far: number, throughGlass?: boolean): number | null } {
  const half = PLAN.thickM / 2;
  // Walls are full height and as thick as drawn; a box's sides stand as high as its top, and no thicker.
  // Glass stops a body and the scan's own sense of what is in view, but not a guard's eye (`sight`).
  const walls: { a: Vec; b: Vec; top: number; thick: number; clear: boolean }[] = [
    ...plan.walls.map((w) => ({ a: w.a, b: w.b, top: Infinity, thick: half, clear: false })),
    ...plan.glass.map((g) => ({ a: g.a, b: g.b, top: Infinity, thick: 0.02, clear: true })),
    ...plan.furniture.flatMap((box) => box.corners.map((a, k) => ({ a, b: box.corners[(k + 1) % 4], top: box.top, thick: 0.01, clear: false }))),
  ];
  const { floorY, ceilingY } = plan;
  return {
    floorBelow(x, fromY, z, depth) {
      if (floorY > fromY + 1e-9 || floorY < fromY - depth) return null;
      return onPlanFloor(plan.floor, x, z) ? floorY : null;
    },
    pushOut(x, _feetY, z, radius) {
      let px = x;
      let pz = z;
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const { a, b, thick } of walls) {
          const reach = radius + thick;
          if (px < Math.min(a.x, b.x) - reach || px > Math.max(a.x, b.x) + reach) continue;
          if (pz < Math.min(a.y, b.y) - reach || pz > Math.max(a.y, b.y) + reach) continue;
          const dx = b.x - a.x;
          const dz = b.y - a.y;
          const len2 = dx * dx + dz * dz;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.y) * dz) / len2));
          const ox = px - (a.x + t * dx);
          const oz = pz - (a.y + t * dz);
          const d = Math.hypot(ox, oz);
          if (d >= reach) continue;
          if (d < 1e-9) {
            // On the line itself: out to the side the wall's normal points.
            const l = Math.sqrt(len2) || 1;
            px += (-dz / l) * reach;
            pz += (dx / l) * reach;
          } else {
            px += (ox / d) * (reach - d);
            pz += (oz / d) * (reach - d);
          }
          moved = true;
        }
        if (!moved) break;
      }
      return { x: px, z: pz };
    },
    hit(origin: Vec3, dir: Vec3, far: number, throughGlass = false) {
      const [ox, oy, oz] = origin;
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const flat = Math.hypot(dir[0], dir[2]) / len;
      if (oy < floorY || oy > ceilingY || flat < 1e-6) return null;
      const dx = dir[0] / len / flat;
      const dz = dir[2] / len / flat;
      let best: number | null = null;
      for (const { a, b, top, clear } of walls) {
        if (oy > top || (throughGlass && clear)) continue;
        const ex = b.x - a.x;
        const ez = b.y - a.y;
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-12) continue;
        const wx = a.x - ox;
        const wz = a.y - oz;
        const t = (wx * ez - wz * ex) / den;
        const s = (wx * dz - wz * dx) / den;
        if (t < 0 || s < 0 || s > 1) continue;
        // Along the flat ray; the distance along the full ray is longer by 1 / flat.
        const d = t / flat;
        if (d <= far && (best === null || d < best)) best = d;
      }
      return best;
    },
    sight(origin: Vec3, dir: Vec3, far: number) {
      return this.hit(origin, dir, far, true);
    },
  };
}

/** Every number the furniture is found by. Metres. */
export const FURNITURE = Object.freeze({
  /** The grid the tops are measured on. */
  cellM: 0.1,
  /** Lower than this over the floor is a bin or a box on the floor, not furniture. */
  lowM: 0.45,
  /** The bands a top falls in: desks, chairs and counters; then partitions, cabinets and shelves. */
  bandsM: [1.0] as readonly number[],
  /** Higher than this is the ceiling's, not the floor's. */
  highM: 2.2,
  /** Under a top higher than `hangM`, what stands on the floor is looked for from `standM` down: a cupboard hung on a wall has bare floor there. */
  hangM: 1.5,
  standM: 1.3,
  /** No furniture this close to a wall's line: that is the wall's own clutter. */
  wallClearM: 0.15,
  /** No furniture this close to a scan position, or to a walk between two: the scanner stood and walked there. */
  nodeClearM: 0.45,
  pathClearM: 0.3,
  /** A box thinner than this is dropped (a half-height wall is a box one cell thick). */
  minSideM: 0.1,
  minAreaM2: 0.08,
  maxBoxes: 600,
});

/**
 * Finds the furniture: what stands between knee and head height on the
 * plan's floor, measured by `topAt` (the highest thing under (x, y) below
 * `highM` over the floor, or null), grouped by height band and covered by
 * boxes square to the building, largest first. Keeps clear of the walls, the
 * scan positions and the walks between them. Adds them to `plan.furniture`.
 */
export function addFurniture(
  plan: ScanPlan,
  nodes: readonly Vec[],
  paths: readonly Seg[],
  topAt: (x: number, y: number) => number | null,
  /** What is under (x, y) below `standM` over the floor: what stands there, or the floor itself under something that hangs. */
  lowAt: (x: number, y: number) => number | null = () => null,
): void {
  const F = FURNITURE;
  const { floor, floorY } = plan;
  const angle = floor.angle;
  const cell = F.cellM;
  const cols = Math.ceil((floor.cols * floor.cell) / cell);
  const rows = Math.ceil((floor.rows * floor.cell) / cell);
  const band = new Int8Array(cols * rows).fill(-1);
  const height = new Float32Array(cols * rows);
  const wallsUV = plan.walls.map((w) => [rot(w.a, angle), rot(w.b, angle)] as const);
  const nodesUV = nodes.map((n) => rot(n, angle));
  const pathsUV = paths.map((p) => [rot(p.a, angle), rot(p.b, angle)] as const);
  const segDist = (p: { u: number; v: number }, a: { u: number; v: number }, b: { u: number; v: number }) => {
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const len2 = du * du + dv * dv || 1;
    const t = Math.max(0, Math.min(1, ((p.u - a.u) * du + (p.v - a.v) * dv) / len2));
    return Math.hypot(p.u - a.u - t * du, p.v - a.v - t * dv);
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = { u: floor.u0 + (i + 0.5) * cell, v: floor.v0 + (j + 0.5) * cell };
      const w = unrot(p.u, p.v, angle);
      if (!onPlanFloor(floor, w.x, w.y)) continue;
      const top = topAt(w.x, w.y);
      if (top === null) continue;
      const h = top - floorY;
      if (h < F.lowM || h > F.highM) continue;
      // Something high with bare floor under it hangs on a wall: a cupboard, not furniture.
      if (h > F.hangM) {
        const low = lowAt(w.x, w.y);
        if (low !== null && low - floorY < 0.1) continue;
      }
      if (nodesUV.some((n) => Math.abs(n.u - p.u) < F.nodeClearM && Math.abs(n.v - p.v) < F.nodeClearM && Math.hypot(n.u - p.u, n.v - p.v) < F.nodeClearM)) continue;
      if (wallsUV.some(([a, b]) => segDist(p, a, b) < F.wallClearM)) continue;
      if (pathsUV.some(([a, b]) => segDist(p, a, b) < F.pathClearM)) continue;
      const k = j * cols + i;
      band[k] = F.bandsM.filter((b) => h >= b).length;
      height[k] = h;
    }
  }
  // A cell missed among its band's neighbours (a shelf's gap, a ray between two slats) is that band's.
  for (let pass = 0; pass < 2; pass++) {
    const was = band.slice();
    for (let j = 1; j < rows - 1; j++) {
      for (let i = 1; i < cols - 1; i++) {
        const k = j * cols + i;
        if (was[k] >= 0) continue;
        const near = [was[k - 1], was[k + 1], was[k - cols], was[k + cols]].filter((b) => b >= 0);
        if (near.length < 3) continue;
        const b = Math.max(...near);
        if (near.filter((x) => x === b).length < 3) continue;
        band[k] = b;
        const hs = [k - 1, k + 1, k - cols, k + cols].filter((n) => was[n] === b).map((n) => height[n]);
        height[k] = hs.reduce((a, h) => a + h, 0) / hs.length;
      }
    }
  }
  // Boxes: within each connected patch of one band, the largest rectangle, again and again.
  const boxes: PlanBox[] = [];
  const minCells = Math.max(1, Math.round(F.minSideM / cell));
  const seen = new Uint8Array(cols * rows);
  for (let start = 0; start < band.length && boxes.length < F.maxBoxes; start++) {
    if (band[start] < 0 || seen[start]) continue;
    const b = band[start];
    const patch: number[] = [start];
    seen[start] = 1;
    let [i0, i1, j0, j1] = [cols, 0, rows, 0];
    for (let h = 0; h < patch.length; h++) {
      const k = patch[h];
      const i = k % cols;
      const j = (k - i) / cols;
      i0 = Math.min(i0, i);
      i1 = Math.max(i1, i + 1);
      j0 = Math.min(j0, j);
      j1 = Math.max(j1, j + 1);
      for (const n of [i > 0 ? k - 1 : -1, i < cols - 1 ? k + 1 : -1, j > 0 ? k - cols : -1, j < rows - 1 ? k + cols : -1]) {
        if (n >= 0 && !seen[n] && band[n] === b) {
          seen[n] = 1;
          patch.push(n);
        }
      }
    }
    const w = i1 - i0;
    const run = new Int32Array(w);
    while (boxes.length < F.maxBoxes) {
      let best = { area: 0, i0: 0, j0: 0, i1: 0, j1: 0 };
      run.fill(0);
      for (let j = j0; j < j1; j++) {
        for (let x = 0; x < w; x++) run[x] = band[j * cols + i0 + x] === b ? run[x] + 1 : 0;
        // The largest rectangle under the histogram `run`, ending at row j.
        const stack: number[] = [];
        for (let x = 0; x <= w; x++) {
          const h = x < w ? run[x] : 0;
          while (stack.length > 0 && run[stack[stack.length - 1]] >= h) {
            const hh = run[stack.pop()!];
            const left = stack.length > 0 ? stack[stack.length - 1] + 1 : 0;
            const width = x - left;
            if (hh >= minCells && width >= minCells && hh * width > best.area) best = { area: hh * width, i0: i0 + left, j0: j - hh + 1, i1: i0 + x, j1: j + 1 };
          }
          stack.push(x);
        }
      }
      if (best.area * cell * cell < F.minAreaM2) break;
      const tops: number[] = [];
      for (let j = best.j0; j < best.j1; j++) {
        for (let i = best.i0; i < best.i1; i++) {
          tops.push(height[j * cols + i]);
          band[j * cols + i] = -1;
        }
      }
      tops.sort((p, q) => p - q);
      const top = floorY + tops[Math.floor(tops.length / 2)];
      const [u0, u1] = [floor.u0 + best.i0 * cell, floor.u0 + best.i1 * cell];
      const [v0, v1] = [floor.v0 + best.j0 * cell, floor.v0 + best.j1 * cell];
      boxes.push({ corners: [unrot(u0, v0, angle), unrot(u1, v0, angle), unrot(u1, v1, angle), unrot(u0, v1, angle)], top });
    }
  }
  plan.furniture = boxes;
}

/**
 * Which room each floor cell is in: a flood from every scan position at once,
 * across the floor and never through a wall, a shut door or glass, so a cell
 * takes the room of the position it is reached from first. `roomAt` answers a
 * point, falling back on the nearest position off the floor.
 */
export function roomLabels(plan: ScanPlan, nodes: readonly (Vec & { room: string })[]): (p: Vec) => string {
  const { floor } = plan;
  const { cols, rows, cell } = floor;
  const label = new Int32Array(cols * rows).fill(-1);
  const rooms = nodes.map((n) => n.room);
  // The walls, bucketed by 2 m squares of the plan, to test the step between two cells against.
  const BUCKET = 2;
  const buckets = new Map<string, Seg[]>();
  const solid = [...plan.walls, ...plan.glass];
  for (const w of solid) {
    const [x0, x1] = [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)];
    const [y0, y1] = [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)];
    for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) {
      for (let by = Math.floor(y0 / BUCKET); by <= Math.floor(y1 / BUCKET); by++) {
        const key = `${bx}:${by}`;
        const list = buckets.get(key);
        if (list) list.push(w);
        else buckets.set(key, [w]);
      }
    }
  }
  const side = (u: Vec, v: Vec, w: Vec) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const crosses = (p: Vec, q: Vec) => {
    const keys = new Set([`${Math.floor(p.x / BUCKET)}:${Math.floor(p.y / BUCKET)}`, `${Math.floor(q.x / BUCKET)}:${Math.floor(q.y / BUCKET)}`]);
    for (const key of keys) {
      for (const w of buckets.get(key) ?? []) {
        if (side(p, q, w.a) * side(p, q, w.b) <= 0 && side(w.a, w.b, p) * side(w.a, w.b, q) < 0) return true;
      }
    }
    return false;
  };
  const centre = (k: number) => cellCentre(floor, k % cols, Math.floor(k / cols));
  const queue: number[] = [];
  nodes.forEach((n, index) => {
    const { u, v } = rot(n, floor.angle);
    const i = Math.floor((u - floor.u0) / cell);
    const j = Math.floor((v - floor.v0) / cell);
    if (i < 0 || j < 0 || i >= cols || j >= rows) return;
    const k = j * cols + i;
    if (label[k] < 0) {
      label[k] = index;
      queue.push(k);
    }
  });
  for (let h = 0; h < queue.length; h++) {
    const k = queue[h];
    const i = k % cols;
    const j = (k - i) / cols;
    const from = centre(k);
    for (const n of [i > 0 ? k - 1 : -1, i < cols - 1 ? k + 1 : -1, j > 0 ? k - cols : -1, j < rows - 1 ? k + cols : -1]) {
      if (n < 0 || label[n] >= 0 || floor.cells[n] !== 1) continue;
      if (crosses(from, centre(n))) continue;
      label[n] = label[k];
      queue.push(n);
    }
  }
  return (p: Vec) => {
    const { u, v } = rot(p, floor.angle);
    const i = Math.floor((u - floor.u0) / cell);
    const j = Math.floor((v - floor.v0) / cell);
    if (i >= 0 && j >= 0 && i < cols && j < rows && label[j * cols + i] >= 0) return rooms[label[j * cols + i]];
    let best = 0;
    let bestD = Infinity;
    nodes.forEach((n, index) => {
      const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = index;
      }
    });
    return rooms[best] ?? "";
  };
}
