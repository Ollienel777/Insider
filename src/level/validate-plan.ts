// The crew plan's validator (SPEC §4.4, D16; issue #19). The crew's model
// answers in zones; this walks those zones on the board, in the browser,
// through the engine itself (so patrols and camera cycles are the run's own),
// and says what the model cannot know: which camera or guard sees the plan,
// on which turn. It then reads the placement's quiet route (quiet-route.ts)
// and turns it into advice: where to wait, for how long, and what each wait
// avoids. The advice is the quiet route, never a route of its own.
//
// Pure: same placement, same plan, same answer. Nothing here is sent anywhere.
"use client";

import type { CrewPlan, FloorGraph } from "@/domain";
import { act, createRun, picksToOpen, shortestPath, type Action, type AlarmEvent, type RunState } from "@/engine";
import type { PlacedLevel } from "./placer";
import { quietRoute } from "./quiet-route";

/** A step of the crew's plan that the board could place, with the turns it covers. */
export interface CheckedStep {
  /** The step's number in the crew's reply, from 1 (dropped steps keep their numbers). */
  number: number;
  zoneId: string;
  /** The zone's fiction name: the manifest's, or the entry's label. */
  zone: string;
  action: string;
  /** The engine turns the step takes, first and last; null when it takes none (already there). */
  turns: { from: number; to: number } | null;
}

/** A step whose zone is not on this board, so the plan goes on without it. */
export interface DroppedStep {
  number: number;
  zoneId: string;
  action: string;
  reason: string;
}

export type WarningKind = "camera" | "guard" | "cleaner" | "noise" | "route";

/** What goes wrong when the plan is played, computed on the board. */
export interface PlanWarning {
  kind: WarningKind;
  /** The camera, guard or cleaner (C2, G3, K1); null for a route problem. */
  by: string | null;
  /** The engine turn it happens on, from 0. */
  turn: number;
  nodeId: string;
  /** The room it happens in, by its label. */
  room: string;
  /** Whether the player is carrying the objective by then. */
  outbound: boolean;
  text: string;
}

/** One wait on the quiet route, and what it avoids. */
export interface AdvisedWait {
  /** The engine turn of the first waiting turn. */
  turn: number;
  /** How many turns in a row. */
  turns: number;
  nodeId: string;
  room: string;
  outbound: boolean;
  /** What sees the player if this wait is skipped, and when; null if nothing does. */
  avoids: { kind: WarningKind; by: string | null; turn: number } | null;
  text: string;
}

/** The crew's advice: the placement's quiet route, as waits a player can follow. */
export interface Advice {
  route: readonly Action[];
  /** The nodes the route stands on, the start first, for the board's ghost path. */
  path: readonly string[];
  waits: readonly AdvisedWait[];
  /** One line for the route as a whole. */
  summary: string;
}

export interface CheckedPlan {
  steps: readonly CheckedStep[];
  dropped: readonly DroppedStep[];
  /** The plan as engine actions. */
  actions: readonly Action[];
  /** The nodes the plan stands on, the start first: the ghost path. */
  path: readonly string[];
  /** The first thing that goes wrong; empty when the plan gets out unseen. */
  warnings: readonly PlanWarning[];
  outcome: "clean" | "seen" | "unfinished";
  /** The quiet route as advice when the plan is not clean; null when the plan is, or the floor has no quiet route. */
  advice: Advice | null;
  /** True when the plan is not clean and the floor offers no quiet route either. */
  noQuietRoute: boolean;
}

// ---- reading the crew's words ---------------------------------------------------

const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5 };

/** Turns a step asks the player to wait: "wait two turns" is 2, "wait" or "hold" is 1, anything else 0. */
export function waitTurns(action: string): number {
  const text = action.toLowerCase();
  if (!/\b(wait|hold|let .* pass)\b/.test(text)) return 0;
  const m = /\b(\d+|one|a|two|three|four|five)\s+turns?\b/.exec(text);
  if (!m) return 1;
  const n = NUMBER_WORDS[m[1]] ?? Number(m[1]);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 5) : 1;
}

// ---- names --------------------------------------------------------------------

/** A zone's fiction name: the placed zone's, or an entry's label; the id when it has neither. */
export function zoneLabel(placed: PlacedLevel, zoneId: string): string {
  return (
    placed.zones.find((z) => z.zoneId === zoneId)?.name ??
    placed.entries.find((e) => e.entryId === zoneId)?.label ??
    zoneId
  );
}

function roomOf(floor: FloorGraph, nodeId: string): string {
  const roomId = floor.nodes.find((n) => n.id === nodeId)?.roomId;
  return floor.rooms.find((r) => r.id === roomId)?.label ?? nodeId;
}

const TURN_WORDS = ["no turns", "one turn", "two turns", "three turns", "four turns", "five turns"];
const turnsWord = (n: number) => TURN_WORDS[n] ?? `${n} turns`;

