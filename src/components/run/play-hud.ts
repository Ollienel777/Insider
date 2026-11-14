"use client";

// What Live mode's HUD says, read off the board (issue 100). The three HUD
// elements (objective-line.tsx, danger-meter.tsx, radio-line.tsx) take plain
// words and numbers and know nothing about the board, so the first-person
// scan view can show the same ones. This file is the board's side: it turns
// the run, the placed level, the crew's plan and the Chief's stream into what
// they show. The engine stays authoritative: the hops are its `shortestPath`,
// and who noticed the player is its own checks, replayed with its `watched`,
// `visibleFrom` and `withinHops`.
import { useMemo, useState } from "react";
import type { AlarmState } from "@/domain";
import {
  hearingRange,
  neighbours,
  shortestPath,
  visibleFrom,
  watched,
  withinHops,
  type Exit,
  type GuardState,
  type RunState,
} from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveNoun } from "@/lib/objective-noun";
import { canTake, crewPlanSteps, planSteps, roomName } from "./board";
import type { ChiefState, Revealed } from "./chief-panel";
import type { StoredCrewPlan } from "./crew-plan-store";
import { watcherPhrase, type Watcher } from "./danger-meter";
import { useRadio, type RadioCallout, type RadioFacts, type RadioMessage } from "./radio";

// ---- the hops left ---------------------------------------------------------------

export interface Route {
  /** The node the route ends on: the objective, or the nearest exit once the player carries it. */
  goal: string;
  /** Hops from the player's node to it. */
  hops: number;
  /** Locked doors on the way. 0 on an open path. */
  locks: number;
}

/**
 * The player's way to what they are after: the objective, or the nearest exit
 * once they carry it. It is the shortest open path, one that passes no locked
 * door. When no open path exists (the objective's own door until it is picked,
 * or a door the Chief locked), it is the shortest path through locked doors,
 * with how many it passes. Null when the floor does not join the two at all.
 */
export function routeLeft(run: RunState): Route | null {
  const { board } = run;
  const goals = run.carrying ? board.level.exits : [board.level.objective];
  const locked = (exit: Exit) => exit.doorId !== undefined && run.locked.includes(exit.doorId);
  const open = shortestPath(board, run.playerNode, goals, (exit) => !locked(exit));
  if (open) return { goal: open[open.length - 1], hops: open.length - 1, locks: 0 };
  const through = shortestPath(board, run.playerNode, goals);
  if (!through) return null;
  let locks = 0;
  for (let i = 1; i < through.length; i++) {
    const exit = neighbours(board, through[i - 1]).find((e) => e.to === through[i]);
    if (exit && locked(exit)) locks += 1;
  }
  return { goal: through[through.length - 1], hops: through.length - 1, locks };
}

// ---- who noticed the player ------------------------------------------------------

const isAlert = (alarm: AlarmState) => alarm === "alert" || alarm === "lockdown";

/**
 * Who saw or heard the player on the turn that took `before` to `after`, in
 * the order the engine checked them (actions.ts `act`): this turn's cameras
 * and the guards and cleaners where they stood, as the player landed; the
 * guards who heard a sprint or a pick; then the guards and cleaners again
 * after their move. As in the engine, a cleaner's look and a noise count for
 * nothing once the alarm is at Alert, and a guard that catches the player on
 * its own node ends the turn before anyone else looks. Empty when `after` is
 * not the turn after `before`.
 *
 * The log does not keep the middle node of a sprint, so a sighting there is
 * read from the alarm event it raised.
 */
