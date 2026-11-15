// The scan's flat surfaces, and the gaps in them (issue 118). Pure.
//
// A wall, a floor, a ceiling or a desk top is a plane, and the scanner
// leaves gaps in it: behind a monitor, under a chair, where glass or a
// mirror threw it off. The mesh's triangles are grouped into planes (those
// that share a normal and a distance from the origin), each plane's
// triangles are drawn onto a grid in the plane, and the grid's empty cells
// that the plane's own surface encloses are its holes. A hole is closed
// with rectangles in the plane, so the wall goes on across the gap. A gap
// open to the plane's edge is not a hole: a doorway reaches the floor, a
// corridor's mouth reaches the ceiling, and both stay open.
//
// The mesh also goes on where no camera looked (app/spike/mesh/seen.ts):
// the back of a partition, drawn from a guess with a blur for a texture.
// Told which triangles were seen, a plane's unseen part counts as a gap in
// it too: the unseen triangles are named for leaving out, and the same
// rectangles stand in for them. A patch is to be given a texture made from
// the seen surface beside it; where a plane has none beside the gap (a
// whole wall nobody saw), the patch names a donor instead: a well-seen
// square of the nearest plane of the same kind.
//
// A floor or a ceiling also goes on a little past its own edge: under a
// desk pushed against the wall the carpet was never scanned and nothing of
// the floor encloses the gap, but there is floor there. Which level planes
// are floors and ceilings is told from the cameras' heights: a floor is
// well under a camera and a ceiling over one, and the desk tops of an open
// office, one large plane between them, are neither.
import type { Vec3 } from "./coords";

export interface PlaneLimits {
  /** Normals within this cosine of each other, and offsets within this many metres, are one plane. */
  cosine: number;
  distance: number;
  /** A plane has at least this much surface, m². */
  minArea: number;
  /** At most this many planes, the largest first. */
  maxPlanes: number;
  /** The grid's cell, metres. */
  cell: number;
  /** A patch stands in for at least this much, m² (smaller holes are closed by lib/scan-mesh/holes.ts's fans)... */
  minPatch: number;
  /** ...and a gap is at most this many m² in an upright plane or a level one. */
  maxWallArea: number;
  maxLevelArea: number;
  /** An upright hole at least this tall, metres, that comes within `doorSill` of the plane's foot is a doorway: left open. */
  doorHeight: number;
  doorSill: number;
  /** An unseen stretch with less seen surface beside it than this part of its own size (within the patch's margin) is filled from a donor. */
  minContext: number;
  /** A patch is at most this many metres a side: a longer gap is cut into several. */
  tile: number;
  /** A floor or a ceiling with at least `levelArea` m² of surface goes on this many metres past its edge. */
  levelReach: number;
  levelArea: number;
  /** A floor is this far under some camera, metres, least and most; a ceiling this far over one. */
  floorUnder: [number, number];
  ceilingOver: [number, number];
  /** A donor is a square this many metres a side, at least this much of it seen. */
  donor: number;
  donorSeen: number;
}

export const PLANE_LIMITS: PlaneLimits = {
  cosine: Math.cos((12 * Math.PI) / 180),
  distance: 0.04,
  minArea: 0.6,
  maxPlanes: 400,
  cell: 0.04,
  minPatch: 0.03,
  maxWallArea: 5,
  maxLevelArea: 14,
  doorHeight: 1.6,
  doorSill: 0.35,
  minContext: 0.15,
  tile: 2.4,
  levelReach: 1.2,
  levelArea: 8,
  floorUnder: [1.05, 2.3],
  ceilingOver: [0.5, 5],
  donor: 1.2,
  donorSeen: 0.97,
};

/**
 * For what no panorama saw and no plane holds: the scan's guess at a
 * surface, and warped. A looser fit takes it for the plane it stands for.
 */
export const ROUGH_LIMITS: PlaneLimits = { ...PLANE_LIMITS, cosine: Math.cos((25 * Math.PI) / 180), distance: 0.12, minArea: 1 };

