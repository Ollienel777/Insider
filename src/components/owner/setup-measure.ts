// A setup measured from the floor plan alone (issue 120): how much of the
// floor the cameras and guards watch over a night, and how many moments in
// those nights still let a crew in and out unseen by guards and cameras (`openWindows`). No crew, no batch and no model:
// the guards walk their rounds and the cameras sweep with no player present,
// and what each sees is the engine's own answer (`visibleFrom`, `watched`,
// `moveGuards`), the same the run board's cones draw and the same that catches
// the player. The nights are the ones the batch plays (issue 132): the setup
// applied on each of its seeds, then varied as the batch varies it, so a
// generated guard walks that night's round from that night's start. Coverage
// takes the owner's worst night, counting what every night watches; open
// windows are counted on each night and added up. Pure and deterministic, so it can run on every edit.
import { AUTOPLAY_MAX_TURNS, BATCH_SEEDS, createRun, moveGuards, varyLevel } from "@/engine";
import { visibleFrom, watched } from "@/engine/vision";
import type { Level } from "@/engine";
import type { FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { applyOwnerSetup } from "@/level/owner-setup";
import { objectiveNoun } from "@/lib/objective-noun";
import { cycleLength } from "./night";
import { NOT_MEASURED, openWindows, searchStates, STATE_BUDGET, type OpenWindows } from "./open-windows";

export { CYCLE_CAP, cycleLength } from "./night";

export interface SetupMeasure {
  /** Positions on the floor (nodes). */
  positions: number;
  /** Positions some camera or guard watches at some point in every night the batch plays. */
  watched: number;
  /** Watched as a share of the floor, 0–100, a whole percent: never 100 with a position unwatched, nor 0 with one watched. */
  coverage: number;
  /** Ways in (entries) on this floor. */
  entries: number;
  /** The moments a crew could get in and out unseen by guards and cameras and unheard (`openWindows`), added up over the nights the batch plays; not measured when any night is over its share of `STATE_BUDGET`. */
  windows: OpenWindows;
  /** The nights with at least one open window. */
  openNights: number;
  /** The nights the batch plays. */
  nights: number;
  /** What the objective is, for the lines: "files". */
  noun: string;
  /** The turns stepped through on the longest night: its cycle, but no longer than an attempt. */
  cycle: number;
  /** The night (1 = the first the batch plays) of the first open window; null when none is open. */
  firstNight: number | null;
  /** The first open window's route as the rooms it passes, for the line on screen; null when none is open. */
  firstRooms: string[] | null;
}

/** One night as the measure reads it: the level the batch plays, and the ways in. */
export interface MeasureNight {
  level: Level;
  entries: readonly { nodeId: string }[];
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

/** `part` of `whole` as a whole percent, kept off 0 and 100 unless it is exactly that. */
function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  const p = Math.round((100 * part) / whole);
  return part > 0 && p === 0 ? 1 : part < whole && p === 100 ? 99 : p;
}

/**
 * Coverage and open windows over a set of nights. Coverage is read as the
 * owner's worst case so that its line holds on every night: it counts only the
 * positions watched at some point in every night. Open windows are counted on
 * each night, with that night's guards and cameras, and added up; each night
 * gets an equal share of `STATE_BUDGET`, and if any night is over its share
 * none is searched, so the editor never waits on a floor too large to measure.
 */
export function measureNights(nights: readonly MeasureNight[]): SetupMeasure {
  if (nights.length === 0) throw new Error("measureNights needs at least one night");
  const watches = nights.map((n) => watchedPositions(n.level));
  const every = new Set([...watches[0].nodes].filter((id) => watches.every((w) => w.nodes.has(id))));
  const { level } = nights[0];
  const positions = level.floor.nodes.length;
  const watchedCount = level.floor.nodes.filter((n) => every.has(n.id)).length;
  const ways = [...new Set(nights.flatMap((n) => n.entries.map((e) => e.nodeId)))];
  const budget = STATE_BUDGET / nights.length;
  const fits = nights.every((n) => searchStates(n.level) <= budget);
  const perNight = fits ? nights.map((n) => openWindows(n.level, n.entries.map((e) => e.nodeId), AUTOPLAY_MAX_TURNS, budget)) : [];
  const open = perNight.reduce((sum, w) => sum + w.open, 0);
  const moments = perNight.reduce((sum, w) => sum + w.moments, 0);
  const at = perNight.findIndex((w) => w.first);
  const first = at < 0 ? null : perNight[at].first;
  const roomOf = (id: string) => {
    const node = level.floor.nodes.find((n) => n.id === id);
    return level.floor.rooms.find((r) => r.id === node?.roomId)?.label ?? id;
  };
  return {
    positions,
    watched: watchedCount,
    coverage: percent(watchedCount, positions),
    entries: ways.length,
    windows: fits ? { measured: true, open, moments, share: moments === 0 ? 0 : Math.round((100 * open) / moments), first } : NOT_MEASURED,
    openNights: perNight.filter((w) => w.open > 0).length,
    nights: nights.length,
    noun: objectiveNoun(level.missionId),
    cycle: Math.max(...watches.map((w) => w.cycle)),
    firstNight: at < 0 ? null : at + 1,
    firstRooms: first ? first.route.map(roomOf).filter((l, i, all) => i === 0 || l !== all[i - 1]) : null,
  };
}

/** Coverage and open windows for a setup, over the nights its batch plays. Null when the setup has a problem. */
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
 * "Open windows: 7 of 80 moments in the 10 nights the crew plays let a crew in
 * and out unseen by guards and cameras. A moment is a way in at any turn of a night; the attempts all
 * start at turn 0." The second sentence keeps the count from being read
 * against the attempts': it counts every turn a crew could step in on, and the
 * batch's attempts all step in at turn 0 (issue 144 review). "Open windows:
 * not measured on a floor this size." when the nights were over `STATE_BUDGET`.
 */
export function windowsLine(m: SetupMeasure): string {
  if (m.entries === 0) return "Open windows: this floor has no way in to measure.";
  if (!m.windows.measured) return "Open windows: not measured on a floor this size.";
  const { open, moments } = m.windows;
  return `Open windows: ${open} of ${moments} moments in ${nightsPhrase(m)} ${open === 1 ? "lets" : "let"} a crew in and out unseen by guards and cameras. A moment is a way in at any turn of a night; the attempts all start at turn 0.`;
}

/**
 * Which way and when, and whether an attempt could use it: "The first opens on
 * night 1, turn 0, when the attempts start: Freight Lift Lobby → Dock Corridor
 * → Records Room → Dock Corridor → Freight Lift Lobby." or "… turn 1, a turn no
 * attempt starts on: …". Null when none is open.
 */
export function firstWindowLine(m: SetupMeasure): string | null {
  if (!m.windows.first || !m.firstRooms) return null;
  const { turn } = m.windows.first;
  const when = m.nights === 1 ? `turn ${turn}` : `night ${m.firstNight}, turn ${turn}`;
  const use = turn === 0 ? "when the attempts start" : "a turn no attempt starts on";
  return `The first opens on ${when}, ${use}: ${m.firstRooms.join(" → ")}.`;
}

/**
 * With no open window on any night, the attempts that got out were seen or
 * heard on the way: "No moment in the 10 nights the crew plays lets a crew in
 * and out unseen by guards and cameras, so the 17 attempts that got out were seen or heard and not
 * caught." Null when none got out, any window is open, or the windows were not
 * measured.
 */
export function timingLine(m: SetupMeasure, escaped: number): string | null {
  if (escaped <= 0 || !m.windows.measured || m.windows.open > 0 || m.entries === 0) return null;
  const who = escaped === 1 ? "the one attempt that got out was" : `the ${escaped} attempts that got out were`;
  return `No moment in ${nightsPhrase(m)} lets a crew in and out unseen by guards and cameras, so ${who} seen or heard and not caught.`;
}

/** "40 of 80", or "not measured". */
const windowsOf = (m: SetupMeasure) => (m.windows.measured ? `${m.windows.open} of ${m.windows.moments}` : "not measured");

/**
 * "Coverage 43% → 50%, open windows 40 of 80 → 20 of 80". Each side keeps its
 * own total, so a change in the number of moments (a slower guard makes a
 * longer night) never reads as a change in how open the floor is.
 */
export function measureChange(a: SetupMeasure, b: SetupMeasure): string {
  return `Coverage ${a.coverage}% → ${b.coverage}%, open windows ${windowsOf(a)} → ${windowsOf(b)}`;
}
