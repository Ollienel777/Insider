// How much each panorama paints a point of the mesh (issue 118). Pure, and
// the same sums as the mesh's shader (app/spike/mesh/projection.ts), so the
// debug recorder can say what the shader did at the centre of the screen.
//
// "view" (the default) is the unstructured-lumigraph rule: a panorama counts
// for a point by how nearly its own ray to the point agrees with the
// player's ray to it. The angles change with every step the player takes, so
// the picture changes with every step too, and standing on a scan position
// the angle to that panorama is zero everywhere and its picture is exact.
// "nearest" is the rule this replaced: each panorama's share from the
// player's distance alone, sharpened, which reads as one picture at a time.

// "photo" is lib/scan-mesh/photo.ts's rule, for a mesh that has its own
// texture to fall back on: one panorama leads and paints all it saw.
import type { Vec3 } from "./coords";
import { GRAZE_FULL, GRAZE_NONE } from "./photo";

export type BlendMode = "photo" | "view" | "nearest";
export const BLEND_MODES: readonly BlendMode[] = ["photo", "view", "nearest"];

export interface BlendSource {
  /** Where the panorama was taken. */
  origin: Vec3;
  /** Its slot's share, 0 to 1, from the player's distance (`slotFades`): how a panorama enters and leaves. */
  share: number;
  /** 1 when it saw the point, 0 when something stood between. */
  seen: number;
}

/** Below this angle, radians, a panorama counts as looking along the player's own ray. */
export const ANGLE_FLOOR = 0.035;
/** What is left of a panorama's say for a point it didn't see. */
export const HIDDEN = 1e-5;
/** How much a panorama farther from the point than the player counts against it (its pixels are coarser there). */
export const REACH_PENALTY = 0.25;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.sqrt(dot(a, a));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * Each source's part in the colour of `point` (summing to 1, or all 0 when no
 * source has a share), seen by a camera at `camera`. `normal` is the
 * surface's, either way round.
 */
export function blendWeights(
  mode: BlendMode,
  camera: Vec3,
  point: Vec3,
  normal: Vec3,
  sources: readonly BlendSource[],
): number[] {
  const toPoint = sub(point, camera);
  const camReach = Math.max(length(toPoint), 1e-4);
  const sight: Vec3 = [toPoint[0] / camReach, toPoint[1] / camReach, toPoint[2] / camReach];
  // The normal facing the camera.
  const n: Vec3 = dot(normal, sight) > 0 ? [-normal[0], -normal[1], -normal[2]] : normal;

  const raw = sources.map((s) => {
    if (s.share <= 0) return 0;
    const ray = sub(point, s.origin);
    const reach = Math.max(length(ray), 1e-4);
    const along: Vec3 = [ray[0] / reach, ray[1] / reach, ray[2] / reach];
    // The photo rule: the share is the panorama's rank, and it paints what it saw squarely enough.
    if (mode === "photo") return s.share * s.seen * smoothstep(GRAZE_NONE, GRAZE_FULL, Math.abs(dot(n, along)));
    const facing = smoothstep(0.02, 0.3, -dot(n, along));
    if (mode === "nearest") {
      const aligned = Math.max(dot(sight, along), 0);
      return s.share * (0.03 + aligned ** 4) * (0.1 + 0.9 * facing) * (s.seen + 0.002);
    }
    // A panorama that didn't see the point keeps a trace, so a point nobody
    // saw still takes the colours around it rather than none.
    const seen = s.seen + HIDDEN;
    const angle = Math.acos(Math.min(1, Math.max(-1, dot(sight, along))));
    const coarser = REACH_PENALTY * Math.max(0, (reach - camReach) / reach);
    const penalty = angle + coarser + ANGLE_FLOOR;
    return (s.share * (0.1 + 0.9 * facing) * seen) / (penalty * penalty);
  });
  const total = raw.reduce((a, b) => a + b, 0);
  return total > 0 ? raw.map((w) => w / total) : raw.map(() => 0);
}

/**
 * Each slot's share from the player's distance to its panorama: 1 for one
 * the player stands on, falling to exactly 0 as the panorama becomes the
 * (slots + 1)th nearest, so a panorama enters and leaves the blend without a
 * jump. Not normalised: the view rule above does the sharing out. With no
 * more panoramas than slots, every one has a full share.
 */
export function slotFades(distances: readonly number[], slots: number): number[] {
  if (distances.length <= slots) return distances.map(() => 1);
  const cutoff = [...distances].sort((a, b) => a - b)[slots];
  return distances.map((d) => {
    if (cutoff <= 1e-6) return d <= cutoff ? 1 : 0;
    const t = Math.max(0, 1 - d / cutoff);
    return t * t * (3 - 2 * t);
  });
}
