// A setup measured from the floor plan alone (issue 120): how much of the
// floor the cameras and guards watch over a night, and how many ways in still
// reach the objective unseen. No crew, no batch and no model: the guards walk
// their rounds and the cameras sweep with no player present, and what each
// sees is the engine's own answer (`visibleFrom`, `watched`, `moveGuards`), the
// same the run board's cones draw and the same that catches the player.
// Pure and deterministic, so it can run on every edit.
import { createRun, moveGuards } from "@/engine";
import { visibleFrom, watched } from "@/engine/vision";
import type { Board, Level } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { objectiveNoun } from "@/lib/objective-noun";
import { cycleLength } from "./night";
import { openWindows, type OpenWindows } from "./open-windows";

export { CYCLE_CAP, cycleLength } from "./night";

export interface SetupMeasure {
  /** Positions on the floor (nodes). */
  positions: number;
  /** Positions some camera or guard watches at some point in the night. */
  watched: number;
  /** Watched as a share of the floor, 0–100, rounded to a whole percent. */
  coverage: number;
  /** Ways in (entries) on this floor. */
  entries: number;
  /** Ways in with a route to the objective that touches no watched position. */
  unwatched: number;
  /** What the objective is, for the lines: "files". */
  noun: string;
  /** The turns stepped through: the night's length, capped at `CYCLE_CAP`. */
  cycle: number;
  /** The moments a crew could get in and out unseen and unheard (`openWindows`): the timing coverage cannot see. */
  windows: OpenWindows;
}

/**
 * Every position a camera or guard watches at some point over one night with
 * nobody on the floor. Night cleaners are left out: their sighting never
 * catches the crew. A guard counts where it stands each turn, which also
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

/** Coverage and unwatched routes for a placed level (the generated security, or an owner's setup applied). */
export function measureSetup(placed: { level: Level; entries: PlacedLevel["entries"] | readonly { nodeId: string }[] }): SetupMeasure {
  const { level } = placed;
  const { nodes: seen, cycle } = watchedPositions(level);
  const run = createRun(level);
  const positions = level.floor.nodes.length;
  const watchedCount = level.floor.nodes.filter((n) => seen.has(n.id)).length;
  const ways = [...new Set(placed.entries.map((e) => e.nodeId))];
  const unwatched = ways.filter((id) => reachesUnseen(run.board, id, level.objective, seen)).length;
  return {
    positions,
    watched: watchedCount,
    coverage: positions === 0 ? 0 : Math.round((100 * watchedCount) / positions),
    entries: ways.length,
    unwatched,
    noun: objectiveNoun(level.missionId),
    cycle,
    windows: openWindows(level, ways),
  };
}

/** "Coverage: 62% of the floor is watched at some point in a night." */
export function coverageLine(m: SetupMeasure): string {
  return `Coverage: ${m.coverage}% of the floor is watched at some point in a night.`;
}

/** "Unwatched routes: 2 of 3 ways in reach the files unseen." */
export function routesLine(m: SetupMeasure): string {
  const verb = m.unwatched === 1 ? "reaches" : "reach";
  return `Unwatched routes: ${m.unwatched} of ${m.entries} ${m.entries === 1 ? "way" : "ways"} in ${verb} the ${m.noun} unseen.`;
}

/** "Open windows: 9 of 120 moments in the night let a crew in and out unseen." */
export function windowsLine(m: SetupMeasure): string {
  const { open, moments } = m.windows;
  return `Open windows: ${open} of ${moments} moments in the night ${open === 1 ? "lets" : "let"} a crew in and out unseen.`;
}

/** Which way and when, for the first open window: "First: in at turn 3 by lobby-w, out by lobby-w, 14 positions." Null when none is open. */
export function firstWindowLine(m: SetupMeasure, nameOf: (nodeId: string) => string = (id) => id): string | null {
  const first = m.windows.first;
  if (!first) return null;
  const out = first.route[first.route.length - 1];
  return `First: in at turn ${first.turn} by ${nameOf(first.entry)}, out by ${nameOf(out)}, through ${first.route.length} positions.`;
}

/** "62% → 81%, unwatched routes 2 → 0, open windows 9 → 1". */
export function measureChange(a: SetupMeasure, b: SetupMeasure): string {
  return `Coverage ${a.coverage}% → ${b.coverage}%, unwatched routes ${a.unwatched} → ${b.unwatched}, open windows ${a.windows.open} → ${b.windows.open}`;
}
