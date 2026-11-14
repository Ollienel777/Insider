// Guard movement, after each player action. A guard hops once every
// `patrolTempo` turns: along its patrol loop, or, once ordered to a zone,
// toward the nearest node of that zone by A*, where it then holds. Guards
// carry keys, so locked doors do not stop them.
import { shortestPath } from "./path";
import { guardOn, isAlert, type Board, type GuardState, type RunState } from "./state";

/** Every guard after one turn's movement, in roster order. */
export function moveGuards(board: Board, guards: readonly GuardState[]): GuardState[] {
  const tempo = board.level.patrolTempo;
  return guards.map((guard) => {
    const idle = guard.idle + 1;
    if (idle < tempo) return { ...guard, idle };
    return { ...hop(board, guard), idle: 0 };
  });
}

function hop(board: Board, guard: GuardState): GuardState {
  if (guard.target) {
    return { ...guard, nodeId: nextHop(board, guard.nodeId, guard.target.nodes) };
  }
  let { waypoint } = guard;
  const { patrol } = guard;
  // Skip past every waypoint the guard is standing on (a loop may repeat one).
  for (let i = 0; i < patrol.length && patrol[waypoint] === guard.nodeId; i++) {
    waypoint = (waypoint + 1) % patrol.length;
  }
  return { ...guard, waypoint, nodeId: nextHop(board, guard.nodeId, [patrol[waypoint]]) };
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

/**
 * Sets the alarm. Raising it to Alert while the player shares a node with a
 * guard ends the run as caught.
 */
export function setAlarm(run: RunState, alarm: RunState["alarm"]): RunState {
  const next = { ...run, alarm };
  if (run.status === "playing" && isAlert(alarm) && guardOn(run.guards, [run.playerNode])) {
    return { ...next, status: "caught" };
  }
  return next;
}
