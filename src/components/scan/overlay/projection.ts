// Projection (issue 108): the scene's marks as pixels in the Inside view's
// frame. The embed SDK cannot place 3D objects in the player, so the overlay
// is drawn on a layer over it, and every shape is worked out from points in
// the scan: a figure from its floor point and the point `FIGURE_M` above it,
// a ring from points round its floor point on the floor. The perspective
// comes from the view's own `project` (`Conversion.worldToScreen` on the
// latest pose), so each mark stays on its floor point while the camera turns
// and travels.
//
// Pure: `project` is passed in, and the pose only gives each mark's distance,
// so the far ones draw first.
import type { FramePoint, InsidePose, ScanPoint } from "@/adapters/matterport";
import type { Mark, Shown } from "./scene";

/** Where a scan point shows in the frame, or null when it is not in front of the camera (`InsideView.project`). */
export type Project = (point: ScanPoint) => FramePoint | null;

export interface FrameSize {
  width: number;
  height: number;
}

/** A guard's height, in metres. */
export const FIGURE_M = 1.75;
/** A cleaner's: a little shorter, as on the board. */
export const CLEANER_M = 1.6;
/** The beacon's column. */
export const BEACON_M = 2.2;
/** The radius of the ring at a watched node, and at a legal hop. */
export const WATCH_RING_M = 0.55;
export const HOP_RING_M = 0.4;
const RING_SEGMENTS = 24;
/** A figure shorter than this, in pixels, is too far to read and is not drawn. */
const MIN_FIGURE_PX = 8;
/** A figure taller than this many frames is the camera standing on it, and is not drawn. */
const MAX_FIGURE_FRAMES = 3;
/** A ring this close to the camera, across the floor, is underfoot and is not drawn. */
const UNDERFOOT_M = 0.75;
/** How far past the frame's edge a drawing may reach and still be kept, in pixels. */
const MARGIN = 64;
/** A point more than this many frames out is the SDK's numbers for a point beside the camera, not a place. */
const WILD = 8;
const FIGURE_ASPECT = 0.4;

export function lerp(a: ScanPoint, b: ScanPoint, t: number): ScanPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** `p`, `metres` higher: the scan is y-up. */
export function raise(p: ScanPoint, metres: number): ScanPoint {
  return { x: p.x, y: p.y + metres, z: p.z };
}

/** Ease-out, clamped to 0..1, like DESIGN.md's `--ease`: most of the way early, no bounce. */
export function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

const sane = (p: FramePoint, frame: FrameSize) => Math.abs(p.x) < WILD * frame.width && Math.abs(p.y) < WILD * frame.height;

function overlaps(minX: number, maxX: number, minY: number, maxY: number, frame: FrameSize): boolean {
  return maxX >= -MARGIN && minX <= frame.width + MARGIN && maxY >= -MARGIN && minY <= frame.height + MARGIN;
}

/**
 * Something standing on `foot`, `metres` tall: its feet's pixel and its top's.
 * Null when either is not in front of the camera, when it is too small to
 * read or towers over the frame, or when it falls wholly outside the frame.
 */
export function upright(
  project: Project,
  foot: ScanPoint,
  metres: number,
  frame: FrameSize,
  minPx = MIN_FIGURE_PX,
): { x: number; top: number; bottom: number } | null {
  const bottom = project(foot);
  const top = project(raise(foot, metres));
  if (!bottom || !top || !sane(bottom, frame) || !sane(top, frame)) return null;
  const height = bottom.y - top.y;
  if (height < minPx || height > MAX_FIGURE_FRAMES * frame.height) return null;
  const half = (height * FIGURE_ASPECT) / 2;
  if (!overlaps(bottom.x - half, bottom.x + half, top.y, bottom.y, frame)) return null;
  return { x: bottom.x, top: top.y, bottom: bottom.y };
}

/**
 * A ring of `radius` metres on the floor round `centre`, as a polygon in the
 * frame. Null when any of it is not in front of the camera, or all of it is
 * outside the frame.
 */
