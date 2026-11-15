// A live scan's plan (scan-plan.ts) drawn the way scene.ts draws a fixture
// floor (issue 118): the same faces, colours, lines and lights, so a scanned
// building reads as one of ours, at its own scale and layout. Static, like
// scene.ts's group: the doors that open and everything that moves are the
// actors'. Plan x is three's x and plan y three's z; up is y.
import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PointLight } from "three";
import type { Vec } from "./ground";
import type { Palette } from "./palette";
import { cellCentre, fromCellFrame, PLAN, type ScanPlan } from "./scan-plan";
import { Faces, lines, type RoomTone } from "./scene";
import { FP } from "./tuning";

const LIGHT: Record<RoomTone, number> = { lit: 1.45, plain: 1, dark: 0.72 };
/** The most room lights a scan gets: each costs every lit pixel a little. */
const MAX_LAMPS = 10;
const LAMP_EVERY_M = 7.2;
const PANEL_EVERY_M = 3.6;
/** No lamp nearer a wall than this. */
const LAMP_CLEAR_M = 2;

/** The plan's static geometry as one group. `tone` says how the floor at a point is lit. `disposeGroup` frees it. */
export function buildPlanGroup(plan: ScanPlan, palette: Palette, tone: (p: Vec) => RoomTone): Group {
  const group = new Group();
  group.name = "scan-plan";
  const { floorY: y0, ceilingY: y1, floor } = plan;
  const doorTop = Math.min(y0 + FP.doorHeightM, y1 - 0.1);
  const shade = (colour: Color, by: number) => colour.clone().multiplyScalar(by);
  const faces = new Faces();
  const panels = new Faces();
  const grid: number[] = [];
  const seams: number[] = [];
  const edges: number[] = [];
  const trim: number[] = [];
  const { cols, rows, cell } = floor;
  const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && floor.cells[j * cols + i] === 1;

  // Floor and ceiling, a row of cells at a time, each run one tone.
  const toneOf = new Array<RoomTone>(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (filled(i, j)) toneOf[j * cols + i] = tone(cellCentre(floor, i, j));
  const at = (u: number, v: number, y: number): [number, number, number] => {
    const p = fromCellFrame(floor, u, v);
    return [p.x, y, p.y];
  };
  for (let j = 0; j < rows; j++) {
    let i = 0;
    while (i < cols) {
      if (!filled(i, j)) {
        i++;
        continue;
      }
      const t = toneOf[j * cols + i];
      let e = i + 1;
      while (e < cols && filled(e, j) && toneOf[j * cols + e] === t) e++;
      const ua = floor.u0 + i * cell;
      const ub = floor.u0 + e * cell;
      const va = floor.v0 + j * cell;
      const vb = va + cell;
      const k = LIGHT[t];
      faces.quad([at(ua, va, y0), at(ub, va, y0), at(ub, vb, y0), at(ua, vb, y0)], [0, 1, 0], shade(palette.n700, k * 0.9));
      faces.quad([at(ua, va, y1), at(ub, va, y1), at(ub, vb, y1), at(ua, vb, y1)], [0, -1, 0], shade(palette.n850, k));
      i = e;
    }
  }

  // Under the floor and over the ceiling, the whole plan's width: the cells stop up to half a cell
  // short of a wall, and the background must not show through that crack.
  const [uA, uB, vA, vB] = [floor.u0, floor.u0 + cols * cell, floor.v0, floor.v0 + rows * cell];
  faces.quad([at(uA, vA, y0 - 0.01), at(uB, vA, y0 - 0.01), at(uB, vB, y0 - 0.01), at(uA, vB, y0 - 0.01)], [0, 1, 0], shade(palette.n700, 0.85));
  faces.quad([at(uA, vA, y1 + 0.01), at(uB, vA, y1 + 0.01), at(uB, vB, y1 + 0.01), at(uA, vB, y1 + 0.01)], [0, -1, 0], palette.n850);

  // The floor's grid, one line a fixture plan unit, on the building's square.
  const unit = FP.unitM;
  const gy = y0 + 0.004;
  for (let g = Math.ceil(floor.u0 / unit) * unit; g < floor.u0 + cols * cell; g += unit) {
    const i = Math.floor((g - floor.u0) / cell);
    let from: number | null = null;
    for (let j = 0; j <= rows; j++) {
      const on = j < rows && filled(i, j);
      if (on && from === null) from = j;
      if (!on && from !== null) {
        grid.push(...at(g, floor.v0 + from * cell, gy), ...at(g, floor.v0 + j * cell, gy));
        from = null;
      }
    }
  }
  for (let g = Math.ceil(floor.v0 / unit) * unit; g < floor.v0 + rows * cell; g += unit) {
    const j = Math.floor((g - floor.v0) / cell);
    let from: number | null = null;
    for (let i = 0; i <= cols; i++) {
      const on = i < cols && filled(i, j);
      if (on && from === null) from = i;
      if (!on && from !== null) {
        grid.push(...at(floor.u0 + from * cell, g, gy), ...at(floor.u0 + i * cell, g, gy));
        from = null;
      }
    }
  }

  // Ceiling lights over the lit floor: strips every few metres, and a lamp for each lit stretch.
  const lamps = new Map<string, { u: number; v: number; clear: number; n: number }>();
  const clearance = (p: Vec) => {
    let best = Infinity;
    for (const { a, b } of plan.walls) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return best;
  };
  for (let pu = Math.floor(floor.u0 / PANEL_EVERY_M) * PANEL_EVERY_M + PANEL_EVERY_M / 2; pu < floor.u0 + cols * cell; pu += PANEL_EVERY_M) {
    for (let pv = Math.floor(floor.v0 / PANEL_EVERY_M) * PANEL_EVERY_M + PANEL_EVERY_M / 2; pv < floor.v0 + rows * cell; pv += PANEL_EVERY_M) {
      const i = Math.floor((pu - floor.u0) / cell);
      const j = Math.floor((pv - floor.v0) / cell);
      if (!filled(i, j) || toneOf[j * cols + i] !== "lit") continue;
      const h = y1 - 0.01;
      panels.quad([at(pu - 0.6, pv - 0.15, h), at(pu + 0.6, pv - 0.15, h), at(pu + 0.6, pv + 0.15, h), at(pu - 0.6, pv + 0.15, h)], [0, -1, 0], palette.n100);
      // A lamp for each lit stretch, at its panel furthest from a wall: one by a wall burns it white.
      const key = `${Math.floor(pu / LAMP_EVERY_M)}:${Math.floor(pv / LAMP_EVERY_M)}`;
      const clear = clearance(fromCellFrame(floor, pu, pv));
      const lamp = lamps.get(key);
      if (clear >= LAMP_CLEAR_M && (!lamp || clear > lamp.clear)) lamps.set(key, { u: pu, v: pv, clear, n: (lamp?.n ?? 0) + 1 });
      else if (lamp) lamp.n++;
    }
  }
  for (const lamp of [...lamps.values()].sort((p, q) => q.n - p.n).slice(0, MAX_LAMPS)) {
    const light = new PointLight(palette.n100, 10, LAMP_EVERY_M * 0.9 + 3, 1.6);
    const [x, , z] = at(lamp.u, lamp.v, 0);
    light.position.set(x, y1 - 0.4, z);
    group.add(light);
  }

  // Walls: a slab each, both faces lit by the tone of the floor before them, the ends their own jambs.
  const half = PLAN.thickM / 2;
  const toneBy = (p: Vec) => LIGHT[tone(p)] ?? 1;
  const face = (a: Vec, b: Vec, n: Vec, bottom: number, top: number, k: number) => {
    const low = shade(palette.n700, k * 0.8);
    const high = shade(palette.n600, k);
    faces.quad([[a.x, bottom, a.y], [b.x, bottom, b.y], [b.x, top, b.y], [a.x, top, a.y]], [n.x, 0, n.y], low, high);
  };
  for (const wall of plan.walls) {
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    // A shut door is drawn as a door (scan-dress.ts), not wall.
    if (len < 1e-6 || wall.door) continue;
    const d = { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
    const mid = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
    for (const s of [1, -1]) {
      const n = { x: -d.y * s, y: d.x * s };
      const a = { x: wall.a.x + n.x * half, y: wall.a.y + n.y * half };
      const b = { x: wall.b.x + n.x * half, y: wall.b.y + n.y * half };
      const k = toneBy({ x: mid.x + n.x * 0.4, y: mid.y + n.y * 0.4 });
      face(a, b, n, y0, y1, k);
      edges.push(a.x, y0 + 0.01, a.y, b.x, y0 + 0.01, b.y, a.x, y1 - 0.01, a.y, b.x, y1 - 0.01, b.y);
      // A seam every four plan units.
      const step = FP.unitM * 4;
      for (let s2 = step; s2 < len - 0.2; s2 += step) {
        const px = a.x + d.x * s2 + n.x * 0.004;
        const pz = a.y + d.y * s2 + n.y * 0.004;
        seams.push(px, y0, pz, px, y1, pz);
      }
    }
    // The ends.
    for (const [end, out] of [[wall.a, { x: -d.x, y: -d.y }], [wall.b, d]] as const) {
      const n = { x: -d.y, y: d.x };
      const p = { x: end.x + n.x * half, y: end.y + n.y * half };
      const q = { x: end.x - n.x * half, y: end.y - n.y * half };
      face(p, q, out, y0, y1, 1);
    }
  }

  // Doorways: the floor across, and over a narrow one a lintel with its frame, as a fixture floor's doors have.
  for (const door of plan.doorways) {
    const len = Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y);
    if (len < 1e-6) continue;
    const d = { x: (door.b.x - door.a.x) / len, y: (door.b.y - door.a.y) / len };
    const n = { x: -d.y, y: d.x };
    const off = (p: Vec, by: number) => ({ x: p.x + n.x * by, y: p.y + n.y * by });
    const [pa, pb, qb, qa] = [off(door.a, half), off(door.b, half), off(door.b, -half), off(door.a, -half)];
    faces.quad([[pa.x, y0 + 0.002, pa.y], [pb.x, y0 + 0.002, pb.y], [qb.x, y0 + 0.002, qb.y], [qa.x, y0 + 0.002, qa.y]], [0, 1, 0], palette.n800);
    if (!door.lintel) continue;
    face(pa, pb, n, doorTop, y1, 1);
    face(qa, qb, { x: -n.x, y: -n.y }, doorTop, y1, 1);
    faces.quad([[pa.x, doorTop, pa.y], [pb.x, doorTop, pb.y], [qb.x, doorTop, qb.y], [qa.x, doorTop, qa.y]], [0, -1, 0], palette.n700);
    for (const by of [half + 0.006, -half - 0.006]) {
      const l = off(door.a, by);
      const r = off(door.b, by);
      trim.push(l.x, y0, l.y, l.x, doorTop, l.y, l.x, doorTop, l.y, r.x, doorTop, r.y, r.x, doorTop, r.y, r.x, y0, r.y);
    }
  }

  const solid = new Mesh(faces.geometry(), new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  solid.name = "rooms";
  group.add(solid);
  const glow = new Mesh(panels.geometry(), new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false }));
  glow.name = "ceiling-lights";
  group.add(glow);
  group.add(lines(grid, palette.n600, 0.35));
  group.add(lines(seams, palette.n500, 0.35));
  group.add(lines(edges, palette.n500, 0.9));
  group.add(lines(trim, palette.n300, 1));
  return group;
}