export function noticedBy(before: RunState, after: RunState): Watcher[] {
  if (after.board !== before.board || after.turn !== before.turn + 1) return [];
  const { board } = before;
  const here = after.playerNode;
  const kind = after.turns[after.turns.length - 1]?.player.kind;
  const found: Watcher[] = [];
  let alert = isAlert(before.alarm);
  const note = (id: string, sense: Watcher["sense"], sighting: boolean) => {
    // The engine drops a suspicion at Alert (alarm.ts `detect`).
    if (!sighting && alert) return;
    if (sighting) alert = true;
    if (!found.some((w) => w.id === id)) found.push({ id, sense });
  };
  const caughtBy = (guards: readonly GuardState[]) => alert && guards.some((g) => g.nodeId === here);
  const look = (guards: readonly GuardState[], cleaners: readonly GuardState[]) => {
    for (const guard of guards) if (visibleFrom(board, guard).includes(here)) note(guard.id, "sees", true);
    for (const cleaner of cleaners) if (visibleFrom(board, cleaner).includes(here)) note(cleaner.id, "sees", false);
  };

  // A sighting on the way (a sprint's middle node), from the event it raised.
  for (const event of after.alarmEvents.slice(before.alarmEvents.length)) {
    const { cause } = event;
    if (cause.id === undefined || event.turn !== before.turn) continue;
    if (cause.kind === "camera" || cause.kind === "guard") note(cause.id, "sees", true);
  }
  alert = isAlert(before.alarm);

  // The player's half of the turn.
  if (!caughtBy(before.guards)) {
    for (const camera of board.cameras) if (watched(camera, before.turn).includes(here)) note(camera.id, "sees", true);
    look(before.guards, before.cleaners);
  }
  if (caughtBy(before.guards)) return found;
  if (kind === "sprint" || kind === "pick") {
    const heard = withinHops(board, here, hearingRange(board, here));
    for (const guard of before.guards) if (heard.has(guard.nodeId)) note(guard.id, "hears", false);
  }
  // The guards' half: they have moved, and look again. A run the player just won ends before it.
  if (after.status === "won") return found;
  if (!caughtBy(after.guards)) look(after.guards, after.cleaners);
  return found;
}

/** The callout for a turn somebody noticed the player on: who, and the room. Null when nobody did. */
export function calloutOf(watchers: readonly Watcher[], turn: number, room: string): RadioCallout | null {
  if (watchers.length === 0) return null;
  const kind = watchers.some((w) => w.sense === "sees") ? "sighting" : "noise";
  return { turn, kind, text: `${watcherPhrase(watchers)} in the ${room}.` };
}

// ---- the Chief on the radio ------------------------------------------------------

/**
 * The Chief's re-plan as radio lines: the sentences of its rationale that the
 * stream has finished, in order. `words` is how many words are on screen
 * (`useChiefStream`), counted as the stream counts them.
 */
