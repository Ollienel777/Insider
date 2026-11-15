"use client";

// The two moments a play-tester missed (issue 188): the files taken, and a
// locked door opening. Both views read them from here: the radio carries the
// one-shot line, and the HUD keeps the carrying state for the rest of the run.
// Presentation only: everything is read off run states the engine already
// gave, and a moment lasts a number of turns, not a timer, so it never runs
// on while the clock is paused.
import { useState } from "react";
import type { RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveNoun } from "@/lib/objective-noun";
import { joinOr, roomName } from "./board";

/** How many turns a moment's line keeps the radio: about 3.5 s in first person. */
export const MOMENT_TURNS = 5;

export type Moment =
  | { kind: "take"; text: string }
  | { kind: "door"; doorId: string; text: string };

/** The exits' names, lower-case, the one `first` names (the nearest) first. */
export function exitNames(placed: PlacedLevel, first: string | null = null): string[] {
  const exits = placed.entries.filter((e) => placed.level.exits.includes(e.nodeId));
  exits.sort((a, b) => Number(b.nodeId === first) - Number(a.nodeId === first));
  return exits.map((e) => e.label.toLowerCase());
}

/**
 * The objective line's goal once the player carries the objective: every way
 * out, nearest first, and what reaching one does. The engine wins the run on
 * the move onto an exit node while carrying; there is no key for it.
 */
export function wayOutGoal(placed: PlacedLevel, nearest: string | null): string {
  const names = exitNames(placed, nearest);
  if (names.length === 0) return "Get out the way you came in.";
  const reach = names.length === 1 ? "Reach it" : names.length === 2 ? "Reach either" : "Reach any one";
  return `Out by the ${joinOr(names)}. ${reach} with the ${objectiveNoun(placed.level.missionId)} and the run ends.`;
}

/** The line said the turn the take lands. */
export function takeLine(placed: PlacedLevel, nearest: string | null = null): string {
  const names = exitNames(placed, nearest);
  const out = names.length > 0 ? `the ${joinOr(names)}` : "the way you came in";
  return `You have the ${objectiveNoun(placed.level.missionId)}. Get out by ${out}.`;
}

/** The room a door leads into from `from`, or the room on either side of it when `from` is not at it. */
function doorRoom(placed: PlacedLevel, run: RunState, doorId: string, from: string): string | null {
  const own = run.board.adjacency.get(from)?.find((e) => e.doorId === doorId);
  if (own) return roomName(placed.level.floor, own.to);
  for (const [, exits] of run.board.adjacency) {
    const any = exits.find((e) => e.doorId === doorId);
    if (any) return roomName(placed.level.floor, any.to);
  }
  return null;
}

/** What changed between two states of one run that the player must not miss; null for nothing. The take outranks a door. */
export function momentOf(placed: PlacedLevel, before: RunState, after: RunState): Moment | null {
  if (after.status !== "playing") return null;
  if (!before.carrying && after.carrying) return { kind: "take", text: takeLine(placed, nearestExit(after)) };
  // Only a door the player's own pick opened: the engine also clears every Chief lock when the alarm falls to Calm.
  // The turn log keeps the pick's kind, not its door, so the door must be on an edge out of the player's node.
  if (after.turns.at(-1)?.player.kind !== "pick") return null;
  const doorId = before.locked.find(
    (d) => !after.locked.includes(d) && !before.chiefLocks.includes(d) && (after.board.adjacency.get(after.playerNode) ?? []).some((e) => e.doorId === d),
  );
  if (!doorId) return null;
  const room = doorRoom(placed, after, doorId, after.playerNode);
  return { kind: "door", doorId, text: room ? `Door open: the ${room}.` : "Door open." };
}

/** The exit the engine's shortest open path reaches first, by hops. */
function nearestExit(run: RunState): string | null {
  const exits = run.board.level.exits;
  const seen = new Set([run.playerNode]);
  let layer = [run.playerNode];
  while (layer.length > 0) {
    const hit = layer.find((id) => exits.includes(id));
    if (hit) return hit;
    const next: string[] = [];
    for (const id of layer) {
      for (const e of run.board.adjacency.get(id) ?? []) {
        if (seen.has(e.to) || (e.doorId !== undefined && run.locked.includes(e.doorId))) continue;
        seen.add(e.to);
        next.push(e.to);
      }
    }
    layer = next;
  }
  return null;
}

type Kept = { run: RunState | null; moment: (Moment & { turn: number }) | null };

/** The moment on this turn: the last one, for `MOMENT_TURNS` turns after it, while the run is on. */
export function shownMoment(kept: Kept["moment"], run: RunState | null): Moment | null {
  if (!kept || !run || run.status !== "playing" || run.turn - kept.turn >= MOMENT_TURNS) return null;
  return { ...kept };
}

/** Folds the next run state into what is kept: a new moment when one happened, nothing on a new run or a step back. */
export function keepMoment(kept: Kept, placed: PlacedLevel | null, run: RunState | null): Kept {
  const was = kept.run;
  if (!run || !was || !placed || run.board !== was.board || run.turn < was.turn) return { run, moment: null };
  // Compared state to state, so two turns played in one render still show their moment.
  const moment = run.turn > was.turn ? momentOf(placed, was, run) : null;
  return { run, moment: moment ? { ...moment, turn: run.turn } : kept.moment };
}

/** The moment to show for `run`, kept across renders. */
export function useMoment(placed: PlacedLevel | null, run: RunState | null): Moment | null {
  const [kept, setKept] = useState<Kept>({ run, moment: null });
  if (kept.run === run) return shownMoment(kept.moment, run);
  const next = keepMoment(kept, placed, run);
  setKept(next);
  return shownMoment(next.moment, run);
}