function sightingText(kind: WarningKind, by: string | null, room: string, turn: number, outbound: boolean): string {
  const when = `on turn ${turn}${outbound ? ", on the way out" : ""}`;
  switch (kind) {
    case "camera":
      return `Camera ${by} sees you in the ${room} ${when}.`;
    case "guard":
      return `Guard ${by} sees you in the ${room} ${when}.`;
    case "cleaner":
      return `A night cleaner (${by}) spots you in the ${room} ${when}.`;
    case "noise":
      return `Guard ${by} hears you in the ${room} ${when}.`;
    default:
      return `The plan stops in the ${room} ${when}.`;
  }
}

// ---- playing a list of actions --------------------------------------------------

interface Played {
  run: RunState;
  /** Actions that played, in order. */
  played: number;
  refused: string | null;
  raise: AlarmEvent | null;
}

/** Plays `actions` until one is refused, the alarm first moves, or the run ends. */
function playUntilTrouble(start: RunState, actions: readonly Action[]): Played {
  let run = start;
  for (let i = 0; i < actions.length; i++) {
    if (run.status !== "playing") return { run, played: i, refused: null, raise: null };
    const result = act(run, actions[i]);
    if (!result.ok) return { run, played: i, refused: result.reason, raise: null };
    run = result.run;
    const raise = run.alarmEvents.find((e) => e.cause.kind !== "decay") ?? null;
    if (raise) return { run, played: i + 1, refused: null, raise };
  }
  return { run, played: actions.length, refused: null, raise: null };
}

function warningOf(placed: PlacedLevel, played: Played): PlanWarning | null {
  const { floor } = placed.level;
  if (played.raise) {
    const { turn, cause } = played.raise;
    const entry = played.run.turns[turn];
    const nodeId = entry?.player.nodeId ?? played.run.playerNode;
    const kind = (["camera", "guard", "cleaner", "noise"] as const).find((k) => k === cause.kind) ?? "route";
    const by = cause.id ?? null;
    const room = roomOf(floor, nodeId);
    const outbound = played.run.turns.slice(0, turn + 1).some((t) => t.player.kind === "take");
    return { kind, by, turn, nodeId, room, outbound, text: sightingText(kind, by, room, turn, outbound) };
  }
  return null;
}

/** The nodes a list of actions stands on, the start first, with no repeats in a row. */
function pathOf(level: PlacedLevel["level"], actions: readonly Action[]): string[] {
  const path = [level.start];
  for (const action of actions) {
    if (action.kind === "move" || action.kind === "sprint") {
      if (action.kind === "sprint" && action.via) path.push(action.via);
      if (path[path.length - 1] !== action.to) path.push(action.to);
    }
  }
  return path;
}

// ---- the crew's plan as actions ----------------------------------------------------

/**
 * The crew's steps as engine actions: each step walks the shortest way to its
 * zone (the objective zone means the objective itself, which it takes),
 * picking any locked door on the way, then waits as its words say.
 */
function expand(placed: PlacedLevel, plan: CrewPlan) {
  const { level } = placed;
  const run0 = createRun(level);
  const board = run0.board;
  const zones = level.zones ?? {};
  const steps: CheckedStep[] = [];
  const dropped: DroppedStep[] = [];
  const actions: Action[] = [];
  const locked = new Set(level.lockedDoors);
  let at = level.start;
  let carrying = false;
  // Where each step's actions end, to give each its turns.
  const spans: { step: CheckedStep; from: number; to: number }[] = [];

  plan.steps.forEach((s, i) => {
    const number = i + 1;
    const nodes = Object.hasOwn(zones, s.zoneId) ? zones[s.zoneId] : null;
    if (!nodes) {
      dropped.push({ number, zoneId: s.zoneId, action: s.action, reason: `"${s.zoneId}" is not a zone on this floor` });
      return;
    }
    const isObjective = s.zoneId === placed.objective.zoneId;
    const goals = isObjective ? [level.objective] : nodes;
    const route = shortestPath(board, at, goals);
    if (!route) {
      dropped.push({ number, zoneId: s.zoneId, action: s.action, reason: `no way from here to ${zoneLabel(placed, s.zoneId)}` });
      return;
    }
    const from = actions.length;
    for (let h = 1; h < route.length; h++) {
      const door = board.adjacency.get(route[h - 1])!.find((e) => e.to === route[h])?.doorId;
      if (door && locked.has(door)) {
        for (let p = 0; p < picksToOpen(level, door); p++) actions.push({ kind: "pick", doorId: door });
        locked.delete(door);
      }
      actions.push({ kind: "move", to: route[h] });
    }
    at = route[route.length - 1];
    if (isObjective && !carrying && at === level.objective) {
      actions.push({ kind: "take" });
      carrying = true;
    }
    for (let w = 0; w < waitTurns(s.action); w++) actions.push({ kind: "wait" });
    const step: CheckedStep = { number, zoneId: s.zoneId, zone: zoneLabel(placed, s.zoneId), action: s.action, turns: null };
    steps.push(step);
    spans.push({ step, from, to: actions.length - 1 });
  });

  return { run0, steps, dropped, actions, spans };
}

