// A setup measured from the floor plan alone (issue 120): how much of the
// floor the cameras and guards watch over a night, and how many moments in
// that night still let a crew in and out unseen (`openWindows`). No crew, no batch and no model: the guards walk
// their rounds and the cameras sweep with no player present, and what each
// sees is the engine's own answer (`visibleFrom`, `watched`, `moveGuards`), the
// same the run board's cones draw and the same that catches the player.
// Pure and deterministic, so it can run on every edit.
import { createRun, moveGuards } from "@/engine";
import { visibleFrom, watched } from "@/engine/vision";
import type { Level } from "@/engine";
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
  /** What the objective is, for the lines: "files". */
  noun: string;
  /** The turns stepped through: the night's length, capped at `CYCLE_CAP`. */
  cycle: number;
  /** The moments a crew could get in and out unseen and unheard (`openWindows`): the timing coverage cannot see. */
  windows: OpenWindows;
  /** The first open window's route as the rooms it passes, for the line on screen; null when none is open. */
  firstRooms: string[] | null;
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

/** Coverage and open windows for a placed level (the generated security, or an owner's setup applied). */
export function measureSetup(placed: { level: Level; entries: PlacedLevel["entries"] | readonly { nodeId: string }[] }): SetupMeasure {
  const { level } = placed;
  const { nodes: seen, cycle } = watchedPositions(level);
  const positions = level.floor.nodes.length;
  const watchedCount = level.floor.nodes.filter((n) => seen.has(n.id)).length;
  const ways = [...new Set(placed.entries.map((e) => e.nodeId))];
  const windows = openWindows(level, ways);
  const roomOf = (id: string) => {
    const node = level.floor.nodes.find((n) => n.id === id);
    return level.floor.rooms.find((r) => r.id === node?.roomId)?.label ?? id;
  };
  const firstRooms = windows.first ? windows.first.route.map(roomOf).filter((l, i, all) => i === 0 || l !== all[i - 1]) : null;
  return {
    positions,
    watched: watchedCount,
    coverage: positions === 0 ? 0 : Math.round((100 * watchedCount) / positions),
    entries: ways.length,
    noun: objectiveNoun(level.missionId),
    cycle,
    windows,
    firstRooms,
  };
}

/** "Coverage: 62% of the floor is watched at some point in a night." */
export function coverageLine(m: SetupMeasure): string {
  return `Coverage: ${m.coverage}% of the floor is watched at some point in a night.`;
}

/** "Open windows: 9 of 120 moments in the night let a crew in and out unseen." */
export function windowsLine(m: SetupMeasure): string {
  const { open, moments } = m.windows;
  return `Open windows: ${open} of ${moments} moments in the night ${open === 1 ? "lets" : "let"} a crew in and out unseen.`;
}

/** Which way and when: "The first opens on turn 0: Freight lift → Lobby → Records room → Lobby → Freight lift." Null when none is open. */
export function firstWindowLine(m: SetupMeasure): string | null {
  if (!m.windows.first || !m.firstRooms) return null;
  return `The first opens on turn ${m.windows.first.turn}: ${m.firstRooms.join(" → ")}.`;
}

/** "Coverage 62% → 81%, open windows 9 → 1". */
export function measureChange(a: SetupMeasure, b: SetupMeasure): string {
  return `Coverage ${a.coverage}% → ${b.coverage}%, open windows ${a.windows.open} → ${b.windows.open}`;
}
