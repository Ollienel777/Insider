// The scan view's pose, and the numbers it reads back from its debug looks
// (issue 118). Pure.
//
import type { PanoResolution } from "./manifest";

// Frame: the scan's, y-up, metres. Yaw 0 looks down -z and grows turning
// left; pitch grows looking up (three.js's camera convention).

export interface ScanPose {
  /** The eye, not the feet. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** The horizontal velocity (x, z), m/s, between two poses `dt` seconds apart; zero for the first, or after a jump. */
export function poseVelocity(last: ScanPose | null, now: ScanPose, dt: number, jump = 3): [number, number] {
  if (!last || dt <= 0) return [0, 0];
  const dx = now.x - last.x;
  const dz = now.z - last.z;
  // A teleport is not a run: the panoramas ahead are chosen from a believable speed only.
  if (Math.hypot(dx, dz) > jump) return [0, 0];
  return [dx / dt, dz / dt];
}

/** The pose for a player whose feet are at (x, y, z), looking (yaw, pitch). */
export function eyePose(feet: readonly [number, number, number], yaw: number, pitch: number, eyeHeight: number): ScanPose {
  return { x: feet[0], y: feet[1] + eyeHeight, z: feet[2], yaw, pitch };
}

/**
 * The pose's yaw for a heading measured from +x toward +z, the way the
 * first-person view's controller turns (it looks along (cos h, sin h) on the
 * ground): the same direction in this file's convention.
 */
export function yawFromHeading(heading: number): number {
  return -heading - Math.PI / 2;
}

/** How far under a scan camera its feet are assumed to be when neither the mesh nor the scan says, metres. */
export const CAMERA_HEIGHT = 1.4;

/**
 * Where the feet stand under a scan camera at `camera`: the mesh's floor
 * under it when a ray found one, else the floor spot the scan gives, else a
 * camera's height below it.
 */
export function feetUnder(
  camera: readonly [number, number, number],
  meshFloor: number | null,
  scanFloor: readonly [number, number, number] | null,
): [number, number, number] {
  const [x, y, z] = camera;
  return [x, meshFloor ?? scanFloor?.[1] ?? y - CAMERA_HEIGHT, z];
}

/**
 * How many full-size cubes are kept on the GPU, and their size, for a face
 * resolution: six 2k cubes are about 800 MB of GPU memory.
 */
export function sharpLayer(faces: PanoResolution): { capacity: number; size: number } {
  switch (faces) {
    case "4k":
      return { capacity: 3, size: 4096 };
    case "2k":
      return { capacity: 6, size: 2048 };
    case "high":
      return { capacity: 8, size: 1024 };
    default:
      return { capacity: 8, size: 512 };
  }
}

/** Whether signed links valid until `validUntil` (ISO, or null for no limit) still have more than `margin` ms on them at `now`. */
export function linksFresh(validUntil: string | null | undefined, now: number, margin: number): boolean {
  return !validUntil || Date.parse(validUntil) - now > margin;
}

export interface ViewStats {
  /** The part of the frame that is mesh (not the backdrop through a hole). */
  mesh: number;
  /** Of the mesh: the part no panorama in use saw. */
  unseen: number;
  /** Of the mesh: unseen and within a metre of the eye. */
  unseenNear: number;
  /** Of the mesh: unseen, though some panorama came within 30 cm of seeing it (a depth cube's edge, not a wall). */
  unseenClose: number;
  /** Of the mesh: unseen, and drawn as a mix of panoramas that disagree (the grey smudge). */
  unseenMixed: number;
  /** Mean over the mesh of what is left of other pictures, 0 to 1 (combine.ts's `ghost`). */
  ghost: number;
  /** Mean over the mesh of how much the panoramas disagreed before the sharpening (combine.ts's `spread`). */
  spread: number;
  /** Of the mesh: the part where a second picture visibly shows (ghost over 0.04, about 10 levels of 255). */
  doubled: number;
  /** Of the whole frame: the part neither the mesh nor a stand-in surface (a closed hole, a level's plane) covers, filled from around it. Textured mesh only. */
  filled?: number;
}

/** A pixel whose ghost is more than this, 0 to 1, shows a second picture. */
export const DOUBLED = 0.04;

/**
 * Sums up the two debug looks of one frame, RGBA bytes each (projection.ts):
 * `coverage` has red where nobody saw the point, green where somebody nearly
 * did, blue on the mesh and alpha the distance from the eye over 4 m;
 * `doubles` has red the ghost and green the spread, each times 4.
 */
export function viewStats(coverage: Uint8Array, doubles: Uint8Array): ViewStats {
  let mesh = 0;
  let unseen = 0;
  let unseenNear = 0;
  let unseenClose = 0;
  let unseenMixed = 0;
  let ghost = 0;
  let spread = 0;
  let doubled = 0;
  const pixels = Math.min(coverage.length, doubles.length) / 4;
  for (let i = 0; i < pixels * 4; i += 4) {
    if (coverage[i + 2] < 128) continue;
    mesh++;
    const g = doubles[i] / 255 / 4;
    if (coverage[i] >= 128) {
      unseen++;
      if (coverage[i + 3] < 64) unseenNear++;
      if (coverage[i + 1] >= 128) unseenClose++;
      if (g > DOUBLED) unseenMixed++;
    }
    ghost += g;
    spread += doubles[i + 1] / 255 / 4;
    if (g > DOUBLED) doubled++;
  }
  const of = (n: number) => (mesh > 0 ? n / mesh : 0);
  return {
    mesh: pixels > 0 ? mesh / pixels : 0,
    unseen: of(unseen),
    unseenNear: of(unseenNear),
    unseenClose: of(unseenClose),
    unseenMixed: of(unseenMixed),
    ghost: of(ghost),
    spread: of(spread),
    doubled: of(doubled),
  };
}
