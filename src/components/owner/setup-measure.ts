// A setup measured from the floor plan alone (issue 120): how much of the
// floor the cameras and guards watch over a night, and how many ways in have a
// route to the objective that nothing watches. No crew, no batch and no model:
// the guards walk their rounds and the cameras sweep with no player present,
// and what each sees is the engine's own answer (`visibleFrom`, `watched`,
// `moveGuards`), the same the run board's cones draw and the same that catches
// the player. The nights are the ones the batch plays (issue 132): the setup
// applied on each of its seeds, then varied as the batch varies it, so a
// generated guard walks that night's round from that night's start. Both
// numbers take the owner's worst night: coverage counts what every night
// watches, and a way in is unwatched if any night leaves it a route that night
// never watches. Pure and deterministic, so it can run on every edit.
import { AUTOPLAY_MAX_TURNS, BATCH_SEEDS, compileBoard, createRun, moveGuards, varyLevel } from "@/engine";
import { roundOf } from "@/engine/autoplay";
import { visibleFrom, watched } from "@/engine/vision";
import type { Board, Level } from "@/engine";
import type { FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { applyOwnerSetup } from "@/level/owner-setup";
import { objectiveNoun } from "@/lib/objective-noun";

/**
 * The longest cycle `cycleLength` reports. A night is the least common
 * multiple of every guard's round (its hops times its tempo) and every
 * camera's sweep (2 or 3 turns); with odd round lengths that can grow large,
 * so it stops at 240 turns. The measure itself steps no further than an
 * attempt lasts (`AUTOPLAY_MAX_TURNS`, 120 turns).
 */
export const CYCLE_CAP = 240;

export interface SetupMeasure {
  /** Positions on the floor (nodes). */
  positions: number;
  /** Positions some camera or guard watches at some point in every night the batch plays. */
  watched: number;
  /** Watched as a share of the floor, 0–100, a whole percent: never 100 with a position unwatched, nor 0 with one watched. */
  coverage: number;
  /** Ways in (entries) on this floor. */
  entries: number;
  /** Ways in that, on at least one night the batch plays, have a route to the objective that nothing watches that night. */
  unwatched: number;
  /** The nights on which at least one way in has such a route. */
  openNights: number;
  /** The nights the batch plays. */
  nights: number;
  /** What the objective is, for the lines: "files". */
  noun: string;
  /** The turns stepped through on the longest night: its cycle, but no longer than an attempt. */
  cycle: number;
}

/** One night as the measure reads it: the level the batch plays, and the ways in. */
export interface MeasureNight {
  level: Level;
  entries: readonly { nodeId: string }[];
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;

/** The night's length on this board: the least common multiple of the rounds and sweeps, capped. */
export function cycleLength(board: Board): number {
  const { level } = board;
  const tempo = (id: string) => level.guardTempo?.[id] ?? level.patrolTempo;
  const lengths = [
    ...level.guards.map((g) => roundOf(board, g.patrol).length * tempo(g.id)),
    ...board.cameras.map((c) => c.parts.length),
  ];
  let cycle = 1;
  for (const n of lengths) {
    cycle = lcm(cycle, Math.max(1, n));
    if (cycle >= CYCLE_CAP) return CYCLE_CAP;
  }
  return cycle;
}

/**
 * Every position a camera or guard watches at some point over one night with
 * nobody on the floor. Night cleaners are left out: their sighting never
 * catches the crew. A guard counts where it stands each turn, from turn 0 (the
 * crew's first move is checked against the guards as they start), which also
 * covers the look the engine takes after the guards move. It steps one whole
 * cycle, or as long as an attempt lasts if that is shorter: what is watched
 * only later is never met by any attempt.
 */
export function watchedPositions(level: Level): { nodes: Set<string>; cycle: number } {
  const run = createRun(level);
  const { board } = run;
  const cycle = Math.min(cycleLength(board), AUTOPLAY_MAX_TURNS);
  const nodes = new Set<string>();
  let guards = run.guards;
  for (let turn = 0; turn <= cycle; turn++) {
    for (const camera of board.cameras) watched(camera, turn).forEach((id) => nodes.add(id));
    for (const guard of guards) visibleFrom(board, guard).forEach((id) => nodes.add(id));
    guards = moveGuards(board, guards);
  }
  return { nodes, cycle };
}

/**
 * The nights the batch plays for this setup, built as the batch builds them:
 * `ownerBatchInput`'s `levelFor` (the setup applied on the seed) and then
 * `runBatch`'s `varyLevel` on the same seed. Null when the setup has a problem,
 * as the batch then refuses to play it.
 */
export function batchNights(
  manifest: LevelManifest,
  floor: FloorGraph,
  setup: OwnerSetup,
  seeds: readonly number[] = BATCH_SEEDS,
): MeasureNight[] | null {
  const nights: MeasureNight[] = [];
  for (const seed of seeds) {
    const applied = applyOwnerSetup(manifest, floor, setup, seed);
    if (!applied.ok) return null;
    nights.push({ level: varyLevel(applied.placed.level, seed), entries: applied.placed.entries });
  }
  return nights;
}

/** Whether a route runs from `from` to `to` on unwatched positions only. Every door counts as passable: the crew picks locks. */
function reachesUnseen(board: Board, from: string, to: string, seen: ReadonlySet<string>): boolean {
  if (seen.has(from) || seen.has(to)) return false;
  const visited = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (at === to) return true;
    for (const exit of board.adjacency.get(at) ?? []) {
      if (visited.has(exit.to) || seen.has(exit.to)) continue;
      visited.add(exit.to);
      queue.push(exit.to);
    }
  }
  return false;
}

/** `part` of `whole` as a whole percent, kept off 0 and 100 unless it is exactly that. */
function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  const p = Math.round((100 * part) / whole);
  return part > 0 && p === 0 ? 1 : part < whole && p === 100 ? 99 : p;
}

