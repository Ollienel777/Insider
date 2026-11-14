// A setup measured from the floor plan alone (issue 120): how much of the
// floor the cameras and guards watch over a night, and how many ways in still
// have a route to the objective that nothing ever sees. No crew, no batch and
// no model: the guards walk their rounds and the cameras sweep with no player
// present, and what each sees is the engine's own answer (`visibleFrom`,
// `watched`, `moveGuards`), the same the run board's cones draw and the same
// that catches the player. The nights are the ones the batch plays (issue
// 132): the setup applied on each of its seeds, then varied as the batch
// varies it, so a generated guard walks that night's round from that night's
// start. Pure and deterministic, so it can run on every edit.
import { BATCH_SEEDS, compileBoard, createRun, moveGuards, varyLevel } from "@/engine";
import { roundOf } from "@/engine/autoplay";
import { visibleFrom, watched } from "@/engine/vision";
import type { Board, Level } from "@/engine";
import type { FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { applyOwnerSetup } from "@/level/owner-setup";
import { objectiveNoun } from "@/lib/objective-noun";

/**
 * The longest night the measure steps through. A night is the least common
 * multiple of every guard's round (its hops times its tempo) and every
 * camera's sweep (2 or 3 turns); with odd round lengths that can grow large,
 * so it stops at 240 turns, which is longer than any attempt (120 turns).
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
  /** Ways in with a route to the objective on positions that no camera or guard watches on any night the batch plays. */
  unwatched: number;
  /** What the objective is, for the lines: "files". */
  noun: string;
  /** The turns stepped through: the longest night's length, capped at `CYCLE_CAP`. */
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
 * covers the look the engine takes after the guards move.
 */
export function watchedPositions(level: Level): { nodes: Set<string>; cycle: number } {
  const run = createRun(level);
  const { board } = run;
  const cycle = cycleLength(board);
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
 * Coverage and unwatched routes over a set of nights, read so that both lines
 * hold on every one of them: coverage counts only the positions watched at
 * some point in every night, and a route is unwatched only if no night ever
 * watches any position on it.
 */
export function measureNights(nights: readonly MeasureNight[]): SetupMeasure {
  if (nights.length === 0) throw new Error("measureNights needs at least one night");
  const watches = nights.map((n) => watchedPositions(n.level));
  const every = new Set([...watches[0].nodes].filter((id) => watches.every((w) => w.nodes.has(id))));
  const ever = new Set(watches.flatMap((w) => [...w.nodes]));
  const { level } = nights[0];
  const board = compileBoard(level);
  const positions = level.floor.nodes.length;
  const watchedCount = level.floor.nodes.filter((n) => every.has(n.id)).length;
  const ways = [...new Set(nights[0].entries.map((e) => e.nodeId))];
  const unwatched = ways.filter((id) => nights.every((n) => reachesUnseen(board, id, n.level.objective, ever))).length;
  return {
    positions,
    watched: watchedCount,
    coverage: percent(watchedCount, positions),
    entries: ways.length,
    unwatched,
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

/** "Unwatched routes: 0 of 2 ways in have a route to the files that no camera or guard ever sees." */
export function routesLine(m: SetupMeasure): string {
  const verb = m.unwatched === 1 ? "has" : "have";
  return `Unwatched routes: ${m.unwatched} of ${m.entries} ${m.entries === 1 ? "way" : "ways"} in ${verb} a route to the ${m.noun} that no camera or guard ever sees.`;
}

/**
 * With no unwatched route, the attempts that got out crossed watched ground:
 * "Every route to the files crosses ground a camera or guard watches at some
 * point, so the 17 attempts that got out did it by timing, or were seen and
 * not caught." Null when none got out or a route is unwatched.
 */
export function timingLine(m: SetupMeasure, escaped: number): string | null {
  if (escaped <= 0 || m.unwatched > 0 || m.entries === 0) return null;
  const who = escaped === 1 ? "the one attempt that got out did it by timing, or was" : `the ${escaped} attempts that got out did it by timing, or were`;
  return `Every route to the ${m.noun} crosses ground a camera or guard watches at some point, so ${who} seen and not caught.`;
}

/** "Coverage 43% → 50%, unwatched routes 0 → 0". */
export function measureChange(a: SetupMeasure, b: SetupMeasure): string {
  return `Coverage ${a.coverage}% → ${b.coverage}%, unwatched routes ${a.unwatched} → ${b.unwatched}`;
}
