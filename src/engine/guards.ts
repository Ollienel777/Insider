// Guard movement, after each player action. A guard hops once every
// `patrolTempo` turns: along its patrol loop, or, once ordered, toward its
// target by A* (see `GuardTarget` for what each intent does there). Guards
// carry keys, so locked doors do not stop them. Cleaners walk the same way.
//
// Under a run's pursuit (real-time play, state.ts), a guard that has reached
// the node the player was last seen on, and found nobody, does not stand
// there: it searches the nodes round it, each guard starting somewhere
// different, until a sighting or new orders move it or the alarm falls to Calm.
import type { GuardIntent } from "@/domain";
import { withinHops } from "./noise";
import { shortestPath } from "./path";
import { convergeOn, zoneTarget, type Board, type Facing, type GuardState, type GuardTarget, type RunState } from "./state";

/** Every guard after one turn's movement, in roster order. */
export function moveGuards(board: Board, guards: readonly GuardState[]): GuardState[] {
  const { patrolTempo, guardTempo } = board.level;
  return guards.map((guard) => {
    const own = guardTempo && Object.hasOwn(guardTempo, guard.id) ? guardTempo[guard.id] : undefined;
    const tempo = own ?? patrolTempo;
    const idle = guard.idle + 1;
    if (idle < tempo) return { ...guard, idle };
    return { ...hop(board, guard), idle: 0 };
  });
}

/** The guard after one hop. It faces the way it went, or keeps its facing if it stayed. */
export function hop(board: Board, guard: GuardState): GuardState {
  let { waypoint, target } = guard;
  let goals: readonly string[];
  // Standing on the last-seen node with nobody there: the search round it starts (a pursuit only).
  if (target?.intent === "converge" && target.search && target.nodes.length === 1 && target.nodes[0] === guard.nodeId) {
    target = searchRound(board, guard, target) ?? target;
  }
  if (target?.intent === "sweep") {
    // Skip past the sweep node it is standing on, round the zone.
    let visit = target.visit;
    for (let i = 0; i < target.nodes.length && target.nodes[visit] === guard.nodeId; i++) {
      visit = (visit + 1) % target.nodes.length;
    }
    target = { ...target, visit };
    goals = [target.nodes[visit]];
  } else if (target) {
    goals = target.nodes;
  } else {
    const { patrol } = guard;
    // Skip past every waypoint the guard is standing on (a loop may repeat one).
    for (let i = 0; i < patrol.length && patrol[waypoint] === guard.nodeId; i++) {
      waypoint = (waypoint + 1) % patrol.length;
    }
    goals = [patrol[waypoint]];
  }
  const nodeId = nextHop(board, guard.nodeId, goals);
  return { ...guard, waypoint, target, nodeId, facing: facingOf(board, guard.nodeId, nodeId) ?? guard.facing };
}

/**
 * The nodes the guard will stand on over its next `hops` hops, its own node
 * first, as the engine will move it if nothing changes its orders. The board
 * draws this as the guard's dashed route.
 */
export function plannedPath(board: Board, guard: GuardState, hops = 3): string[] {
  const path = [guard.nodeId];
  let at = guard;
  for (let i = 0; i < hops; i++) {
    at = hop(board, at);
    if (at.nodeId === path[path.length - 1] && at.target?.intent !== "sweep") break;
    path.push(at.nodeId);
  }
  return path.filter((id, i) => i === 0 || id !== path[i - 1]);
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
 * Sends a guard to a zone (`zoneId`: one of the level's zones, or a room of
 * the floor by its id) with an intent, or back to its patrol (`null`). It
 * applies from the guard's next hop. An unknown guard or zone is refused
 * with a reason, so model orders can be clamped by dropping them.
 */
export function orderGuard(
  run: RunState,
  guardId: string,
  zoneId: string | null,
  intent: GuardIntent = "hold",
): OrderResult {
  const index = run.guards.findIndex((g) => g.id === guardId);
  if (index === -1) return { ok: false, reason: `no guard "${guardId}"` };
  let target: GuardTarget | null = null;
  if (zoneId !== null) {
    const zone = zoneTarget(run.board, zoneId);
    if (!zone) return { ok: false, reason: `no zone "${zoneId}"` };
    const guard = run.guards[index];
    if (intent === "converge" && run.lastSeen && zone.nodes.includes(run.lastSeen.nodeId)) {
      target = convergeOn(zoneId, run.lastSeen, run.pursuit?.searchHops);
    } else if (intent === "sweep") {
      target = { zoneId, nodes: sweepOrder(run.board, guard.nodeId, zone.nodes), intent, visit: 0 };
    } else {
      target = { zoneId, nodes: zone.nodes, intent, visit: 0 };
    }
  }
  const guards = run.guards.map((g, i) => (i === index ? { ...g, target } : g));
  return { ok: true, run: { ...run, guards } };
}

/**
 * The search a guard starts from the last-seen node `target` sent it to: a
 * sweep of every node within `target.search` hops of it. Each guard starts at
 * a different point of the round, by its id, so guards that arrive together
 * fan out. Null when the node has no neighbours to search.
 */
function searchRound(board: Board, guard: GuardState, target: GuardTarget): GuardTarget | null {
  const centre = target.nodes[0];
  const round = [...withinHops(board, centre, target.search ?? 0)].filter((id) => id !== centre);
  if (round.length === 0) return null;
  const nodes = sweepOrder(board, guard.nodeId, round);
  let start = 0;
  for (let i = 0; i < guard.id.length; i++) start = (start * 31 + guard.id.charCodeAt(i)) % nodes.length;
  return { zoneId: target.zoneId, nodes, intent: "sweep", visit: start, search: target.search };
}

/** A sweep's order: from the zone node nearest `from`, each next one the nearest not yet taken. */
function sweepOrder(board: Board, from: string, nodes: readonly string[]): string[] {
  const left = [...nodes];
  const order: string[] = [];
  let at = from;
  while (left.length > 0) {
    const path = shortestPath(board, at, left);
    const next = path ? path[path.length - 1] : left[0];
    order.push(next);
    left.splice(left.indexOf(next), 1);
    at = next;
  }
  return order;
}
