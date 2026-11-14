// Who sees the player (SPEC §4.3, D10). A guard sees its own node and the
// nodes in its node's sightlines that lie ahead of it: on the side its facing
// points to. A cleaner sees the same way. A camera sees the part of its cover
// it is watching this turn.
import type { Board, Camera, GuardState } from "./state";

/** What saw the player, and how hard that pushes the alarm. */
export interface Sighting {
  kind: "camera" | "guard" | "cleaner";
  id: string;
  /** Set for a camera with analytics: its sighting raises the alarm one step more. */
  extraStep: boolean;
}

/** The nodes a camera watches on turn `turn`. */
export function watched(camera: Camera, turn: number): readonly string[] {
  return camera.parts[(turn + camera.phase) % camera.parts.length];
}

/** The nodes a guard or cleaner sees from where it stands, the way it faces. */
export function visibleFrom(board: Board, watcher: GuardState): string[] {
  const here = board.nodes.get(watcher.nodeId)!;
  const lines = board.level.floor.sightlines[watcher.nodeId] ?? [];
  const { facing } = watcher;
  const ahead = lines.filter((id) => {
    if (!facing) return true;
    const there = board.nodes.get(id)!;
    return (there.x - here.x) * facing.dx + (there.y - here.y) * facing.dy > 0;
  });
  return [watcher.nodeId, ...ahead.filter((id) => id !== watcher.nodeId)];
}

/**
 * Everything that sees the player on `nodeId`, cameras first, then guards,
 * then cleaners, each in the level's order. Cameras are left out when `turn`
 * is null: they were checked once for the player's half of the turn.
 */
export function sightingsAt(
  board: Board,
  watchers: { guards: readonly GuardState[]; cleaners: readonly GuardState[] },
  nodeId: string,
  turn: number | null,
): Sighting[] {
  const found: Sighting[] = [];
  if (turn !== null) {
    for (const camera of board.cameras) {
      if (watched(camera, turn).includes(nodeId)) {
        found.push({ kind: "camera", id: camera.id, extraStep: camera.kind === "ip-analytics" });
      }
    }
  }
  for (const [kind, group] of [["guard", watchers.guards], ["cleaner", watchers.cleaners]] as const) {
    for (const watcher of group) {
      if (visibleFrom(board, watcher).includes(nodeId)) found.push({ kind, id: watcher.id, extraStep: false });
    }
  }
  return found;
}
