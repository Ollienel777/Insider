// Ambient occlusion baked into the mesh's vertices (issue 118, the clean
// view): how much of the open space over each vertex the mesh itself hides,
// near at hand. The mesh is marked into a coarse grid of filled cells, and
// from each vertex a few short rays go out over its surface; each filled cell
// one meets counts, the nearer the more. A floor meeting a wall, the space
// under a desk and the inside of a corner come out darker; an open wall does
// not. View-independent, so it never swims as the eye moves.

export interface OcclusionLimits {
  /** The grid's cell, metres, and the most cells it may have (the cell grows past that). */
  cell: number;
  maxCells: number;
  /** How far the rays look, metres. */
  reach: number;
}

export const OCCLUSION_LIMITS: OcclusionLimits = { cell: 0.07, maxCells: 48_000_000, reach: 0.5 };

/** Ray directions in a vertex's own frame (z along its normal): the normal, and rings at 55° and 25° over the surface. */
const DIRECTIONS: [number, number, number][] = (() => {
  const out: [number, number, number][] = [[0, 0, 1]];
  for (const [elevation, count, turn] of [
    [55, 6, 0],
    [25, 8, 0.5],
  ] as const) {
    const e = (elevation * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const a = ((i + turn) / count) * Math.PI * 2;
      out.push([Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)]);
    }
  }
  return out;
})();

/**
 * Per vertex of `positions` (x y z each), 0 for open to 1 for shut in, from
 * the triangles of `index` over them. Vertices no triangle uses get 0.
 */
export function vertexOcclusion(positions: Float32Array, index: Uint32Array, limits: OcclusionLimits = OCCLUSION_LIMITS): Float32Array {
  const vertexCount = Math.floor(positions.length / 3);
  const out = new Float32Array(vertexCount);
  if (index.length < 3) return out;
  // The box of what is used, and the normals, area-weighted.
  const normals = new Float32Array(vertexCount * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
      for (let k = 0; k < 3; k++) {
        if (positions[v + k] < min[k]) min[k] = positions[v + k];
        if (positions[v + k] > max[k]) max[k] = positions[v + k];
      }
    }
  }
  let cell = limits.cell;
  const size = () => [0, 1, 2].map((k) => Math.max(1, Math.ceil((max[k] - min[k]) / cell) + 3));
  let dims = size();
  while (dims[0] * dims[1] * dims[2] > limits.maxCells) {
    cell *= 1.25;
    dims = size();
  }
  const [nx, ny, nz] = dims;
  const grid = new Uint8Array(nx * ny * nz);
  const ox = min[0] - cell;
  const oy = min[1] - cell;
  const oz = min[2] - cell;
  const mark = (x: number, y: number, z: number) => {
    const i = Math.floor((x - ox) / cell);
    const j = Math.floor((y - oy) / cell);
    const k = Math.floor((z - oz) / cell);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) grid[(k * ny + j) * nx + i] = 1;
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const long = Math.max(
      Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]),
      Math.hypot(positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]),
      Math.hypot(positions[c] - positions[b], positions[c + 1] - positions[b + 1], positions[c + 2] - positions[b + 2]),
    );
    const n = Math.min(64, Math.max(1, Math.ceil(long / (cell * 0.5))));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        mark(
          positions[a] * w + positions[b] * u + positions[c] * v,
          positions[a + 1] * w + positions[b + 1] * u + positions[c + 1] * v,
          positions[a + 2] * w + positions[b + 2] * u + positions[c + 2] * v,
        );
      }
    }
  }
  const filled = (x: number, y: number, z: number): boolean => {
    const i = Math.floor((x - ox) / cell);
    const j = Math.floor((y - oy) / cell);
    const k = Math.floor((z - oz) / cell);
    return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && grid[(k * ny + j) * nx + i] === 1;
  };
  const lift = cell * 1.6;
  // Steps under a cell apart, so no ray passes through a filled cell between two of them.
  const steps = Math.max(2, Math.ceil(limits.reach / (cell * 0.8)));
  for (let v = 0; v < vertexCount; v++) {
    const p = v * 3;
    let ax = normals[p];
    let ay = normals[p + 1];
    let az = normals[p + 2];
    const length = Math.hypot(ax, ay, az);
    if (length === 0) continue;
    ax /= length;
    ay /= length;
    az /= length;
    // A frame round the normal.
    let tx = Math.abs(ay) < 0.9 ? -az : 0;
    let ty = Math.abs(ay) < 0.9 ? 0 : az;
    let tz = Math.abs(ay) < 0.9 ? ax : -ay;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ay * tz - az * ty;
    const by = az * tx - ax * tz;
    const bz = ax * ty - ay * tx;
    const sx = positions[p] + ax * lift;
    const sy = positions[p + 1] + ay * lift;
    const sz = positions[p + 2] + az * lift;
    let hidden = 0;
    for (const [dx, dy, dz] of DIRECTIONS) {
      const rx = tx * dx + bx * dy + ax * dz;
      const ry = ty * dx + by * dy + ay * dz;
      const rz = tz * dx + bz * dy + az * dz;
      for (let s = 1; s <= steps; s++) {
        const d = (s / steps) * limits.reach;
        if (filled(sx + rx * d, sy + ry * d, sz + rz * d)) {
          // The nearer what it meets, the more it hides.
          hidden += 1 - (s - 1) / steps;
          break;
        }
      }
    }
    out[v] = Math.min(1, hidden / DIRECTIONS.length);
  }
  return out;
}