export function floorRing(project: Project, centre: ScanPoint, radius: number, frame: FrameSize): FramePoint[] | null {
  const ring: FramePoint[] = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * 2 * Math.PI;
    const p = project({ x: centre.x + radius * Math.cos(a), y: centre.y, z: centre.z + radius * Math.sin(a) });
    if (!p || !sane(p, frame)) return null;
    ring.push(p);
  }
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return overlaps(Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), frame) ? ring : null;
}

export type Drawn =
  | {
      kind: "figure";
      key: string;
      who: "guard" | "cleaner";
      id: string;
      nodeId: string;
      seen: Shown;
      x: number;
      top: number;
      bottom: number;
      depth: number;
    }
  | { kind: "camera"; key: string; id: string; nodeId: string; seen: Shown; x: number; y: number; size: number; depth: number }
  | {
      kind: "ring";
      key: string;
      role: "watch" | "hop";
      nodeId: string;
      points: readonly FramePoint[];
      aimed: boolean;
      locked: boolean;
      depth: number;
    }
  | {
      kind: "beacon";
      key: string;
      role: "objective" | "exit";
      nodeId: string;
      seen: Shown;
      x: number;
      top: number;
      bottom: number;
      depth: number;
    };

/** The camera housing's size range, in pixels. */
const CAMERA_PX = { min: 12, max: 40 } as const;

/**
 * Every mark of the scene that shows in the frame, as shapes in its pixels,
 * farthest first so nearer marks draw over them.
 */
export function layout(marks: readonly Mark[], project: Project, pose: InsidePose, frame: FrameSize): Drawn[] {
  const eye = pose.position;
  const distance = (p: ScanPoint) => Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
  const across = (p: ScanPoint) => Math.hypot(p.x - eye.x, p.z - eye.z);
  const out: Drawn[] = [];
  for (const mark of marks) {
    switch (mark.kind) {
      case "walker": {
        const up = upright(project, mark.foot, mark.who === "guard" ? FIGURE_M : CLEANER_M, frame);
        if (up) {
          const { who, id, nodeId, seen } = mark;
          out.push({ kind: "figure", key: `${who}:${id}`, who, id, nodeId, seen, ...up, depth: distance(mark.foot) });
        }
        break;
      }
      case "camera": {
        const at = project(mark.mount);
        const above = project(raise(mark.mount, 0.3));
        if (!at || !above || !sane(at, frame) || !sane(above, frame)) break;
        const size = Math.min(CAMERA_PX.max, Math.max(CAMERA_PX.min, at.y - above.y));
        if (!overlaps(at.x - size, at.x + size, at.y - size, at.y + size, frame)) break;
        const { id, nodeId, seen } = mark;
        out.push({ kind: "camera", key: `camera:${id}`, id, nodeId, seen, x: at.x, y: at.y, size, depth: distance(mark.mount) });
        break;
      }
      case "watch":
      case "hop": {
        if (across(mark.at) < UNDERFOOT_M) break;
        const hop = mark.kind === "hop";
        const points = floorRing(project, mark.at, hop ? HOP_RING_M : WATCH_RING_M, frame);
        if (!points) break;
        out.push({
          kind: "ring",
          key: `${mark.kind}:${mark.nodeId}`,
          role: mark.kind,
          nodeId: mark.nodeId,
          points,
          aimed: hop && mark.aimed,
          locked: hop && mark.locked,
          depth: distance(mark.at),
        });
        break;
      }
      case "beacon": {
        if (across(mark.at) < UNDERFOOT_M) break;
        // The beacon is drawn at any distance: it is where the player is going.
        const up = upright(project, mark.at, BEACON_M, frame, 0);
        if (up) {
          const { role, nodeId, seen } = mark;
          out.push({ kind: "beacon", key: `beacon:${role}:${nodeId}`, role, nodeId, seen, ...up, depth: distance(mark.at) });
        }
        break;
      }
    }
  }
  return out.sort((a, b) => b.depth - a.depth);
}
