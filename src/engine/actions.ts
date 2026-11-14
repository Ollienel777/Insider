// Player actions and the turn they start (SPEC §4.2, D9). A turn is: the
// player acts; the guards move; the turn is logged. An illegal action is
// refused with a reason and changes nothing, which is how anything a model
// proposes is clamped to the board.
import type { PlayerActionKind } from "@/domain";
import { moveGuards } from "./guards";
import { turnEntry } from "./log";
import { neighbours } from "./path";
import { guardOn, isAlert, type Exit, type RunState } from "./state";

export type Action =
  | { kind: "move"; to: string }
  /** Two hops in one turn. `via` picks the middle node; by default the first open one. */
  | { kind: "sprint"; to: string; via?: string }
  | { kind: "wait" }
  /** One turn of picking a locked door on an edge out of the player's node. */
  | { kind: "pick"; doorId: string }
  /** Takes the objective from the player's node. */
  | { kind: "take" };

export type ActResult = { ok: true; run: RunState } | { ok: false; reason: string };

/** What the player's half of a turn leaves behind. */
interface PlayerPhase {
  kind: PlayerActionKind;
  /** Every node entered this turn, ending with the one the player stops on. */
  entered: string[];
  carrying: boolean;
  picking: RunState["picking"];
  locked: readonly string[];
}

/** Plays one turn: the player's action, then the guards. */
export function act(run: RunState, action: Action): ActResult {
  if (run.status !== "playing") return refuse(`the run is over: ${run.status}`);
  const phase = playerPhase(run, action);
  if (typeof phase === "string") return refuse(phase);

  const playerNode = phase.entered.at(-1) ?? run.playerNode;
  const alert = isAlert(run.alarm);
  let guards = run.guards;
  let status: RunState["status"] = "playing";

  if (alert && guardOn(guards, phase.entered)) {
    status = "caught";
  } else if (phase.carrying && run.board.level.exits.includes(playerNode)) {
    status = "won";
  } else {
    guards = moveGuards(run.board, guards);
    if (alert && guardOn(guards, [playerNode])) status = "caught";
  }

  const entry = turnEntry(run.turn, phase.kind, playerNode, guards, run.alarm);
  return {
    ok: true,
    run: {
      ...run,
      turn: run.turn + 1,
      playerNode,
      carrying: phase.carrying,
      picking: phase.picking,
      locked: phase.locked,
      guards,
      status,
      turns: [...run.turns, entry],
    },
  };
}

/** The player's half of the turn, or the reason the action is illegal. */
function playerPhase(run: RunState, action: Action): PlayerPhase | string {
  const here = run.playerNode;
  const same = { carrying: run.carrying, picking: null, locked: run.locked };
  const isOpen = (exit: Exit) => exit.doorId === undefined || !run.locked.includes(exit.doorId);
  const exitTo = (from: string, to: string) => neighbours(run.board, from).find((e) => e.to === to);

  switch (action.kind) {
    case "wait":
      return { ...same, kind: "wait", entered: [] };

    case "move": {
      const exit = exitTo(here, action.to);
      if (!exit) return `"${action.to}" is not a neighbour of "${here}"`;
      if (!isOpen(exit)) return `door "${exit.doorId}" is locked; pick it first`;
      return { ...same, kind: "move", entered: [action.to] };
    }

    case "sprint": {
      if (action.to === here) return `a sprint must leave "${here}"`;
      if (exitTo(here, action.to)) return `"${action.to}" is a neighbour of "${here}"; move there instead`;
      const middles = neighbours(run.board, here)
        .filter((first) => first.to !== action.to && isOpen(first))
        .map((first) => first.to)
        .filter((mid) => {
          const second = exitTo(mid, action.to);
          return second !== undefined && isOpen(second);
        });
      if (middles.length === 0) return `"${action.to}" is not two open hops from "${here}"`;
      const via = action.via ?? middles[0];
      if (!middles.includes(via)) return `"${action.to}" cannot be reached through "${via}" in two open hops`;
      return { ...same, kind: "sprint", entered: [via, action.to] };
    }

    case "pick": {
      const exit = neighbours(run.board, here).find((e) => e.doorId === action.doorId);
      if (!exit) return `door "${action.doorId}" is not on an edge out of "${here}"`;
      if (!run.locked.includes(action.doorId)) return `door "${action.doorId}" is not locked`;
      const progress = (run.picking?.doorId === action.doorId ? run.picking.progress : 0) + 1;
      if (progress < run.board.level.pickTurns) {
        return { ...same, kind: "pick", entered: [], picking: { doorId: action.doorId, progress } };
      }
      return { ...same, kind: "pick", entered: [], locked: run.locked.filter((d) => d !== action.doorId) };
    }

    case "take":
      if (run.carrying) return "the objective is already taken";
      if (here !== run.board.level.objective) return `the objective is not at "${here}"`;
      return { ...same, kind: "take", entered: [], carrying: true };

    default:
      // Reachable from untyped callers (a parsed plan, the console).
      return `unknown action "${(action as { kind?: unknown }).kind}"`;
  }
}

function refuse(reason: string): ActResult {
  return { ok: false, reason };
}
