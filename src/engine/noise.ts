// Noise (SPEC §4.3, D10). A sprint or a pick makes noise at the node the
// player ends the action on. Every guard within the level's hearing range of
// it, in hops, hears it; noise made inside a quiet zone carries one hop
// further. Sound goes through doors, locked or not.
import type { Board, GuardState } from "./state";

/** How many hops noise made on `source` carries. */
export function hearingRange(board: Board, source: string): number {
  return board.hearing + (board.quiet.has(source) ? 1 : 0);
}

/** The nodes within `range` hops of `source`, `source` included. */
export function withinHops(board: Board, source: string, range: number): Set<string> {
  const seen = new Set([source]);
  let frontier = [source];
  for (let hops = 0; hops < range && frontier.length > 0; hops++) {
    const next: string[] = [];
    for (const at of frontier) {
      for (const exit of board.adjacency.get(at) ?? []) {
        if (!seen.has(exit.to)) {
          seen.add(exit.to);
          next.push(exit.to);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/** The guards that hear noise made on `source`, in roster order. */
export function hearers(board: Board, guards: readonly GuardState[], source: string): GuardState[] {
  const heard = withinHops(board, source, hearingRange(board, source));
  return guards.filter((g) => heard.has(g.nodeId));
}
