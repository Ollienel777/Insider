// Shortest paths on the floor graph by A*, counting hops (a guard moves one
// hop per tempo, so hops are what time costs). The heuristic is the straight
// distance to the nearest goal divided by the longest edge, which never
// overestimates the hops left, so the path found is a shortest one. Exact
// ties go to the node with the lower per-seed rank, so the result depends
// only on the board and the seed.
import type { Board, Exit } from "./state";

/** The node's ways out, in the floor's edge order. */
export function neighbours(board: Board, nodeId: string): readonly Exit[] {
  return board.adjacency.get(nodeId) ?? [];
}

/**
 * A shortest path from `from` to the nearest of `goals`, both ends included
 * (`[from]` when `from` is a goal), or null when no goal is reachable.
 * `canPass` can rule edges out, for example locked doors for the player.
 */
export function shortestPath(
  board: Board,
  from: string,
  goals: readonly string[],
  canPass: (exit: Exit) => boolean = () => true,
): string[] | null {
  const goalSet = new Set(goals);
  const goalNodes = goals.map((id) => board.nodes.get(id)).filter((n) => n !== undefined);
  if (!board.nodes.has(from) || goalNodes.length === 0) return null;

  const h = (id: string): number => {
    if (board.maxEdge === 0) return 0;
    const n = board.nodes.get(id)!;
    let best = Infinity;
    for (const g of goalNodes) best = Math.min(best, Math.hypot(n.x - g.x, n.y - g.y));
    return best / board.maxEdge;
  };
  const rank = (id: string) => board.tieRank.get(id) ?? 0;

  const g = new Map<string, number>([[from, 0]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  const open: string[] = [from];

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (better(open[i], open[best])) best = i;
    }
    const current = open.splice(best, 1)[0];
    if (goalSet.has(current)) return reconstruct(cameFrom, current);
    closed.add(current);

    for (const exit of neighbours(board, current)) {
      if (closed.has(exit.to) || !canPass(exit)) continue;
      const cost = g.get(current)! + 1;
      const known = g.get(exit.to);
      if (known === undefined || cost < known) {
        g.set(exit.to, cost);
        cameFrom.set(exit.to, current);
        if (known === undefined) open.push(exit.to);
      }
    }
  }
  return null;

  function better(a: string, b: string): boolean {
    const fa = g.get(a)! + h(a);
    const fb = g.get(b)! + h(b);
    if (fa !== fb) return fa < fb;
    const ha = h(a);
    const hb = h(b);
    if (ha !== hb) return ha < hb;
    return rank(a) < rank(b);
  }
}

function reconstruct(cameFrom: ReadonlyMap<string, string>, end: string): string[] {
  const path = [end];
  let at = end;
  while (cameFrom.has(at)) {
    at = cameFrom.get(at)!;
    path.push(at);
  }
  return path.reverse();
}
