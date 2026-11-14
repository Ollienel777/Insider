// What the first-person view draws on the floor for every camera, guard and
// cleaner (issue 115): the engine's own answer, read through the same `cones`
// the board draws (board.ts). A node is marked here exactly when the engine
// would see the player on it this turn, as they land or after the guards
// move. The renderer decides nothing: it colours the nodes this names.
import type { RunState } from "@/engine";
import { cones, type WatcherKind } from "../board";
import type { Vec } from "./ground";

export interface Sight {
  id: string;
  kind: WatcherKind;
  /** This watcher's sighting raised the alarm on the last turn. */
  tripped: boolean;
  /** Where it looks from, in metres: a guard's node, a camera's mount. */
  origin: Vec;
  /** The nodes it sees the player on as they land this turn. */
  nodes: readonly string[];
  /** A guard's look once it has moved this turn; the engine checks the player's node again then. */
  after: { origin: Vec; nodes: readonly string[] } | null;
  /** A sweeping camera's part for the turn after. */
  next: readonly string[];
}

/** The camera or guard whose sighting raised the alarm on the last turn, if one did (as the board marks it). */
export function trippedBy(run: RunState): string | null {
  const last = run.alarmEvents[run.alarmEvents.length - 1];
  if (!last || last.turn !== run.turn - 1) return null;
  return last.cause.kind === "camera" || last.cause.kind === "guard" ? (last.cause.id ?? null) : null;
}

/** Every watcher's sight this turn, with origins in metres (`unitM` metres to a floor-plan unit). */
export function sightOf(run: RunState, unitM: number): Sight[] {
  const tripped = trippedBy(run);
  const metres = (p: { x: number; y: number }): Vec => ({ x: p.x * unitM, y: p.y * unitM });
  return cones(run).map((cone) => ({
    id: cone.id,
    kind: cone.kind,
    tripped: cone.id === tripped,
    origin: metres(cone.origin),
    nodes: cone.nodes,
    after: cone.after ? { origin: metres(cone.after.origin), nodes: cone.after.nodes } : null,
    next: cone.next,
  }));
}

/** Node id → who sees the player there this turn, and whether one of them just raised the alarm. */
export function watchedNodes(sight: readonly Sight[]): Map<string, { by: string[]; tripped: boolean }> {
  const out = new Map<string, { by: string[]; tripped: boolean }>();
  for (const s of sight) {
    for (const id of new Set([...s.nodes, ...(s.after?.nodes ?? [])])) {
      const entry = out.get(id) ?? { by: [], tripped: false };
      entry.by.push(s.id);
      entry.tripped ||= s.tripped;
      out.set(id, entry);
    }
  }
  return out;
}
