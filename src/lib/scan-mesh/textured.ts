// The Matterpak's mesh with its textures (issue 118): the OBJ's `v`, `vt`,
// `f` and `usemtl` lines, and the material library's `newmtl` and `map_Kd`.
// Pure: text in, arrays out.
//
// A texture coordinate belongs to one corner of one chart, so a vertex that
// sits on a seam between charts is split, one copy per coordinate: the
// output is indexed by (vertex, coordinate) pair. Triangles come out sorted
// by material, one run per material (`groups`), so each draws with one
// texture. Coordinates come out with v flipped (images are read top row
// first), and positions y-up (coords.ts).
import { zUpToYUp } from "./coords";

export interface TexturedGroup {
  /** Into `index`: the first of this material's corners, and how many. */
  start: number;
  count: number;
  /** The texture's file name, from the material library; null when it names none. */
  image: string | null;
  /** The middle and half-size of the group's triangles' box, y-up: for loading the nearest textures first. */
  centre: [number, number, number];
  extent: [number, number, number];
}

export interface TexturedMesh {
  positions: Float32Array;
  uvs: Float32Array;
  index: Uint32Array;
  groups: TexturedGroup[];
  /** The OBJ's own vertices, y-up, each once, and `index` by them: the mesh welded, for finding its holes. */
  vertices: Float32Array;
  welded: Uint32Array;
}

/** Material name to texture file name, from an MTL file's `newmtl` and `map_Kd` lines. */
export function parseMtl(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("newmtl ")) current = line.slice(7).trim();
    else if (line.startsWith("map_Kd ") && current !== null) {
      // The file name is the last word; options such as `-s 1 1 1` come before it.
      const words = line.slice(7).trim().split(/\s+/);
      const file = words[words.length - 1].replace(/\\/g, "/");
      out.set(current, file.slice(file.lastIndexOf("/") + 1));
    }
  }
  return out;
}

const NONE = 0xffffffff;

export function parseTexturedObj(text: string, materials: ReadonlyMap<string, string> = new Map()): TexturedMesh {
  const v: number[] = [];
  const vt: number[] = [];
  /** Per material, in order of first use: the (vertex, coordinate) pairs of its triangles' corners. */
  const faces = new Map<string, number[]>();
  let current: number[] = [];
  faces.set("", current);
  const end = text.length;
  let start = 0;
  while (start < end) {
    let stop = text.indexOf("\n", start);
    if (stop === -1) stop = end;
    const a = text.charCodeAt(start);
    const b = text.charCodeAt(start + 1);
    if (a === 118 && (b === 32 || b === 9)) {
      const p = text.slice(start + 2, stop).trim().split(/\s+/);
      const x = Number(p[0]);
      const y = Number(p[1]);
      const z = Number(p[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) v.push(...zUpToYUp(x, y, z));
      else v.push(0, 0, 0);
    } else if (a === 118 && b === 116) {
      const p = text.slice(start + 3, stop).trim().split(/\s+/);
      const s = Number(p[0]);
      const t = Number(p[1]);
      vt.push(Number.isFinite(s) ? s : 0, Number.isFinite(t) ? 1 - t : 0);
    } else if (a === 102 && (b === 32 || b === 9)) {
      const parts = text.slice(start + 2, stop).trim().split(/\s+/);
      const corners: number[] = [];
      const vCount = v.length / 3;
      const tCount = vt.length / 2;
      for (const part of parts) {
        const slash = part.indexOf("/");
        const n = parseInt(slash === -1 ? part : part.slice(0, slash), 10);
        if (!Number.isInteger(n) || n === 0) continue;
        const at = n > 0 ? n - 1 : vCount + n;
        if (at < 0 || at >= vCount) continue;
        let tAt = NONE;
        if (slash !== -1) {
          const m = parseInt(part.slice(slash + 1), 10);
          if (Number.isInteger(m) && m !== 0) {
            const t = m > 0 ? m - 1 : tCount + m;
            if (t >= 0 && t < tCount) tAt = t;
          }
        }
        corners.push(at, tAt);
      }
      for (let i = 2; i + 3 < corners.length; i += 2) {
        current.push(corners[0], corners[1], corners[i], corners[i + 1], corners[i + 2], corners[i + 3]);
      }
    } else if (text.startsWith("usemtl", start)) {
      const name = text.slice(start + 6, stop).trim();
      let list = faces.get(name);
      if (!list) {
        list = [];
        faces.set(name, list);
      }
      current = list;
    }
    start = stop + 1;
  }

  // Number each (vertex, coordinate) pair once. A coordinate almost always
  // belongs to one vertex, so the pairs are found by coordinate first.
  const byCoordinate = new Int32Array(vt.length / 2 + 1).fill(-1);
  const coordinateVertex = new Int32Array(vt.length / 2 + 1).fill(-1);
  const others = new Map<number, number>();
  const outV: number[] = [];
  const outT: number[] = [];
  const source: number[] = [];
  const id = (vi: number, ti: number): number => {
    const slot = ti === NONE ? vt.length / 2 : ti;
    if (byCoordinate[slot] !== -1 && coordinateVertex[slot] === vi) return byCoordinate[slot];
    if (byCoordinate[slot] !== -1) {
      const key = vi * 1_048_576 * 4 + slot;
      const found = others.get(key);
      if (found !== undefined) return found;
    }
    const n = outV.length / 3;
    outV.push(v[vi * 3], v[vi * 3 + 1], v[vi * 3 + 2]);
    outT.push(ti === NONE ? 0 : vt[ti * 2], ti === NONE ? 0 : vt[ti * 2 + 1]);
    source.push(vi);
    if (byCoordinate[slot] === -1) {
      byCoordinate[slot] = n;
      coordinateVertex[slot] = vi;
    } else others.set(vi * 1_048_576 * 4 + slot, n);
    return n;
  };

  const index: number[] = [];
  const groups: TexturedGroup[] = [];
  for (const [name, list] of faces) {
    if (list.length === 0) continue;
    const begin = index.length;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < list.length; i += 2) {
      const vi = list[i];
      index.push(id(vi, list[i + 1]));
      for (let k = 0; k < 3; k++) {
        const c = v[vi * 3 + k];
        if (c < min[k]) min[k] = c;
        if (c > max[k]) max[k] = c;
      }
    }
    groups.push({
      start: begin,
      count: index.length - begin,
      image: materials.get(name) ?? null,
      centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      extent: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
    });
  }
  const welded = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) welded[i] = source[index[i]];
  return {
    positions: Float32Array.from(outV),
    uvs: Float32Array.from(outT),
    index: Uint32Array.from(index),
    groups,
    vertices: Float32Array.from(v),
    welded,
  };
}

/** How far `eye` is from a group's box, metres: 0 inside it. */
export function distanceToGroup(group: Pick<TexturedGroup, "centre" | "extent">, eye: readonly [number, number, number]): number {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.max(0, Math.abs(eye[k] - group.centre[k]) - group.extent[k]);
    sum += d * d;
  }
  return Math.sqrt(sum);
}
