// The RunLog (SPEC §4.1): one entry per turn, written as the turn ends. It
// feeds Debrief's replay; the level's start positions are turn 0's "before".
import type { ChiefOrders, PlayerActionKind, RunLog, RunTurn } from "@/domain";
import type { GuardState, RunState } from "./state";

/**
 * The rules the engine plays by, stamped on every log it writes so the Debrief
 * reads an old log by the engine that wrote it. 2: the Chief's orders and locks
 * given at Calm are dropped (#94). A log without it was played under rules 1,
 * which applied them at any alarm.
 */
export const RUN_RULES = 2;

/** The log entry for a turn that ended in this position; `chief` is the orders that arrived before it. */
export function turnEntry(
  turn: number,
  kind: PlayerActionKind,
  playerNode: string,
  guards: readonly GuardState[],
  alarm: RunState["alarm"],
  chief: ChiefOrders | null = null,
): RunTurn {
  return {
    turn,
    player: { kind, nodeId: playerNode },
    guards: guards.map((g) => ({ guardId: g.id, nodeId: g.nodeId })),
    alarm,
    ...(chief && { chief }),
  };
}

/** The run so far as a `RunLog`, with how it stands and every alarm transition (the Debrief reads both). */
export function toRunLog(run: RunState): RunLog {
  const { buildingId, missionId, seed } = run.board.level;
  return {
    buildingId,
    missionId,
    seed,
    rules: RUN_RULES,
    turns: [...run.turns],
    status: run.status,
    alarmEvents: run.alarmEvents.map((e) => ({ ...e, cause: { ...e.cause } })),
  };
}