/**
 * Coverage and unwatched routes over a set of nights, each read as the
 * owner's worst case so that its line holds on every night: coverage counts
 * only the positions watched at some point in every night, and a way in counts
 * as unwatched if on any night it has a route that that night never watches.
 */
export function measureNights(nights: readonly MeasureNight[]): SetupMeasure {
  if (nights.length === 0) throw new Error("measureNights needs at least one night");
  const watches = nights.map((n) => watchedPositions(n.level));
  const every = new Set([...watches[0].nodes].filter((id) => watches.every((w) => w.nodes.has(id))));
  const { level } = nights[0];
  // Every night is the same floor, so the same graph; only who watches it differs.
  const board = compileBoard(level);
  const positions = level.floor.nodes.length;
  const watchedCount = level.floor.nodes.filter((n) => every.has(n.id)).length;
  const ways = [...new Set(nights.flatMap((n) => n.entries.map((e) => e.nodeId)))];
  const open = nights.map((n, i) => {
    const here = new Set(n.entries.map((e) => e.nodeId));
    return new Set(ways.filter((id) => here.has(id) && reachesUnseen(board, id, n.level.objective, watches[i].nodes)));
  });
  return {
    positions,
    watched: watchedCount,
    coverage: percent(watchedCount, positions),
    entries: ways.length,
    unwatched: ways.filter((id) => open.some((o) => o.has(id))).length,
    openNights: open.filter((o) => o.size > 0).length,
    nights: nights.length,
    noun: objectiveNoun(level.missionId),
    cycle: Math.max(...watches.map((w) => w.cycle)),
  };
}

/** Coverage and unwatched routes for a setup, over the nights its batch plays. Null when the setup has a problem. */
export function measureSetup(
  manifest: LevelManifest,
  floor: FloorGraph,
  setup: OwnerSetup,
  seeds: readonly number[] = BATCH_SEEDS,
): SetupMeasure | null {
  const nights = batchNights(manifest, floor, setup, seeds);
  return nights && nights.length > 0 ? measureNights(nights) : null;
}

/** "Coverage: 47% of the floor is watched at some point in every night the crew plays." */
export function coverageLine(m: SetupMeasure): string {
  return `Coverage: ${m.coverage}% of the floor is watched at some point in every night the crew plays.`;
}

/** "the 10 nights the crew plays", or "the one night" when there is one. */
const nightsPhrase = (m: SetupMeasure) => (m.nights === 1 ? "the one night the crew plays" : `the ${m.nights} nights the crew plays`);

/**
 * "Unwatched routes: 1 of 2 ways in has, on 4 of the 10 nights the crew plays,
 * a route to the prototype that no camera or guard sees that night." With none:
 * "…0 of 2 ways in have, on any of the 10 nights…".
 */
export function routesLine(m: SetupMeasure): string {
  if (m.entries === 0) return "Unwatched routes: this floor has no way in to measure.";
  const ways = `${m.unwatched} of ${m.entries} ${m.entries === 1 ? "way" : "ways"} in`;
  const route = `a route to the ${m.noun} that no camera or guard sees that night`;
  if (m.unwatched === 0) {
    const on = m.nights === 1 ? `on ${nightsPhrase(m)}` : `on any of ${nightsPhrase(m)}`;
    return `Unwatched routes: ${ways} ${m.entries === 1 ? "has" : "have"}, ${on}, ${route}.`;
  }
  const on =
    m.nights === 1 ? `on ${nightsPhrase(m)}` : m.openNights === m.nights ? `on every one of ${nightsPhrase(m)}` : `on ${m.openNights} of ${nightsPhrase(m)}`;
  return `Unwatched routes: ${ways} ${m.unwatched === 1 ? "has" : "have"}, ${on}, ${route}.`;
}

/**
 * With no night leaving a route unwatched, the attempts that got out crossed
 * watched ground on the night they played: "On every night the crew plays,
 * every route to the files crosses ground a camera or guard watches at some
 * point that night, so the 17 attempts that got out did it by timing, or were
 * seen and not caught." Null when none got out or any night has an unwatched
 * route.
 */
export function timingLine(m: SetupMeasure, escaped: number): string | null {
  if (escaped <= 0 || m.unwatched > 0 || m.entries === 0) return null;
  const who = escaped === 1 ? "the one attempt that got out did it by timing, or was" : `the ${escaped} attempts that got out did it by timing, or were`;
  return `On every night the crew plays, every route to the ${m.noun} crosses ground a camera or guard watches at some point that night, so ${who} seen and not caught.`;
}

/** "Coverage 43% → 50%, unwatched routes 0 → 0". */
export function measureChange(a: SetupMeasure, b: SetupMeasure): string {
  return `Coverage ${a.coverage}% → ${b.coverage}%, unwatched routes ${a.unwatched} → ${b.unwatched}`;
}
