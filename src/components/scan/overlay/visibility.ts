// What the player could see from where they stand (issue 108). The overlay
// over the scan draws only this, so it never shows a guard through a wall:
//
// - **solid** when the engine's sightlines join the piece's node to the
//   player's (or the piece stands on the player's node);
// - **outline** when the piece is within hearing: the hops the engine's noise
//   carries from the piece's node (`hearingRange`, `withinHops`), so sound
//   goes through doors as it does in the engine;
// - **hidden** otherwise.
//
// Sightlines on a scan's board are same-room and at most `SIGHT_M` apart
// (adapters/matterport/mapping.ts), so a piece in another room is never solid.
// Pure: a function of the board and two node ids.
import { hearingRange, withinHops, type Board } from "@/engine";

export type Seen = "solid" | "outline" | "hidden";

/** Whether the floor's sightlines join `a` and `b`, in either direction. */
export function sightJoined(board: Board, a: string, b: string): boolean {
  if (a === b) return board.nodes.has(a);
  const lines = board.level.floor.sightlines;
  return (lines[a] ?? []).includes(b) || (lines[b] ?? []).includes(a);
}

/** How the overlay draws a piece on `pieceNode` for a player on `playerNode`. */
export function seenFrom(board: Board, playerNode: string, pieceNode: string): Seen {
  if (!board.nodes.has(pieceNode) || !board.nodes.has(playerNode)) return "hidden";
  if (sightJoined(board, playerNode, pieceNode)) return "solid";
  return withinHops(board, pieceNode, hearingRange(board, pieceNode)).has(playerNode) ? "outline" : "hidden";
}