export interface Plane {
  /** Unit normal, and the plane's distance from the origin along it. */
  normal: Vec3;
  offset: number;
  /** Surface on it, m², and how many triangles. */
  area: number;
  triangles: number;
}

export interface PlaneFit {
  planes: Plane[];
  /** Per triangle: its plane's place in `planes`, or -1. */
  owner: Int32Array;
}

const NORMAL_BINS = 6;

/**
 * The planes that carry at least `minArea` of the mesh, largest first, and
 * which triangles lie on each. Triangles vote by area for a (normal,
 * offset) bin; the heaviest bins become planes, each refitted to the
 * triangles within `cosine` and `distance` of it.
 */
export function fitPlanes(positions: Float32Array, index: Uint32Array, limits: PlaneLimits = PLANE_LIMITS): PlaneFit {
  const count = Math.floor(index.length / 3);
  const normals = new Float32Array(count * 3);
  const offsets = new Float32Array(count);
  const areas = new Float32Array(count);
  const bins = new Map<string, { area: number; n: [number, number, number]; d: number }>();
  /** Triangles by the bin of their normal alone: a plane's triangles are in its own bin or one next to it. */
  const byNormal = new Map<number, number[]>();
  const normalKey = (x: number, y: number, z: number) => (Math.round(x * NORMAL_BINS) + 16) * 1024 + (Math.round(y * NORMAL_BINS) + 16) * 32 + Math.round(z * NORMAL_BINS) + 16;
  for (let t = 0; t < count; t++) {
    const a = index[t * 3] * 3;
    const b = index[t * 3 + 1] * 3;
    const c = index[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const twice = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(twice > 1e-10)) continue;
    nx /= twice;
    ny /= twice;
    nz /= twice;
    const d = (nx * (positions[a] + positions[b] + positions[c]) + ny * (positions[a + 1] + positions[b + 1] + positions[c + 1]) + nz * (positions[a + 2] + positions[b + 2] + positions[c + 2])) / 3;
    normals[t * 3] = nx;
    normals[t * 3 + 1] = ny;
    normals[t * 3 + 2] = nz;
    offsets[t] = d;
    areas[t] = twice / 2;
    const nk = normalKey(nx, ny, nz);
    const list = byNormal.get(nk);
    if (list) list.push(t);
    else byNormal.set(nk, [t]);
    const key = `${Math.round(nx * NORMAL_BINS)},${Math.round(ny * NORMAL_BINS)},${Math.round(nz * NORMAL_BINS)},${Math.round(d / (limits.distance * 2))}`;
    const bin = bins.get(key);
    if (bin) {
      bin.area += areas[t];
      bin.n[0] += nx * areas[t];
      bin.n[1] += ny * areas[t];
      bin.n[2] += nz * areas[t];
      bin.d += d * areas[t];
    } else bins.set(key, { area: areas[t], n: [nx * areas[t], ny * areas[t], nz * areas[t]], d: d * areas[t] });
  }

  const owner = new Int32Array(count).fill(-1);
  const planes: Plane[] = [];
  /** Bins of normal either way that can hold a triangle within the angle of a plane. */
  const span = Math.ceil(Math.acos(Math.min(1, limits.cosine)) * NORMAL_BINS);
  // A bin holds part of its plane (the rest fell in the bins next to it): a seed needs a share of the least area only.
  const seeds = [...bins.values()].filter((b) => b.area >= limits.minArea / 4).sort((a, b) => b.area - a.area);
  for (const seed of seeds) {
    if (planes.length >= limits.maxPlanes) break;
    const length = Math.hypot(seed.n[0], seed.n[1], seed.n[2]);
    if (!(length > 0)) continue;
    let normal: Vec3 = [seed.n[0] / length, seed.n[1] / length, seed.n[2] / length];
    let offset = seed.d / seed.area;
    // A seed whose plane has been taken already (it was a neighbouring bin of an earlier one).
    if (planes.some((p) => p.normal[0] * normal[0] + p.normal[1] * normal[1] + p.normal[2] * normal[2] > limits.cosine && Math.abs(p.offset - offset) < limits.distance)) continue;
    let members: number[] = [];
    // The triangles that could be on it: those whose normal's bin is the seed's or near enough to it.
    const near: number[] = [];
    const bx = Math.round(normal[0] * NORMAL_BINS);
    const by = Math.round(normal[1] * NORMAL_BINS);
    const bz = Math.round(normal[2] * NORMAL_BINS);
    for (let x = bx - span; x <= bx + span; x++) {
      for (let y = by - span; y <= by + span; y++) {
        for (let z = bz - span; z <= bz + span; z++) {
          const some = byNormal.get((x + 16) * 1024 + (y + 16) * 32 + z + 16);
          if (some) for (const t of some) near.push(t);
        }
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      members = [];
      const sum = [0, 0, 0];
      let d = 0;
      let area = 0;
      for (const t of near) {
        if (owner[t] !== -1 || areas[t] === 0) continue;
        const dot = normals[t * 3] * normal[0] + normals[t * 3 + 1] * normal[1] + normals[t * 3 + 2] * normal[2];
        if (dot < limits.cosine) continue;
        // The triangle's own middle against the plane, not its offset along its own (tilted) normal.
        const i = index[t * 3] * 3;
        const j = index[t * 3 + 1] * 3;
        const k = index[t * 3 + 2] * 3;
        const mid =
          (normal[0] * (positions[i] + positions[j] + positions[k]) + normal[1] * (positions[i + 1] + positions[j + 1] + positions[k + 1]) + normal[2] * (positions[i + 2] + positions[j + 2] + positions[k + 2])) / 3;
        if (Math.abs(mid - offset) > limits.distance) continue;
        members.push(t);
        sum[0] += normals[t * 3] * areas[t];
        sum[1] += normals[t * 3 + 1] * areas[t];
        sum[2] += normals[t * 3 + 2] * areas[t];
        d += mid * areas[t];
        area += areas[t];
      }
      if (area < limits.minArea) {
        members = [];
        break;
      }
      const l = Math.hypot(sum[0], sum[1], sum[2]);
      if (pass === 0 && l > 0) {
        normal = [sum[0] / l, sum[1] / l, sum[2] / l];
        offset = d / area;
      } else if (pass === 1) {
        planes.push({ normal, offset, area, triangles: members.length });
      }
    }
    for (const t of members) owner[t] = planes.length - 1;
  }
  return { planes, owner };
}

/**
 * `fit` with more planes: those a looser fit (`ROUGH_LIMITS`) finds among
 * the triangles that no plane holds yet and `seen` says no panorama saw.
 * Changes `fit` and returns how many planes it added.
 */
export function fitUnseen(positions: Float32Array, index: Uint32Array, fit: PlaneFit, seen: Uint8Array, limits: PlaneLimits = ROUGH_LIMITS): number {
  const from: number[] = [];
  const corners: number[] = [];
  for (let t = 0; t < fit.owner.length; t++) {
    if (fit.owner[t] !== -1 || seen[t]) continue;
    from.push(t);
    corners.push(index[t * 3], index[t * 3 + 1], index[t * 3 + 2]);
  }
  if (from.length === 0) return 0;
  const rough = fitPlanes(positions, Uint32Array.from(corners), limits);
  const first = fit.planes.length;
  rough.owner.forEach((plane, i) => {
    if (plane >= 0) fit.owner[from[i]] = first + plane;
  });
  fit.planes.push(...rough.planes);
  return rough.planes.length;
}

/** Two unit axes in the plane, at right angles: `v` is up for an upright plane. */
export function planeBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  const [nx, ny, nz] = normal;
  // Upright planes get (level, up); level ones (x, z).
  const ref: Vec3 = Math.abs(ny) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  let ux = ref[1] * nz - ref[2] * ny;
  let uy = ref[2] * nx - ref[0] * nz;
  let uz = ref[0] * ny - ref[1] * nx;
  const l = Math.hypot(ux, uy, uz) || 1;
  ux /= l;
  uy /= l;
  uz /= l;
  return { u: [ux, uy, uz], v: [ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux] };
}

