// The scan mesh's shards (issue 118). Pure.
//
// Where the scanner was thrown off (glass, a mirror, the edge of what it
// saw) the mesh has triangles that are no surface at all: long spans
// bridging a gap, slivers along a hole's rim, texture pulled across a
// stretch many times its size, and loose scraps hanging in the air. Drawn,
// they read as torn shards. They are found here and left out; the gaps they
// leave are closed like any other hole.

export interface ShardLimits {
  /** An edge longer than this many times the mesh's typical edge (its 90th percentile), and than `minLong` metres, is a span. */
  longFactor: number;
  minLong: number;
  /** A triangle whose height on its longest edge is under this part of the edge, and whose edge is over `minSliver` metres, is a sliver. */
  sliver: number;
  minSliver: number;
  /** A triangle whose surface per texture area is this many times its texture's typical one is stretched. */
  stretch: number;
  /** A piece of the mesh joined to nothing else, with less surface than this, m², is a scrap. */
  scrapArea: number;
}

export const SHARD_LIMITS: ShardLimits = { longFactor: 6, minLong: 0.9, sliver: 0.04, minSliver: 0.35, stretch: 24, scrapArea: 0.08 };

/** Why a triangle is a shard, as bits. */
export const SHARD_LONG = 1;
export const SHARD_SLIVER = 2;
export const SHARD_STRETCH = 4;
export const SHARD_SCRAP = 8;

export interface Shards {
  /** Per triangle: 0, or the reasons it is a shard. */
  flags: Uint8Array;
  count: number;
  long: number;
  sliver: number;
  stretched: number;
  scrap: number;
  /** The mesh's typical edge, metres (90th percentile of triangles' longest edges). */
  typicalEdge: number;
}

export interface ShardGroup {
  start: number;
  count: number;
}