export function chiefLines(rationale: string, words: number): string[] {
  const all = rationale.split(/\s+/);
  const lines: string[] = [];
  let from = 0;
  all.forEach((word, i) => {
    const ends = /[.!?]["')\]]?$/.test(word) || i === all.length - 1;
    if (!ends) return;
    const line = all.slice(from, i + 1).join(" ").trim();
    if (i < words && line) lines.push(line);
    from = i + 1;
  });
  return lines;
}

// ---- the HUD, from the board -----------------------------------------------------

/** What the objective line shows (the props of `ObjectiveLine`, less its action's handler). */
export interface ObjectiveInfo {
  /** The mono caps label: "Objective", then "Way out" once the player carries it. */
  label: string;
  /** The goal in the mission's own words, or the exit by name once the player carries the objective. */
  goal: string;
  /** Hops left on the route; null when there is no route, or the run is over. */
  hops: number | null;
  /** Locked doors on the route. */
  locks: number;
  /** "Files taken" once the player carries the objective; null before. */
  taken: string | null;
  /** The player stands on the objective and can take it: the label of the action that does. */
  take: string | null;
}

/**
 * The objective line for this turn: the mission's objective and the hops to
 * it; once the player carries it, the nearest exit by name and the hops to
 * that; once the run is over, how it ended.
 */
export function objectiveInfo(placed: PlacedLevel, run: RunState, objective: string, exitCondition: string): ObjectiveInfo {
  const noun = objectiveNoun(placed.level.missionId);
  const taken = run.carrying ? `${noun[0].toUpperCase()}${noun.slice(1)} taken` : null;
  if (run.status === "won") return { label: "Clean exit", goal: `Out with the ${noun}.`, hops: null, locks: 0, taken: null, take: null };
  if (run.status === "caught") {
    const room = roomName(placed.level.floor, run.playerNode);
    return { label: "Caught", goal: `Caught in the ${room}.`, hops: null, locks: 0, taken, take: null };
  }
  const route = routeLeft(run);
  const hops = route?.hops ?? null;
  const locks = route?.locks ?? 0;
  if (!run.carrying) {
    return { label: "Objective", goal: objective, hops, locks, taken: null, take: canTake(run) ? `Take the ${noun}` : null };
  }
  const exit = placed.entries.find((e) => e.nodeId === route?.goal);
  return { label: "Way out", goal: exit ? `Out by the ${exit.label.toLowerCase()}` : exitCondition, hops, locks, taken, take: null };
}

/** The crew's next plan step: the briefed plan's when there is one, else the level's own (as the Run panel's plan). */
export function nextStep(placed: PlacedLevel, run: RunState, objective: string, crewPlan: StoredCrewPlan | null): string | null {
  const briefed = crewPlan ? crewPlanSteps(placed, run, crewPlan.plan) : [];
  const steps = briefed.length > 0 ? briefed : planSteps(placed, run, objective);
  return steps.find((s) => s.state === "next")?.label ?? null;
}

/** Everything the HUD shows on one render. */
export interface PlayHud {
  objective: ObjectiveInfo;
  danger: { alarm: AlarmState; watchers: readonly Watcher[] };
  /** The one line on the radio; null when it is quiet. */
  radio: RadioMessage | null;
}

/** The run now and the state its last turn started from; `before` is null on a fresh run. */
interface TurnPair {
  before: RunState | null;
  after: RunState | null;
}

/**
 * The run with the state its last turn started from, kept from the renders
 * before. The Chief's orders landing mid-turn make a new state of the same
 * turn, which keeps the same `before`; a new run starts with none.
 */
function useLastTurn(run: RunState | null): TurnPair {
  const [pair, setPair] = useState<TurnPair>({ before: null, after: run });
  if (pair.after === run) return pair;
  const was = pair.after;
  const sameRun = run !== null && was !== null && run.board === was.board;
  const before = !sameRun ? null : run.turn === was.turn + 1 ? was : run.turn === was.turn ? pair.before : null;
  const next = { before, after: run };
  setPair(next);
  return next;
}

/**
 * The HUD on the Run screen. Null in Tactical and while there is no run on
 * the board: nothing is computed or timed then.
 */
export function usePlayHud({
  live,
  placed,
  run,
  mission,
  crewPlan,
  chief,
  revealed,
  notice,
}: {
  live: boolean;
  placed: PlacedLevel | null;
  run: RunState | null;
  /** The mission's own lines for the objective and the way out. */
  mission: { objective: string; exitCondition: string } | null;
  /** The plan briefed on the Plan screen; the level's own steps stand in without one. */
  crewPlan: StoredCrewPlan | null;
  chief: ChiefState;
  /** How much of the Chief's answer its stream has shown (`useChiefStream`). */
  revealed: Revealed;
  /** A line that stands in for the plan step while it applies: the sprint hint. */
  notice: string | null;
}): PlayHud | null {
  const { before, after } = useLastTurn(run);
  const on = live && placed !== null && run !== null && mission !== null;
  const watchers = useMemo(() => (on && before && after ? noticedBy(before, after) : []), [on, before, after]);

  const playing = on && run.status === "playing";
  const step = useMemo(
    () => (playing ? (notice ?? nextStep(placed, run, mission.objective, crewPlan)) : null),
    [playing, placed, run, mission, crewPlan, notice],
  );
  const callout = playing ? calloutOf(watchers, run.turn - 1, roomName(placed.level.floor, run.playerNode)) : null;
  // A late answer reached no guard (the run had ended): it is not read out.
  const reading = playing && chief.status === "ready" && !chief.late ? chief : null;
  const lines = useMemo(
    () => (reading ? chiefLines(reading.answer.orders.rationale, revealed.words) : []),
    [reading, revealed.words],
  );
  const facts: RadioFacts | null = playing
    ? { step, callout, chief: reading ? { answer: reading, lines, done: revealed.done } : null }
    : null;
  const radio = useRadio(facts);

  const objective = useMemo(
    () => (on ? objectiveInfo(placed, run, mission.objective, mission.exitCondition) : null),
    [on, placed, run, mission],
  );
  if (!on || !objective) return null;
  return { objective, danger: { alarm: run.alarm, watchers }, radio };
}