export interface GridHole {
  /** Cells, as indices into the grid (row * width + column). */
  cells: number[];
  /** Columns and rows it spans, inclusive. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The enclosed gaps of a grid, `filled[row * width + column]` non-zero where
 * the surface is: every run of empty cells (joined by their sides) that no
 * path of empty cells joins to the grid's border.
 */
export function gridHoles(filled: Uint8Array, width: number, height: number): GridHole[] {
  // 0 unseen, 1 open (reaches the border), 2 in a hole.
  const mark = new Uint8Array(width * height);
  const stack: number[] = [];
  const flood = (start: number, value: number, into: number[] | null) => {
    stack.push(start);
    mark[start] = value;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      into?.push(at);
      const x = at % width;
      const y = (at - x) / width;
      if (x > 0) visit(at - 1);
      if (x < width - 1) visit(at + 1);
      if (y > 0) visit(at - width);
      if (y < height - 1) visit(at + width);
    }
    function visit(next: number) {
      if (filled[next] || mark[next]) return;
      mark[next] = value;
      stack.push(next);
    }
  };
  for (let x = 0; x < width; x++) {
    for (const at of [x, (height - 1) * width + x]) if (!filled[at] && !mark[at]) flood(at, 1, null);
  }
  for (let y = 0; y < height; y++) {
    for (const at of [y * width, y * width + width - 1]) if (!filled[at] && !mark[at]) flood(at, 1, null);
  }
  const holes: GridHole[] = [];
  for (let at = 0; at < filled.length; at++) {
    if (filled[at] || mark[at]) continue;
    const cells: number[] = [];
    flood(at, 2, cells);
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (const c of cells) {
      const x = c % width;
      const y = (c - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    holes.push({ cells, minX, maxX, minY, maxY });
  }
  return holes;
}

/**
 * Rectangles (x0, y0, x1, y1 in cells, the far edges exclusive) that cover
 * exactly the cells of `mask` that are non-zero: each row's runs, a run
 * joined to the same run in the row above.
 */
export function cellRects(mask: Uint8Array, width: number, height: number): number[] {
  const out: number[] = [];
  /** Open rectangles by "x0,x1": where each started. */
  let open = new Map<number, number>();
  for (let y = 0; y <= height; y++) {
    const next = new Map<number, number>();
    if (y < height) {
      let x = 0;
      while (x < width) {
        if (!mask[y * width + x]) {
          x++;
          continue;
        }
        const x0 = x;
        while (x < width && mask[y * width + x]) x++;
        const key = x0 * (width + 1) + x;
        next.set(key, open.get(key) ?? y);
        open.delete(key);
      }
    }
    for (const [key, y0] of open) {
      const x1 = key % (width + 1);
      out.push((key - x1) / (width + 1), y0, x1, y);
    }
    open = next;
  }
  return out;
}

export interface PlanePatch {
  /** The plane's place in the fit's list. */
  plane: number;
  /** A corner of the patch's box in the scan's frame, and its two sides: the box holds the hole and a margin round it. */
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  /** The box's size along `u` and `v`, metres. */
  width: number;
  height: number;
  normal: Vec3;
  /** The hole's own area, m². */
  area: number;
  /** Into the fill's corners: this patch's first, and how many. */
  start: number;
  count: number;
  /**
   * Set when the patch has too little seen surface of its own plane beside
   * it to be filled from: a well-seen square of another plane of the same
   * kind (a corner, its two sides and their length) to take the texture from.
   */
  donor?: { origin: Vec3; u: Vec3; v: Vec3; size: number };
}

export interface PlaneFill {
  /** Three corners a triangle, x y z each: not indexed. */
  positions: Float32Array;
  /** Each corner's place in its patch's box, 0 to 1 along `u` and `v`. */
  uvs: Float32Array;
  patches: PlanePatch[];
  /** Holes left open: too large, or a doorway. */
  open: number;
  /** Per triangle: 1 for an unseen one a patch stands in for, to be left out of the mesh. */
  replaced: Uint8Array;
  /** Unseen surface taken over by patches, m². */
  unseenArea: number;
}

/** Metres of the plane's own surface kept round a hole in its patch: what the hole is filled from. */
export const PATCH_MARGIN = 0.4;
/**
 * A patch sits this far behind its plane, metres (under a floor, over a
 * ceiling, and for a wall against its normal, which faces the room): the
 * surface round the gap is within `distance` of the plane either way, and
 * the patch must tuck under all of it.
 */
export const PATCH_BEHIND = 0.04;

/** The runs of non-zero cells of `mask`, joined by their sides. */
export function maskRuns(mask: Uint8Array, width: number, height: number): GridHole[] {
  const taken = new Uint8Array(mask.length);
  const out: GridHole[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || taken[start]) continue;
    const cells: number[] = [];
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    taken[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const at = stack.pop() as number;
      cells.push(at);
      const x = at % width;
      const y = (at - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const next of [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, y > 0 ? at - width : -1, y < height - 1 ? at + width : -1]) {
        if (next < 0 || !mask[next] || taken[next]) continue;
        taken[next] = 1;
        stack.push(next);
      }
    }
    out.push({ cells, minX, maxX, minY, maxY });
  }
  return out;
}

interface Donor {
  /** 0 a wall, 1 a surface facing up, 2 one facing down. */
  kind: number;
  centre: Vec3;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  size: number;
}

const kindOf = (normal: Vec3): number => (Math.abs(normal[1]) < 0.5 ? 0 : normal[1] > 0 ? 1 : 2);

/**
 * Rectangles that close each plane's gaps, one cell wider all round than
 * the gap so they tuck under the surface's edge (they are drawn just behind
 * it). With `seen` (per triangle, 1 where a panorama saw it), a plane's
 * unseen surface is a gap as well, and its triangles come back in
 * `replaced`. `cameras` are the heights the scan's panoramas were taken
 * at: with none, no plane is taken for a floor or a ceiling.
 */
export function fillPlanes(
  positions: Float32Array,
  index: Uint32Array,
  fit: PlaneFit,
  limits: PlaneLimits = PLANE_LIMITS,
  seen: Uint8Array | null = null,
  cameras: readonly number[] = [],
): PlaneFill {
  const outPositions: number[] = [];
  const outUvs: number[] = [];
  const patches: PlanePatch[] = [];
  /** Patches waiting for a donor: their place in `patches`, kind and middle. */
  const wanting: { patch: number; kind: number; centre: Vec3 }[] = [];
  const donors: Donor[] = [];
  const replaced = new Uint8Array(fit.owner.length);
  let open = 0;
  let unseenArea = 0;
  const byPlane: number[][] = fit.planes.map(() => []);
  for (let t = 0; t < fit.owner.length; t++) if (fit.owner[t] >= 0) byPlane[fit.owner[t]].push(t);
  const cell = limits.cell;
  const margin = Math.ceil(PATCH_MARGIN / cell);
  const tile = Math.max(4, Math.round(limits.tile / cell));
  const reach = Math.round(limits.levelReach / cell);
  const donorCells = Math.max(4, Math.round(limits.donor / cell));

  fit.planes.forEach((plane, at) => {
    const { u, v } = planeBasis(plane.normal);
    const tris = byPlane[at];
    if (tris.length === 0) return;
    const upright = Math.abs(plane.normal[1]) < 0.5;
    // A floor (well under a camera) or a ceiling (over one), whichever way its triangles are wound.
    const y = plane.offset * plane.normal[1];
    const lying = Math.abs(plane.normal[1]) > 0.9 && plane.area >= limits.levelArea;
    const floor = lying && cameras.some((camera) => camera - y >= limits.floorUnder[0] && camera - y <= limits.floorUnder[1]);
    const ceiling = lying && !floor && cameras.some((camera) => y - camera >= limits.ceilingOver[0] && y - camera <= limits.ceilingOver[1]);
    const level = floor || ceiling;
    // Each triangle's corners in the plane.
    const flat = new Float32Array(tris.length * 6);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    tris.forEach((t, n) => {
      for (let k = 0; k < 3; k++) {
        const p = index[t * 3 + k] * 3;
        const pu = positions[p] * u[0] + positions[p + 1] * u[1] + positions[p + 2] * u[2];
        const pv = positions[p] * v[0] + positions[p + 1] * v[1] + positions[p + 2] * v[2];
        flat[n * 6 + k * 2] = pu;
        flat[n * 6 + k * 2 + 1] = pv;
        if (pu < minU) minU = pu;
        if (pu > maxU) maxU = pu;
        if (pv < minV) minV = pv;
        if (pv > maxV) maxV = pv;
      }
    });
    // A cell of border all round, so the outside is one piece; a level plane also has room to go on past its edge.
    const pad = 1 + (level ? reach : 0);
    const width = Math.ceil((maxU - minU) / cell) + 1 + 2 * pad;
    const height = Math.ceil((maxV - minV) / cell) + 1 + 2 * pad;
    if (width * height > 40_000_000) return;
    const u0 = minU - pad * cell;
    const v0 = minV - pad * cell;
    // Behind the plane: under a floor, over a ceiling, and for the rest against the normal.
    const up = plane.normal[1] > 0 ? 1 : -1;
    const back = plane.offset + (floor ? -up : ceiling ? up : -1) * PATCH_BEHIND;
    const point = (pu: number, pv: number): Vec3 => [
      plane.normal[0] * back + u[0] * pu + v[0] * pv,
      plane.normal[1] * back + u[1] * pu + v[1] * pv,
      plane.normal[2] * back + u[2] * pu + v[2] * pv,
    ];
    /** Where the plane has surface at all, and where it has surface a panorama saw. */
    const any = new Uint8Array(width * height);
    const lit = seen ? new Uint8Array(width * height) : any;
    for (let n = 0; n < tris.length; n++) {
      rasterise(flat, n * 6, u0, v0, cell, width, height, any);
      if (seen && seen[tris[n]]) rasterise(flat, n * 6, u0, v0, cell, width, height, lit);
    }

    // The plane's best-seen square, for planes with nothing seen beside a gap to borrow from.
    if (seen && width >= donorCells && height >= donorCells) {
      // Seen cells above and to the left of each cell, for counting any square's in four look-ups.
      const sums = new Int32Array((width + 1) * (height + 1));
      for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
          row += lit[y * width + x];
          sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row;
        }
      }
      let best = -1;
      let bestX = 0;
      let bestY = 0;
      const step = Math.max(1, donorCells >> 2);
      for (let y = 0; y + donorCells <= height; y += step) {
        for (let x = 0; x + donorCells <= width; x += step) {
          const n = sums[(y + donorCells) * (width + 1) + x + donorCells] - sums[y * (width + 1) + x + donorCells] - sums[(y + donorCells) * (width + 1) + x] + sums[y * (width + 1) + x];
          if (n > best) {
            best = n;
            bestX = x;
            bestY = y;
          }
        }
      }
      if (best >= donorCells * donorCells * limits.donorSeen) {
        const size = donorCells * cell;
        donors.push({
          kind: kindOf(plane.normal),
          centre: point(u0 + bestX * cell + size / 2, v0 + bestY * cell + size / 2),
          origin: point(u0 + bestX * cell, v0 + bestY * cell),
          u,
          v,
          size,
        });
      }
    }

    const maxArea = upright ? limits.maxWallArea : limits.maxLevelArea;
    /** The cells to stand in for: 1 a true gap, 2 unseen surface. */
    const want = new Uint8Array(width * height);
    for (const hole of gridHoles(any, width, height)) {
      const tall = (hole.maxY - hole.minY + 1) * cell;
      // `v` is up on an upright plane, so the first row past the border is the plane's foot.
      const doorway = upright && tall >= limits.doorHeight && (hole.minY - pad) * cell <= limits.doorSill;
      if (hole.cells.length * cell * cell > maxArea || doorway) {
        open++;
        continue;
      }
      for (const c of hole.cells) want[c] = 1;
    }
    if (level) {
      // A floor or a ceiling goes on past its edge: the empty cells within reach of its surface, nearest first.
      let frontier: number[] = [];
      for (let c = 0; c < any.length; c++) if (any[c]) frontier.push(c);
      const near = Uint8Array.from(any);
      for (let step = 0; step < reach && frontier.length > 0; step++) {
        const next: number[] = [];
        for (const c of frontier) {
          const x = c % width;
          const y = (c - x) / width;
          for (const n of [x > 0 ? c - 1 : -1, x < width - 1 ? c + 1 : -1, y > 0 ? c - width : -1, y < height - 1 ? c + width : -1]) {
            if (n < 0 || near[n]) continue;
            near[n] = 1;
            want[n] = 1;
            next.push(n);
          }
        }
        frontier = next;
      }
    }
    if (seen) for (let c = 0; c < want.length; c++) if (any[c] && !lit[c]) want[c] = 2;

    /** Per cell: the patch that stands in for it, plus one. */
    const patchOf = seen ? new Int32Array(width * height) : null;
    for (const run of maskRuns(want, width, height)) {
      if (run.cells.length * cell * cell < limits.minPatch) continue;
      let unseen = 0;
      for (const c of run.cells) if (want[c] === 2) unseen++;
      let borrow = false;
      if (unseen > 0) {
        // Seen surface of this plane beside it, to fill it from: else a donor's.
        let context = 0;
        const x0 = Math.max(0, run.minX - margin);
        const x1 = Math.min(width - 1, run.maxX + margin);
        const y0 = Math.max(0, run.minY - margin);
        const y1 = Math.min(height - 1, run.maxY + margin);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lit[y * width + x]) context++;
        borrow = context < unseen * limits.minContext;
      }
      // Cut into tiles, so no patch is too large for its texture to be fine.
      const tiles = new Map<number, number[]>();
      for (const c of run.cells) {
        const x = c % width;
        const key = Math.floor((c - x) / width / tile) * 65536 + Math.floor(x / tile);
        const list = tiles.get(key);
        if (list) list.push(c);
        else tiles.set(key, [c]);
      }
      for (const cells of tiles.values()) emit(cells, borrow);
    }

