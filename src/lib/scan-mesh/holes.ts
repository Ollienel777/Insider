// Small holes in the scan's mesh, closed (issue 118). Pure.
//
// The scanner leaves gaps where it saw nothing: a patch of floor under a
// chair, a sliver of wall behind a plant. Each is a loop of edges that only
// one triangle uses. A loop that is short and small across is a hole and is
// closed with a fan of triangles about its middle; a long or wide one is the
// edge of what was scanned (a doorway into an unscanned room, a window) and
// is left open.

export interface HoleLimits {
  /** At most this many edges round a hole. */
  maxEdges: number;
  /** At most this far across, metres (its box's longest side). */
  maxSpan: number;
}

export const HOLE_LIMITS: HoleLimits = { maxEdges: 120, maxSpan: 1.2 };

export interface ClosedHoles {
  /** Three corners a triangle, x y z each: not indexed. */
  triangles: Float32Array;
  holes: number;
  /** Loops left open: too long or too wide. */
  open: number;
}

/**
 * The triangles that close every small hole in the mesh `index` over
 * `positions` (x y z per vertex). The mesh must share vertices between its
 * triangles (welded), or every triangle's edges read as a hole's.
 */
export function closeHoles(positions: Float32Array, index: Uint32Array, limits: HoleLimits = HOLE_LIMITS): ClosedHoles {
  const vertices = positions.length / 3;
  const key = (a: number, b: number) => a * vertices + b;
  const edges = new Set<number>();
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i];
    const b = index[i + 1];
    const c = index[i + 2];
    if (a === b || b === c || c === a) continue;
    edges.add(key(a, b));
    edges.add(key(b, c));
    edges.add(key(c, a));
  }
  // An edge on a hole's rim: used one way round only. Rim edges leaving each vertex.
  const next = new Map<number, number[]>();
  for (const e of edges) {
    const a = Math.floor(e / vertices);
    const b = e - a * vertices;
    if (edges.has(key(b, a))) continue;
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  }

  const out: number[] = [];
  let holes = 0;
  let open = 0;
  const take = (from: number): number | undefined => {
    const list = next.get(from);
    if (!list || list.length === 0) return undefined;
    const to = list.pop();
    if (list.length === 0) next.delete(from);
    return to;
  };
  for (const startVertex of [...next.keys()]) {
    while (next.has(startVertex)) {
      const loop = [startVertex];
      let at = take(startVertex);
      let closed = false;
      while (at !== undefined) {
        if (at === startVertex) {
          closed = true;
          break;
        }
        loop.push(at);
        at = take(at);
      }
      if (!closed || loop.length < 3) {
        open++;
        continue;
      }
      if (loop.length > limits.maxEdges || span(positions, loop) > limits.maxSpan) {
        open++;
        continue;
      }
      holes++;
      fan(positions, loop, out);
    }
  }
  return { triangles: Float32Array.from(out), holes, open };
}

function span(positions: Float32Array, loop: readonly number[]): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of loop) {
    for (let k = 0; k < 3; k++) {
      const c = positions[v * 3 + k];
      if (c < min[k]) min[k] = c;
      if (c > max[k]) max[k] = c;
    }
  }
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

/** Triangles from the loop's middle to each of its edges. A triangle (three edges) is itself. */
function fan(positions: Float32Array, loop: readonly number[], out: number[]): void {
  const corner = (v: number) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
  if (loop.length === 3) {
    // Wound against the rim, like the triangles round it.
    out.push(...corner(loop[0]), ...corner(loop[2]), ...corner(loop[1]));
    return;
  }
  const middle = [0, 0, 0];
  for (const v of loop) for (let k = 0; k < 3; k++) middle[k] += positions[v * 3 + k] / loop.length;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    out.push(...middle, ...corner(b), ...corner(a));
  }
}
