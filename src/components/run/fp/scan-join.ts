// Whether a scan's board and its mesh are one building (issue 118). The board
// comes from the Showcase SDK (a sweep's id, and its x and z), the mesh and
// the panoramas from the Model API (a `panoLocations` id and a z-up position,
// turned y-up in lib/scan-mesh/coords.ts). First person stands the board's
// nodes on the mesh, so it is offered on a scan only when every node is a
// panorama of the same id at the same place.
//
// Pure, and it says only how many and how far: no id or position leaves it.
import type { FloorGraph } from "@/domain";
import type { ScanHeights, Vec3 } from "./scan-ground";

export interface ScanPanoAt {
  id: string;
  /** Where the scan camera stood, y-up. */
  position: Vec3;
  /** The floor spot under it, y-up, when the scan has one. */
  floor: Vec3 | null;
}

export interface ScanJoin {
  /** Board nodes with a panorama of the same id. */
  matched: number;
  total: number;
  /** The largest distance on the floor plan between a matched node and its panorama, metres. */
  worstM: number;
  heights: ScanHeights;
}

/** How far apart a node and its panorama may be and still be the same place: a few centimetres of rounding, no more. */
export const JOIN_TOLERANCE_M = 0.25;

export function joinScan(floor: FloorGraph, panos: readonly ScanPanoAt[]): ScanJoin {
  const byId = new Map(panos.map((p) => [p.id, p]));
  const eye = new Map<string, number>();
  const spot = new Map<string, number>();
  let matched = 0;
  let worstM = 0;
  for (const node of floor.nodes) {
    const pano = byId.get(node.id);
    if (!pano) continue;
    matched += 1;
    worstM = Math.max(worstM, Math.hypot(pano.position[0] - node.x, pano.position[2] - node.y));
    eye.set(node.id, pano.position[1]);
    if (pano.floor) spot.set(node.id, pano.floor[1]);
  }
  return { matched, total: floor.nodes.length, worstM, heights: { eye, floor: spot } };
}

/** Why first person can't stand this board on this mesh, or null when it can. */
export function joinRefusal(join: ScanJoin): string | null {
  if (join.total === 0 || join.matched < join.total) {
    return "The scan's mesh and its board don't name the same positions, so first person isn't offered on it.";
  }
  if (join.worstM > JOIN_TOLERANCE_M) return "The scan's mesh and its board don't line up, so first person isn't offered on it.";
  return null;
}