    function emit(cells: number[], borrow: boolean): void {
      let minX = width;
      let maxX = -1;
      let minY = height;
      let maxY = -1;
      let unseen = 0;
      for (const c of cells) {
        const x = c % width;
        const y = (c - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (want[c] === 2) unseen++;
      }
      // The gap a cell wider all round, on its own small grid.
      const w = maxX - minX + 3;
      const h = maxY - minY + 3;
      const mask = new Uint8Array(w * h);
      for (const c of cells) {
        const x = (c % width) - minX + 1;
        const y = Math.floor(c / width) - minY + 1;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mask[(y + dy) * w + x + dx] = 1;
        if (patchOf && want[c] === 2) patchOf[c] = patches.length + 1;
      }
      unseenArea += unseen * cell * cell;
      const boxU = u0 + (minX - 1) * cell - PATCH_MARGIN;
      const boxV = v0 + (minY - 1) * cell - PATCH_MARGIN;
      const boxW = w * cell + 2 * PATCH_MARGIN;
      const boxH = h * cell + 2 * PATCH_MARGIN;
      const start = outPositions.length / 3;
      const corner = (pu: number, pv: number) => {
        outPositions.push(...point(pu, pv));
        outUvs.push((pu - boxU) / boxW, (pv - boxV) / boxH);
      };
      const rects = cellRects(mask, w, h);
      for (let r = 0; r < rects.length; r += 4) {
        const a = u0 + (minX - 1 + rects[r]) * cell;
        const b = v0 + (minY - 1 + rects[r + 1]) * cell;
        const c = u0 + (minX - 1 + rects[r + 2]) * cell;
        const d = v0 + (minY - 1 + rects[r + 3]) * cell;
        corner(a, b);
        corner(c, b);
        corner(c, d);
        corner(a, b);
        corner(c, d);
        corner(a, d);
      }
      if (borrow) wanting.push({ patch: patches.length, kind: kindOf(plane.normal), centre: point(boxU + boxW / 2, boxV + boxH / 2) });
      patches.push({
        plane: at,
        origin: point(boxU, boxV),
        u,
        v,
        width: boxW,
        height: boxH,
        normal: plane.normal,
        area: cells.length * cell * cell,
        start,
        count: outPositions.length / 3 - start,
      });
    }

    // The unseen triangles a patch now stands in for: by the cell their middle is in.
    if (seen && patchOf) {
      tris.forEach((t, n) => {
        if (seen[t]) return;
        const x = Math.floor(((flat[n * 6] + flat[n * 6 + 2] + flat[n * 6 + 4]) / 3 - u0) / cell);
        const y = Math.floor(((flat[n * 6 + 1] + flat[n * 6 + 3] + flat[n * 6 + 5]) / 3 - v0) / cell);
        if (x >= 0 && x < width && y >= 0 && y < height && patchOf[y * width + x] > 0) replaced[t] = 1;
      });
    }
  });

  // Each patch with nothing seen beside it borrows from the nearest well-seen square of its kind; a floor's or a ceiling's from its own height.
  for (const { patch, kind, centre } of wanting) {
    let best: Donor | null = null;
    let least = Infinity;
    for (const donor of donors) {
      if (donor.kind !== kind) continue;
      if (kind !== 0 && Math.abs(donor.centre[1] - centre[1]) > 0.4) continue;
      const d = (donor.centre[0] - centre[0]) ** 2 + (donor.centre[1] - centre[1]) ** 2 + (donor.centre[2] - centre[2]) ** 2;
      if (d < least) {
        least = d;
        best = donor;
      }
    }
    if (best) patches[patch].donor = { origin: best.origin, u: best.u, v: best.v, size: best.size };
  }
  return { positions: Float32Array.from(outPositions), uvs: Float32Array.from(outUvs), patches, open, replaced, unseenArea };
}

