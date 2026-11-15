// Which of the mesh's triangles any panorama saw (issue 118).
//
// The scan's mesh goes on past what its cameras photographed: the far side
// of a partition, the wall behind an open door, a room looked into from its
// doorway. The mesh is a guess there and its texture a blur. A triangle
// counts as seen when some panorama near it has a clear line to it, by rays
// through a bounding-volume tree over the mesh itself. What nobody saw is
// then treated as a gap in its wall or floor (lib/scan-mesh/planes.ts)
// rather than drawn as it is.
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { Vec3 } from "@/lib/scan-mesh/coords";

export interface SeenLimits {
  /** The panoramas tried for a triangle: this many of the nearest, within this many metres. */
  nearest: number;
  reach: number;
  /** A panorama looking along the surface at less than this cosine did not see it. */
  graze: number;
  /** Something this far short of the triangle (metres, or this part of the distance if more) hides it. */
  slack: number;
  slackPart: number;
}

// Near and square enough that the photograph of it is worth having: a wall glimpsed from ten metres
// along its own length was seen, but its texture is a smear all the same.
export const SEEN_LIMITS: SeenLimits = { nearest: 6, reach: 7, graze: 0.12, slack: 0.06, slackPart: 0.02 };

/**
 * Per triangle of `index` over `positions`: 1 when a panorama at one of
 * `panos` saw its middle, else 0. A triangle longer than half a metre is
 * also tried at three points nearer its corners, from the three nearest
 * panoramas: it is seen if any is.
 */
export function seenTriangles(positions: Float32Array, index: Uint32Array, panos: readonly Vec3[], limits: SeenLimits = SEEN_LIMITS): Uint8Array {
  const work = seenWork(positions, index, panos, limits);
  work.run(0, work.seen.length);
  work.done();
  return work.seen;
}

/**
 * `seenTriangles` a slice at a time, for a caller with other work to let
 * in between: `run(from, to)` fills `seen` for those triangles, and `done`
 * lets go of the tree.
 */
export function seenWork(
  positions: Float32Array,
  index: Uint32Array,
  panos: readonly Vec3[],
  limits: SeenLimits = SEEN_LIMITS,
): { seen: Uint8Array; run: (from: number, to: number) => void; done: () => void } {
  const count = Math.floor(index.length / 3);
  const seen = new Uint8Array(count);
  if (count === 0 || panos.length === 0) return { seen, run: () => undefined, done: () => undefined };
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  // The tree sorts the index it is given: a copy, so the caller's triangles keep their order.
  geometry.setIndex(new BufferAttribute(index.slice(), 1));
  const bvh = new MeshBVH(geometry);
  const ray = new Ray();
  const near: number[] = [];
  const nearD: number[] = [];
  const point = new Vector3();
  const reach2 = limits.reach * limits.reach;

  const clear = (pano: Vec3, x: number, y: number, z: number, nx: number, ny: number, nz: number): boolean => {
    const dx = x - pano[0];
    const dy = y - pano[1];
    const dz = z - pano[2];
    const reach = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (reach < 1e-4) return true;
    const square = Math.abs(dx * nx + dy * ny + dz * nz) / reach;
    if (square < limits.graze) return false;
    ray.origin.set(pano[0], pano[1], pano[2]);
    ray.direction.set(dx / reach, dy / reach, dz / reach);
    // The slack is measured off the surface, not along the ray: a floor looked at along itself has bumps
    // a few centimetres high that a ray stopping a few centimetres short of its point would still run into.
    const far = reach - Math.max(limits.slack, reach * limits.slackPart) / Math.max(square, 0.05);
    return far <= 0 || bvh.raycastFirst(ray, DoubleSide, 0, far) === null;
  };

  const run = (from: number, to: number): void => {
   for (let t = from; t < Math.min(to, count); t++) {
    const a = index[t * 3] * 3;
    const b = index[t * 3 + 1] * 3;
    const c = index[t * 3 + 2] * 3;
    const cx = (positions[a] + positions[b] + positions[c]) / 3;
    const cy = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(length > 1e-12)) continue;
    nx /= length;
    ny /= length;
    nz /= length;

    // The nearest few panoramas, nearest first.
    near.length = 0;
    nearD.length = 0;
    for (let p = 0; p < panos.length; p++) {
      const px = panos[p][0] - cx;
      const py = panos[p][1] - cy;
      const pz = panos[p][2] - cz;
      const d = px * px + py * py + pz * pz;
      if (d > reach2) continue;
      let at = near.length;
      while (at > 0 && nearD[at - 1] > d) at--;
      if (at >= limits.nearest) continue;
      near.splice(at, 0, p);
      nearD.splice(at, 0, d);
      if (near.length > limits.nearest) {
        near.pop();
        nearD.pop();
      }
    }
    const long = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, (vx - ux) ** 2 + (vy - uy) ** 2 + (vz - uz) ** 2) > 0.25;
    for (let k = 0; k < near.length; k++) {
      const p = near[k];
      if (clear(panos[p], cx, cy, cz, nx, ny, nz)) {
        seen[t] = 1;
        break;
      }
      if (!long || k >= 3) continue;
      for (const corner of [a, b, c]) {
        point.set(cx + (positions[corner] - cx) * 0.6, cy + (positions[corner + 1] - cy) * 0.6, cz + (positions[corner + 2] - cz) * 0.6);
        if (clear(panos[p], point.x, point.y, point.z, nx, ny, nz)) {
          seen[t] = 1;
          break;
        }
      }
      if (seen[t]) break;
    }
   }
  };
  return { seen, run, done: () => geometry.dispose() };
}