// ---- the advice -------------------------------------------------------------------

/** The quiet route's waits, each with what skipping it would run into. */
function adviceOf(placed: PlacedLevel, route: readonly Action[]): Advice {
  const { level } = placed;
  const start = createRun(level);
  const waits: AdvisedWait[] = [];
  let carrying = false;
  let at = level.start;
  for (let i = 0; i < route.length; i++) {
    const action = route[i];
    if (action.kind === "take") carrying = true;
    if (action.kind === "move") at = action.to;
    if (action.kind !== "wait" || route[i - 1]?.kind === "wait") continue;
    let n = 1;
    while (route[i + n]?.kind === "wait") n++;
    const skipped = [...route.slice(0, i), ...route.slice(i + n)];
    const trouble = warningOf(placed, playUntilTrouble(start, skipped));
    const room = roomOf(level.floor, at);
    const lead = carrying ? `On the way out, wait ${turnsWord(n)}` : `Wait ${turnsWord(n)}`;
    const why = trouble
      ? ` Skip it and ${trouble.kind === "camera" ? "camera " : trouble.kind === "guard" || trouble.kind === "noise" ? "guard " : ""}${trouble.by} ${trouble.kind === "noise" ? "hears" : "sees"} you on turn ${trouble.turn}.`
      : "";
    waits.push({
      turn: i,
      turns: n,
      nodeId: at,
      room,
      outbound: carrying,
      avoids: trouble ? { kind: trouble.kind, by: trouble.by, turn: trouble.turn } : null,
      text: `${lead} in the ${room}, turn ${i}.${why}`,
    });
  }
  const last = route[route.length - 1];
  const exit = last && last.kind === "move" ? placed.entries.find((e) => e.nodeId === last.to) : undefined;
  const entry = placed.entries.find((e) => e.nodeId === level.start);
  const outWord = exit && entry && exit.entryId === entry.entryId ? "back out the same way" : `out by the ${exit?.label.toLowerCase() ?? "nearest exit"}`;
  const summary = `In by the ${entry?.label.toLowerCase() ?? "start"}, ${outWord}: ${route.length} turns, nobody sees you.`;
  return { route, path: pathOf(level, route), waits, summary };
}

// ---- the validator ------------------------------------------------------------------

const adviceCache = new WeakMap<PlacedLevel, Advice | null>();

/** The placement's quiet route as advice, computed once per placement. */
export function adviceFor(placed: PlacedLevel): Advice | null {
  if (!adviceCache.has(placed)) {
    const route = quietRoute(placed);
    adviceCache.set(placed, route ? adviceOf(placed, route) : null);
  }
  return adviceCache.get(placed)!;
}

/**
 * Checks the crew's plan on the placed level: drops steps whose zones are
 * not on the board, plays the rest through the engine, and names the first
 * camera, guard, cleaner or noise that would give the player away, with its
 * turn. When the plan is not clean, attaches the quiet route as advice.
 */
export function validatePlan(placed: PlacedLevel, plan: CrewPlan): CheckedPlan {
  const { run0, steps, dropped, actions, spans } = expand(placed, plan);
  const played = playUntilTrouble(run0, actions);
  for (const span of spans) {
    if (span.to >= span.from && span.from < played.played) {
      span.step.turns = { from: span.from, to: Math.min(span.to, played.played - 1) };
    }
  }

  const warnings: PlanWarning[] = [];
  const seen = warningOf(placed, played);
  if (seen) warnings.push(seen);
  else if (played.refused) {
    const nodeId = played.run.playerNode;
    const room = roomOf(placed.level.floor, nodeId);
    warnings.push({
      kind: "route",
      by: null,
      turn: played.played,
      nodeId,
      room,
      outbound: played.run.carrying,
      text: `The plan can't be played past turn ${played.played} in the ${room}: ${played.refused}.`,
    });
  } else if (played.run.status !== "won") {
    const nodeId = played.run.playerNode;
    const room = roomOf(placed.level.floor, nodeId);
    warnings.push({
      kind: "route",
      by: null,
      turn: played.played,
      nodeId,
      room,
      outbound: played.run.carrying,
      text: played.run.carrying
        ? `The plan ends in the ${room} with the files, short of an exit.`
        : `The plan never takes the files: it ends in the ${room}.`,
    });
  }

  const outcome: CheckedPlan["outcome"] = warnings.length === 0 ? "clean" : seen ? "seen" : "unfinished";
  const advice = outcome === "clean" ? null : adviceFor(placed);
  return {
    steps,
    dropped,
    actions,
    path: pathOf(placed.level, actions),
    warnings,
    outcome,
    advice,
    noQuietRoute: outcome !== "clean" && advice === null,
  };
}
