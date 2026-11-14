// Player actions and the turn they start (SPEC §4.2, D9, D10). A turn is: the
// player acts and is seen or heard; the guards move and look; the alarm
// settles; the turn is logged. An illegal action is
// refused with a reason and changes nothing, which is how anything a model
// proposes is clamped to the board.
import type { PlayerActionKind } from "@/domain";
import { detect, settle, type Detection, type TurnMarks } from "./alarm";
import { moveGuards } from "./guards";
import { turnEntry } from "./log";
import { hearers } from "./noise";
import { neighbours } from "./path";
import { guardOn, isAlert, type Exit, type RunState } from "./state";
import { sightingsAt, type Sighting } from "./vision";

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

/**
 * Plays one turn:
 * 1. The player acts. Each node they pass through, in order (or the node they
 *    stay on), is checked against this turn's cameras and the guards' and
 *    cleaners' sight; then the guards hear any noise. If the alarm is at Alert
 *    or Lockdown on a node a guard stands on, the player is caught there, and
 *    a sprint stops on that node.
 * 2. Unless the turn ended the run, the guards and cleaners move, and look
 *    again at the player's node; a guard ending on it at Alert catches them.
 * 3. The alarm decays if nothing held it, and the turn is logged.
 */
export function act(run: RunState, action: Action): ActResult {
  if (run.status !== "playing") return refuse(`the run is over: ${run.status}`);
  const phase = playerPhase(run, action);
  if (typeof phase === "string") return refuse(phase);

  const { board } = run;
  const turn = run.turn;
  // Owned by this call: what the alarm has already done this turn.
  const marks: TurnMarks = { sighted: false, held: false };
  let state: RunState = { ...run, carrying: phase.carrying, picking: phase.picking, locked: phase.locked };
  const look = (s: RunState, nodeId: string, cameras: boolean): RunState =>
    sightingsAt(board, s, nodeId, cameras ? turn : null).reduce(
      (acc, sighting) => detect(acc, toDetection(sighting, nodeId), turn, marks),
      s,
    );
  const caughtOn = (s: RunState, nodeId: string) => isAlert(s.alarm) && guardOn(s.guards, [nodeId]);

  // A guard already at Alert grabs the player before anything else notices them.
  for (const nodeId of phase.entered.length > 0 ? phase.entered : [run.playerNode]) {
    state = { ...state, playerNode: nodeId };
    if (!caughtOn(state, nodeId)) state = look(state, nodeId, true);
    if (caughtOn(state, nodeId)) {
      state = { ...state, status: "caught" };
      break;
    }
  }

  if (state.status === "playing") {
    if (phase.kind === "sprint" || phase.kind === "pick") {
      for (const guard of hearers(board, state.guards, state.playerNode)) {
        const cause = { kind: "noise", id: guard.id } as const;
        state = detect(state, { strength: "suspicion", nodeId: state.playerNode, cause }, turn, marks);
      }
    }
    if (state.carrying && board.level.exits.includes(state.playerNode)) {
      state = { ...state, status: "won" };
    } else {
      state = { ...state, guards: moveGuards(board, state.guards), cleaners: moveGuards(board, state.cleaners) };
      if (!caughtOn(state, state.playerNode)) state = look(state, state.playerNode, false);
      if (caughtOn(state, state.playerNode)) state = { ...state, status: "caught" };
    }
  }

  if (state.status === "playing") state = settle(state, turn, marks);
  const entry = turnEntry(turn, phase.kind, state.playerNode, state.guards, state.alarm);
  return { ok: true, run: { ...state, turn: turn + 1, turns: [...state.turns, entry] } };
}

function toDetection(sighting: Sighting, nodeId: string): Detection {
  const strength = sighting.kind === "cleaner" ? "suspicion" : "sighting";
  return { strength, extraStep: sighting.extraStep, nodeId, cause: { kind: sighting.kind, id: sighting.id } };
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
