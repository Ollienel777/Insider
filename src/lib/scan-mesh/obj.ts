// Reads the geometry out of a scan's OBJ file (issue 118): `v` and `f` lines
// only. The meshes the Model API serves carry no texture coordinates, no
// normals and no material library (checked on the kit, 2026-11-14), so the
// mesh has no texture of its own: its picture comes from the panoramas, and
// its bare look is shaded from the face normals.
//
// Vertices come out y-up (coords.ts). Faces with more than three corners are
// fanned into triangles; a corner may be `7`, `7/2`, `7//3` or `7/2/3`, and a
// negative index counts back from the last vertex read.
import { zUpToYUp } from "./coords";

export interface ParsedMesh {
  /** x, y, z per vertex, y-up, in metres. */
  positions: Float32Array;
  /** Three vertex numbers per triangle. */
  index: Uint32Array;
  /** Min and max corner of the vertices, y-up; null when there are none. */
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

export function parseObj(text: string): ParsedMesh {
  const positions: number[] = [];
  const index: number[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let count = 0;

  let start = 0;
  const end = text.length;
  while (start < end) {
    let stop = text.indexOf("\n", start);
    if (stop === -1) stop = end;
    const a = text.charCodeAt(start);
    const b = text.charCodeAt(start + 1);
    // "v " is a vertex; "vt", "vn" and "vp" are not.
    if (a === 118 && (b === 32 || b === 9)) {
      const parts = text.slice(start + 2, stop).trim().split(/\s+/);
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        const p = zUpToYUp(x, y, z);
        positions.push(p[0], p[1], p[2]);
        for (let i = 0; i < 3; i++) {
          if (p[i] < min[i]) min[i] = p[i];
          if (p[i] > max[i]) max[i] = p[i];
        }
      } else {
        // Keep the numbering: later faces count this line too.
        positions.push(0, 0, 0);
      }
      count++;
    } else if (a === 102 && (b === 32 || b === 9)) {
      const parts = text.slice(start + 2, stop).trim().split(/\s+/);
      const corners: number[] = [];
      for (const part of parts) {
        const n = parseInt(part, 10);
        if (!Number.isInteger(n) || n === 0) continue;
        const at = n > 0 ? n - 1 : count + n;
        if (at >= 0 && at < count) corners.push(at);
      }
      for (let i = 1; i + 1 < corners.length; i++) index.push(corners[0], corners[i], corners[i + 1]);
    }
    start = stop + 1;
  }

  return {
    positions: Float32Array.from(positions),
    index: Uint32Array.from(index),
    bounds: count > 0 && Number.isFinite(min[0]) ? { min, max } : null,
  };
}
