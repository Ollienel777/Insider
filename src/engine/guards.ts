// Guard movement, after each player action. A guard hops once every
// `patrolTempo` turns: along its patrol loop, or, once ordered to a zone,
// toward the nearest node of that zone by A*, where it then holds. Guards
// carry keys, so locked doors do not stop them. Cleaners walk the same way.
import { shortestPath } from "./path";
import type { Board, Facing, GuardState, RunState } from "./state";

/** Every guard after one turn's movement, in roster order. */
export function moveGuards(board: Board, guards: readonly GuardState[]): GuardState[] {
  const tempo = board.level.patrolTempo;
  return guards.map((guard) => {
    const idle = guard.idle + 1;
    if (idle < tempo) return { ...guard, idle };
    return { ...hop(board, guard), idle: 0 };
  });
}

/** The guard after one hop. It faces the way it went, or keeps its facing if it stayed. */
export function hop(board: Board, guard: GuardState): GuardState {
  let { waypoint } = guard;
  let goals: readonly string[];
  if (guard.target) {
    goals = guard.target.nodes;
  } else {
    const { patrol } = guard;
    // Skip past every waypoint the guard is standing on (a loop may repeat one).
    for (let i = 0; i < patrol.length && patrol[waypoint] === guard.nodeId; i++) {
      waypoint = (waypoint + 1) % patrol.length;
    }
    goals = [patrol[waypoint]];
  }
  const nodeId = nextHop(board, guard.nodeId, goals);
  return { ...guard, waypoint, nodeId, facing: facingOf(board, guard.nodeId, nodeId) ?? guard.facing };
}

/** The direction from one node to another, or null when they are the same node or the same point. */
function facingOf(board: Board, from: string, to: string): Facing | null {
  const a = board.nodes.get(from)!;
  const b = board.nodes.get(to)!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/** The first hop of a shortest path to the goals, or `from` when there or cut off. */
function nextHop(board: Board, from: string, goals: readonly string[]): string {
  const path = shortestPath(board, from, goals);
  return path && path.length > 1 ? path[1] : from;
}

export type OrderResult = { ok: true; run: RunState } | { ok: false; reason: string };

/**
 * Sends a guard to a zone of the level (`zoneId`), or back to its patrol
 * (`null`). It applies from the guard's next hop. An unknown guard or zone is
 * refused with a reason, so model orders can be clamped by dropping them.
 */
export function orderGuard(run: RunState, guardId: string, zoneId: string | null): OrderResult {
  const index = run.guards.findIndex((g) => g.id === guardId);
  if (index === -1) return { ok: false, reason: `no guard "${guardId}"` };
  let target: GuardState["target"] = null;
  if (zoneId !== null) {
    const zones = run.board.level.zones ?? {};
    if (!Object.hasOwn(zones, zoneId)) return { ok: false, reason: `no zone "${zoneId}"` };
    target = { zoneId, nodes: zones[zoneId] };
  }
  const guards = run.guards.map((g, i) => (i === index ? { ...g, target } : g));
  return { ok: true, run: { ...run, guards } };
}
