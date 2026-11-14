// The overlay's scene (issue 108): what the run board shows from above, as
// marks standing on the scan's floor points, for the layer over the Inside
// view to draw in first person.
//
// - Guards and cleaners on their nodes, gliding from last turn's node.
// - Cameras at their mounts (the board's `cameraMount`, on the wall, raised
//   `CAMERA_MOUNT_M` over the floor).
// - A ring at every watched node (the board's `coverage`).
// - A ring at each legal hop (the board's `choices`), the aimed one marked.
// - A beacon on the objective, or on the exits once carrying.
//
// Only what the player could see (`seenFrom`): guards, cleaners and cameras
// are solid in sight, outlines in hearing, and left out otherwise; a watched
// ring is drawn only in sight. Hops are always drawn, since they are where the
// player can go, and so is the beacon, as an outline while out of sight, since
// it is where the player is going.
//
// Pure: a function of the run, the floor points and the glide's progress. A
// board built from a scan names its nodes by sweep id and places them at the
// scan's x and z, so a board point (x, y) is the scan's (x, z).
import type { ScanPoint } from "@/adapters/matterport";
import type { RunState } from "@/engine";
import { cameraMount, choices, coverage } from "@/components/run/board";
import { ease, lerp } from "./projection";
import { seenFrom, sightJoined, type Seen } from "./visibility";

/** How high a camera hangs over the floor, in metres: under a typical office ceiling. */
export const CAMERA_MOUNT_M = 2.3;

/** Seen, or heard: a mark that is drawn. */
export type Shown = Exclude<Seen, "hidden">;

export type Mark =
  | { kind: "walker"; who: "guard" | "cleaner"; id: string; nodeId: string; seen: Shown; foot: ScanPoint }
  | {
      kind: "camera";
      id: string;
      /** The cover node nearest the mount: whether the player sees the camera is whether they see this node. */
      nodeId: string;
      seen: Shown;
      mount: ScanPoint;
    }
  | { kind: "watch"; nodeId: string; at: ScanPoint; by: readonly string[] }
  | { kind: "hop"; nodeId: string; at: ScanPoint; aimed: boolean; locked: boolean }
  | { kind: "beacon"; role: "objective" | "exit"; nodeId: string; at: ScanPoint; seen: Shown };

export interface SceneInput {
  run: RunState;
  /** Each scan position's floor point, by node id (`InsideView.floorPoints`). */
  points: ReadonlyMap<string, ScanPoint>;
  /** The legal hop the player is aiming at, if any; #107 works it out from the view. */
  aimed?: string | null;
  /** Where each guard and cleaner stood before this turn's move, and how far through its glide it is, 0 to 1. */
  glide?: { from: ReadonlyMap<string, string>; t: number };
}

export function sceneOf({ run, points, aimed = null, glide }: SceneInput): Mark[] {
  const { board, playerNode } = run;
  const { floor } = board.level;
  const marks: Mark[] = [];

  // The beacon, under everything else of the same depth.
  const beacons = run.carrying ? board.level.exits.map((id) => ["exit", id] as const) : [["objective", board.level.objective] as const];
  for (const [role, nodeId] of beacons) {
    const at = points.get(nodeId);
    if (!at) continue;
    marks.push({ kind: "beacon", role, nodeId, at, seen: sightJoined(board, playerNode, nodeId) ? "solid" : "outline" });
  }

  for (const [nodeId, by] of coverage(run)) {
    const at = points.get(nodeId);
    if (at && sightJoined(board, playerNode, nodeId)) marks.push({ kind: "watch", nodeId, at, by });
  }

  for (const choice of choices(run, "walk")) {
    const at = points.get(choice.nodeId);
    if (at) marks.push({ kind: "hop", nodeId: choice.nodeId, at, aimed: choice.nodeId === aimed, locked: choice.kind === "pick" });
  }

  for (const camera of board.cameras) {
    const cover = camera.parts.flat();
    const floorYs = cover.flatMap((id) => (points.has(id) ? [points.get(id)!.y] : []));
    if (floorYs.length === 0) continue;
    const m = cameraMount(floor, cover);
    const nodeId = nearest(board.nodes, cover, m);
    const seen = seenFrom(board, playerNode, nodeId);
    if (seen === "hidden") continue;
    const floorY = floorYs.reduce((s, y) => s + y, 0) / floorYs.length;
    marks.push({ kind: "camera", id: camera.id, nodeId, seen, mount: { x: m.x, y: floorY + CAMERA_MOUNT_M, z: m.y } });
  }

  for (const [who, group] of [["guard", run.guards], ["cleaner", run.cleaners]] as const) {
    for (const walker of group) {
      const to = points.get(walker.nodeId);
      if (!to) continue;
      const seen = seenFrom(board, playerNode, walker.nodeId);
      if (seen === "hidden") continue;
      const fromId = glide?.from.get(walker.id);
      const from = fromId !== undefined && fromId !== walker.nodeId ? points.get(fromId) : undefined;
      const foot = from && glide ? lerp(from, to, ease(glide.t)) : to;
      marks.push({ kind: "walker", who, id: walker.id, nodeId: walker.nodeId, seen, foot });
    }
  }
  return marks;
}

/** The node of `ids` nearest the board point `p`; the first of them on a tie. */
function nearest(nodes: ReadonlyMap<string, { x: number; y: number }>, ids: readonly string[], p: { x: number; y: number }): string {
  let best = ids[0];
  let bestD = Infinity;
  for (const id of ids) {
    const n = nodes.get(id)!;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bestD) [best, bestD] = [id, d];
  }
  return best;
}
