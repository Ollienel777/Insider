// The RunLog (SPEC §4.1): one entry per turn, written as the turn ends. It
// feeds Debrief's replay; the level's start positions are turn 0's "before".
import type { PlayerActionKind, RunLog, RunTurn } from "@/domain";
import type { GuardState, RunState } from "./state";

/** The log entry for a turn that ended in this position. */
export function turnEntry(
  turn: number,
  kind: PlayerActionKind,
  playerNode: string,
  guards: readonly GuardState[],
  alarm: RunState["alarm"],
): RunTurn {
  return {
    turn,
    player: { kind, nodeId: playerNode },
    guards: guards.map((g) => ({ guardId: g.id, nodeId: g.nodeId })),
    alarm,
  };
}

/** The run so far as a `RunLog`. */
export function toRunLog(run: RunState): RunLog {
  const { buildingId, missionId, seed } = run.board.level;
  return { buildingId, missionId, seed, turns: [...run.turns] };
}
