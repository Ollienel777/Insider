// The scan mesh as a world to walk in (issue 118): the two questions
// movement.ts asks, answered from a bounding-volume tree over the triangles.
//
// The body is an upright capsule from just above step height to head height.
// Only its sides matter here: the floor is found by a ray, so a contact that
// pushes mostly up or down (the floor's own lumps, a low ceiling) is ignored.
import { BufferGeometry, DoubleSide, Line3, Ray, Vector3, Box3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { MoveWorld } from "@/lib/scan-mesh/movement";

/** Head height of the body, metres above the feet. */
const BODY_TOP = 1.7;
/** Passes of pushing out: a corner needs one per wall. */
const PASSES = 4;
/** A contact steeper than this (|dy| / distance) is floor or ceiling, not wall. */
const VERTICAL = 0.75;
/** A push straight out of a wall that clears it slower than this (per metre) is left to the contact's own lean. */
const MIN_RATE = 0.2;

export class MeshWorld implements MoveWorld {
  readonly bvh: MeshBVH;
  private readonly ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
  private readonly segment = new Line3();
  private readonly box = new Box3();
  private readonly onTriangle = new Vector3();
  private readonly onSegment = new Vector3();
  private readonly normal = new Vector3();

  constructor(
    geometry: BufferGeometry,
    private readonly stepUp: number,
  ) {
    this.bvh = new MeshBVH(geometry);
  }

  floorBelow(x: number, fromY: number, z: number, depth: number): number | null {
    this.ray.origin.set(x, fromY, z);
    const hit = this.bvh.raycastFirst(this.ray, DoubleSide, 0, depth);
    return hit ? hit.point.y : null;
  }

  pushOut(x: number, feetY: number, z: number, radius: number): { x: number; z: number } {
    const { segment, box, onTriangle, onSegment, normal } = this;
    const bottom = feetY + this.stepUp + radius;
    const top = Math.max(bottom + 0.01, feetY + BODY_TOP - radius);
    segment.start.set(x, bottom, z);
    segment.end.set(x, top, z);

    for (let pass = 0; pass < PASSES; pass++) {
      box.makeEmpty();
      box.expandByPoint(segment.start);
      box.expandByPoint(segment.end);
      box.expandByScalar(radius);
      let moved = false;
      this.bvh.shapecast({
        intersectsBounds: (bounds) => bounds.intersectsBox(box),
        intersectsTriangle: (triangle) => {
          const distance = triangle.closestPointToSegment(segment, onTriangle, onSegment);
          if (distance >= radius || distance < 1e-6) return false;
          const dx = onSegment.x - onTriangle.x;
          const dy = onSegment.y - onTriangle.y;
          const dz = onSegment.z - onTriangle.z;
          if (Math.abs(dy) / distance > VERTICAL) return false;
          const flat = Math.hypot(dx, dz);
          if (flat < 1e-6) return false;
          let ux = dx / flat;
          let uz = dz / flat;
          // How far the capsule moves away from the contact per metre pushed along (ux, uz).
          let rate = flat / distance;
          // Against a wall, a contact above or below the capsule's ends (a
          // quad's diagonal, a few centimetres under it) leans along the
          // wall; pushed that way, a body pressed into the wall creeps along
          // it a little every frame (issue 118). Such a contact pushes
          // straight out of the wall instead. One met side on (a doorway's
          // jamb) still pushes the way it leans, so the body slides round it.
          triangle.getNormal(normal);
          const across = Math.hypot(normal.x, normal.z);
          if (across > 1 - VERTICAL) {
            const out = dx * normal.x + dy * normal.y + dz * normal.z;
            const inPlaneUp = Math.abs(dy - out * normal.y);
            const inPlaneAlong = Math.hypot(dx - out * normal.x, dz - out * normal.z);
            const nx = (Math.sign(out) * normal.x) / across;
            const nz = (Math.sign(out) * normal.z) / across;
            const along = (nx * dx + nz * dz) / distance;
            if (inPlaneUp > inPlaneAlong && along > MIN_RATE) {
              ux = nx;
              uz = nz;
              rate = along;
            }
          }
          // Far enough sideways that the capsule clears the triangle.
          const push = (radius - distance) / rate;
          const sx = ux * push;
          const sz = uz * push;
          segment.start.x += sx;
          segment.start.z += sz;
          segment.end.x += sx;
          segment.end.z += sz;
          moved = true;
          return false;
        },
      });
      if (!moved) break;
    }
    return { x: segment.start.x, z: segment.start.z };
  }
}