/** Marks the cells whose middle the triangle at `flat[at..at+6]` covers, and the cells its corners are in. */
function rasterise(flat: Float32Array, at: number, u0: number, v0: number, cell: number, width: number, height: number, filled: Uint8Array): void {
  const ax = (flat[at] - u0) / cell;
  const ay = (flat[at + 1] - v0) / cell;
  const bx = (flat[at + 2] - u0) / cell;
  const by = (flat[at + 3] - v0) / cell;
  const cx = (flat[at + 4] - u0) / cell;
  const cy = (flat[at + 5] - v0) / cell;
  const clampX = (x: number) => Math.min(width - 1, Math.max(0, Math.floor(x)));
  const clampY = (y: number) => Math.min(height - 1, Math.max(0, Math.floor(y)));
  filled[clampY(ay) * width + clampX(ax)] = 1;
  filled[clampY(by) * width + clampX(bx)] = 1;
  filled[clampY(cy) * width + clampX(cx)] = 1;
  const x0 = clampX(Math.min(ax, bx, cx));
  const x1 = clampX(Math.max(ax, bx, cx));
  const y0 = clampY(Math.min(ay, by, cy));
  const y1 = clampY(Math.max(ay, by, cy));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-12) return;
  const sign = area > 0 ? 1 : -1;
  // Half a cell of slack on each edge: a cell the triangle only clips still counts as surface.
  const s0 = -0.5 * Math.hypot(bx - ax, by - ay);
  const s1 = -0.5 * Math.hypot(cx - bx, cy - by);
  const s2 = -0.5 * Math.hypot(ax - cx, ay - cy);
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const e0 = sign * ((bx - ax) * (py - ay) - (by - ay) * (px - ax));
      const e1 = sign * ((cx - bx) * (py - by) - (cy - by) * (px - bx));
      const e2 = sign * ((ax - cx) * (py - cy) - (ay - cy) * (px - cx));
      if (e0 >= s0 && e1 >= s1 && e2 >= s2) filled[y * width + x] = 1;
    }
  }
}
