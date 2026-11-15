// The scan's walkable mesh (spike/mesh/collider.ts) as the `ScanSolid` the
// scan's ground asks (scan-ground.ts): its floor and wall questions as they
// are, and a ray against its collision tree for the line of sight and the
// doorways.
import { DoubleSide, Ray, Vector3 } from "three";
import type { MeshWorld } from "@/app/spike/mesh/collider";
import type { ScanSolid, Vec3 } from "./scan-ground";

export function meshSolid(world: MeshWorld): ScanSolid {
  const ray = new Ray(new Vector3(), new Vector3());
  return {
    floorBelow: (x, fromY, z, depth) => world.floorBelow(x, fromY, z, depth),
    pushOut: (x, feetY, z, radius) => world.pushOut(x, feetY, z, radius),
    hit(origin: Vec3, dir: Vec3, far: number) {
      ray.origin.set(origin[0], origin[1], origin[2]);
      ray.direction.set(dir[0], dir[1], dir[2]).normalize();
      const found = world.bvh.raycastFirst(ray, DoubleSide, 0, far);
      return found ? found.distance : null;
    },
  };
}
