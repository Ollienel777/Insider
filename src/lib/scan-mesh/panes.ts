// The walls as whole sheets, for what the scan could not see through
// (issue 118, the imaging A2 experiment). Pure.
//
// Glass comes back from the scanner as next to nothing: a partition beside
// an office door, a window, is a hole in its wall onto whatever the laser
// reached beyond, and where that was nothing (an office no one walked into,
// the street) a panorama's depth there is nothing at all. The photograph
// still shows the glass and what is through it. So each upright plane of the
// mesh (lib/scan-mesh/planes.ts) is laid out again as one or a few
// rectangles spanning where its surface is, gaps and all: a panorama that
// saw nothing past its wall sees the wall's sheet instead, and its picture
// of the glass sits on the glass. Runs of surface along the wall closer than
// `bridge` are one sheet, so a doorway or a glass panel between two stretches
// of wall is spanned; a longer gap ends the sheet.
import type { PlaneFit } from "./planes";
import { planeBasis } from "./planes";

export interface SheetLimits {
  /** An upright plane's normal has at most this much of up in it. */
  upright: number;
  /**
   * Runs of surface this close along the wall are one sheet, metres; a gap
   * up to `bridgeLong` is spanned too unless cameras stood in it on both
   * sides of the wall (a passage walked through, not an office looked into).
   */
  bridge: number;
  bridgeLong: number;
  /** A sheet is at least this wide and tall, metres. */
  minWidth: number;
  minHeight: number;
  /** Planes with at least this much surface, m². */
  minArea: number;
  /** A sheet this tall, metres, is a room's wall (floor to ceiling): what is seen through its gaps is beyond the room. */
  tall: number;
}

export const SHEET_LIMITS: SheetLimits = { upright: 0.3, bridge: 0.5, bridgeLong: 2.4, minWidth: 0.6, minHeight: 1.2, minArea: 1, tall: 2.0 };

export interface WallSheets {
  /** Rooms' walls, floor to ceiling, and the lower ones (partitions, counters): unindexed triangles, three corners a triangle, x y z each. */
  tall: Float32Array;
  low: Float32Array;
}

/**
 * The sheets of the upright planes in `fit`. `positions` and `index` are
 * the mesh `fit` was made from.
 */
export function wallSheets(
  positions: Float32Array,
  index: Uint32Array,
  fit: PlaneFit,
  cameras: readonly (readonly [number, number, number])[] = [],
  limits: SheetLimits = SHEET_LIMITS,
): WallSheets {
  const tall: number[] = [];
  const low: number[] = [];
  fit.planes.forEach((plane, p) => {
    const [nx, ny, nz] = plane.normal;
    if (Math.abs(ny) > limits.upright || plane.area < limits.minArea) return;
    const { u, v } = planeBasis(plane.normal);
    // Each of the plane's corners, along the wall (u) and up it (v).
    const along: number[] = [];
    const up: number[] = [];
    for (let t = 0; t < fit.owner.length; t++) {
      if (fit.owner[t] !== p) continue;
      for (let k = 0; k < 3; k++) {
        const i = index[t * 3 + k] * 3;
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        along.push(x * u[0] + y * u[1] + z * u[2]);
        up.push(x * v[0] + y * v[1] + z * v[2]);
      }
    }
    if (along.length === 0) return;
    const order = along.map((_, i) => i).sort((a, b) => along[a] - along[b]);
    let start = 0;
    const flush = (from: number, to: number) => {
      const a0 = along[order[from]];
      const a1 = along[order[to]];
      let v0 = Infinity;
      let v1 = -Infinity;
      for (let k = from; k <= to; k++) {
        v0 = Math.min(v0, up[order[k]]);
        v1 = Math.max(v1, up[order[k]]);
      }
      if (a1 - a0 < limits.minWidth || v1 - v0 < limits.minHeight) return;
      const corner = (a: number, b: number) => [
        nx * plane.offset + u[0] * a + v[0] * b,
        ny * plane.offset + u[1] * a + v[1] * b,
        nz * plane.offset + u[2] * a + v[2] * b,
      ];
      const c00 = corner(a0, v0);
      const c10 = corner(a1, v0);
      const c11 = corner(a1, v1);
      const c01 = corner(a0, v1);
      (v1 - v0 >= limits.tall ? tall : low).push(...c00, ...c10, ...c11, ...c00, ...c11, ...c01);
    };
    // Whether cameras stood within [from, to] along the wall, on both of its sides.
    const walked = (from: number, to: number) => {
      let sides = 0;
      for (const [x, y, z] of cameras) {
        const s = x * u[0] + y * u[1] + z * u[2];
        const d = x * nx + y * ny + z * nz - plane.offset;
        if (s < from - 0.2 || s > to + 0.2 || Math.abs(d) > 3.5) continue;
        sides |= d > 0 ? 1 : 2;
      }
      return sides === 3;
    };
    for (let k = 1; k < order.length; k++) {
      const gap = along[order[k]] - along[order[k - 1]];
      if (gap > limits.bridge && (gap > limits.bridgeLong || walked(along[order[k - 1]], along[order[k]]))) {
        flush(start, k - 1);
        start = k;
      }
    }
    flush(start, order.length - 1);
  });
  return { tall: new Float32Array(tall), low: new Float32Array(low) };
}