const percentile = (values: Float32Array, p: number): number => {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

/**
 * Which triangles of the mesh are shards. `index` is over `positions` (x y
 * z) and `uvs` (two a vertex); `welded` is the same triangles over shared
 * vertices, for telling loose scraps (null skips that test); `groups` are
 * the runs of `index` that share a texture (none skips the stretch test).
 */
export function findShards(
  positions: Float32Array,
  uvs: Float32Array | null,
  index: Uint32Array,
  welded: Uint32Array | null = null,
  groups: readonly ShardGroup[] = [],
  limits: ShardLimits = SHARD_LIMITS,
): Shards {
  const count = Math.floor(index.length / 3);
  const flags = new Uint8Array(count);
  const longest = new Float32Array(count);
  const areas = new Float32Array(count);
  for (let t = 0; t < count; t++) {
    const a = index[t * 3] * 3;
    const b = index[t * 3 + 1] * 3;
    const c = index[t * 3 + 2] * 3;
    const ab = Math.sqrt((positions[b] - positions[a]) ** 2 + (positions[b + 1] - positions[a + 1]) ** 2 + (positions[b + 2] - positions[a + 2]) ** 2);
    const bc = Math.sqrt((positions[c] - positions[b]) ** 2 + (positions[c + 1] - positions[b + 1]) ** 2 + (positions[c + 2] - positions[b + 2]) ** 2);
    const ca = Math.sqrt((positions[a] - positions[c]) ** 2 + (positions[a + 1] - positions[c + 1]) ** 2 + (positions[a + 2] - positions[c + 2]) ** 2);
    longest[t] = Math.max(ab, bc, ca);
    // Heron's formula.
    const s = (ab + bc + ca) / 2;
    areas[t] = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)));
  }
  const typicalEdge = percentile(longest, 0.9);
  const tooLong = Math.max(limits.minLong, typicalEdge * limits.longFactor);
  const out: Shards = { flags, count: 0, long: 0, sliver: 0, stretched: 0, scrap: 0, typicalEdge };
  for (let t = 0; t < count; t++) {
    if (longest[t] > tooLong) flags[t] |= SHARD_LONG;
    // Height on the longest edge over the edge: 2 * area / edge².
    if (longest[t] > limits.minSliver && (2 * areas[t]) / (longest[t] * longest[t]) < limits.sliver) flags[t] |= SHARD_SLIVER;
  }

  if (uvs) {
    for (const group of groups) {
      const first = Math.floor(group.start / 3);
      const n = Math.floor(group.count / 3);
      const density = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const t = first + k;
        const a = index[t * 3] * 2;
        const b = index[t * 3 + 1] * 2;
        const c = index[t * 3 + 2] * 2;
        const uv = Math.abs((uvs[b] - uvs[a]) * (uvs[c + 1] - uvs[a + 1]) - (uvs[b + 1] - uvs[a + 1]) * (uvs[c] - uvs[a])) / 2;
        // Surface per texture area: large where a little texture is pulled over a lot of surface.
        density[k] = uv > 1e-12 ? areas[t] / uv : Infinity;
      }
      const typical = percentile(density.filter((d) => Number.isFinite(d)), 0.5);
      if (!(typical > 0)) continue;
      for (let k = 0; k < n; k++) {
        // Small triangles are left alone: a stretched speck does not show.
        if (density[k] > typical * limits.stretch && longest[first + k] > limits.minSliver) flags[first + k] |= SHARD_STRETCH;
      }
    }
  }

  if (welded) {
    // Pieces: triangles joined through shared vertices.
    let vertices = 0;
    for (let i = 0; i < welded.length; i++) if (welded[i] >= vertices) vertices = welded[i] + 1;
    const parent = new Int32Array(vertices);
    for (let i = 0; i < vertices; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (let t = 0; t < count; t++) {
      const a = find(welded[t * 3]);
      const b = find(welded[t * 3 + 1]);
      if (b !== a) parent[b] = a;
      const c = find(welded[t * 3 + 2]);
      if (c !== a) parent[c] = a;
    }
    const pieceArea = new Float64Array(vertices);
    for (let t = 0; t < count; t++) pieceArea[find(welded[t * 3])] += areas[t];
    for (let t = 0; t < count; t++) if (pieceArea[find(welded[t * 3])] < limits.scrapArea) flags[t] |= SHARD_SCRAP;
  }

  for (let t = 0; t < count; t++) {
    const f = flags[t];
    if (f === 0) continue;
    out.count++;
    if (f & SHARD_LONG) out.long++;
    if (f & SHARD_SLIVER) out.sliver++;
    if (f & SHARD_STRETCH) out.stretched++;
    if (f & SHARD_SCRAP) out.scrap++;
  }
  return out;
}

/**
 * `index` (and the same triangles in `welded`) without the flagged
 * triangles, and `groups` moved to match: each still one run.
 */
export function dropTriangles<G extends ShardGroup>(
  index: Uint32Array,
  welded: Uint32Array,
  groups: readonly G[],
  flags: Uint8Array,
): { index: Uint32Array; welded: Uint32Array; groups: G[] } {
  const outIndex = new Uint32Array(index.length);
  const outWelded = new Uint32Array(index.length);
  const outGroups: G[] = [];
  let at = 0;
  const copy = (t: number) => {
    if (flags[t] !== 0) return;
    for (let k = 0; k < 3; k++) {
      outIndex[at] = index[t * 3 + k];
      outWelded[at] = welded[t * 3 + k];
      at++;
    }
  };
  for (const group of groups) {
    const start = at;
    const first = Math.floor(group.start / 3);
    for (let t = first; t < first + Math.floor(group.count / 3); t++) copy(t);
    outGroups.push({ ...group, start, count: at - start });
  }
  // A mesh with no groups keeps its triangles' order.
  if (groups.length === 0) for (let t = 0; t < flags.length; t++) copy(t);
  return { index: outIndex.slice(0, at), welded: outWelded.slice(0, at), groups: outGroups };
}
