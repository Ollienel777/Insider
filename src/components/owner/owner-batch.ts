// The Owner screen's batch (issue 128): the crew's strategies played against
// the owner's setup, the Chief's one change, and the same batch again with it
// made. The setup and the floor stay in the browser: the crew is asked by the
// building's id alone, and the Chief reads the batch's `FixSummary` (zone and
// element ids, SPEC §4.5). It always plays the setup applied: the untouched
// starting point plays the generated level exactly, as the batch debrief
// plays it (issue 127).
"use client";

import type { BatchResult, BatchSummary, ChiefFix, FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { applyFix, BATCH_SEEDS, runBatch, summariseBatch, type BatchInput, type Rerun } from "@/engine";
import { chiefZones, type ChiefZones } from "@/components/run/chief-request";
import { placeLevel } from "@/level/placer";
import { toEngineFix } from "./chief-fix";
import type { StrategiesAnswer } from "./crew-batch";
import { validateOwnerSetup } from "@/level/owner-setup";
import { levelForSetup, setupWithFix } from "./owner-edit";

/** The batch's input on this setup; throws when the setup cannot be played (the editor blocks that first). */
export function ownerBatchInput(
  manifest: LevelManifest,
  floor: FloorGraph,
  setup: OwnerSetup,
  strategies: BatchInput["strategies"],
  seeds: readonly number[] = BATCH_SEEDS,
): BatchInput {
  return {
    buildingId: manifest.buildingId,
    strategies,
    seeds,
    levelFor: (seed) => {
      const level = levelForSetup(manifest, floor, setup, seed);
      if (!level) throw new Error(`the setup "${setup.name}" does not fit this floor`);
      return level;
    },
  };
}

/** Plays the crew's strategies on the setup; the server's drops come first, then the board's. */
export function playOwnerBatch(
  manifest: LevelManifest,
  floor: FloorGraph,
  setup: OwnerSetup,
  answer: Pick<StrategiesAnswer, "strategies" | "dropped">,
  seeds: readonly number[] = BATCH_SEEDS,
): BatchResult {
  const result = runBatch(ownerBatchInput(manifest, floor, setup, answer.strategies, seeds));
  return { ...result, dropped: [...answer.dropped, ...result.dropped] };
}

/** One side of a compare: the setup, its batch, and the batch summed up. */
export interface PairSide {
  setup: OwnerSetup;
  result: BatchResult;
  summary: BatchSummary;
}

/**
 * Two setups played on the same strategies and the same nights (issue 31), so
 * the counts differ by the setups alone. Throws when either setup cannot be
 * played.
 */
export function compareOwnerSetups(
  manifest: LevelManifest,
  floor: FloorGraph,
  a: OwnerSetup,
  b: OwnerSetup,
  answer: Pick<StrategiesAnswer, "strategies" | "dropped">,
  seeds: readonly number[] = BATCH_SEEDS,
): [PairSide, PairSide] {
  const side = (setup: OwnerSetup): PairSide => {
    const result = playOwnerBatch(manifest, floor, setup, answer, seeds);
    return { setup, result, summary: summariseBatch(result) };
  };
  return [side(a), side(b)];
}

/** The zones as the Chief names them: the placer's, which a setup never changes. */
export function ownerZones(manifest: LevelManifest, floor: FloorGraph, seed: number = BATCH_SEEDS[0]): ChiefZones {
  return chiefZones(placeLevel(manifest, floor, seed));
}

/** The rerun, with the setup its After batch played: null when the change didn't fit. */
export type OwnerRerun = Rerun & { fixed: OwnerSetup | null };

/** The name the fixed setup is saved under. */
export const fixedName = (setup: OwnerSetup) => `${setup.name}, after the fix`.slice(0, 80);

/** The name when the change let no fewer out: it is the Chief's change, but not a fix. */
export const changedName = (setup: OwnerSetup) => `${setup.name}, with the Chief's change`.slice(0, 80);

/**
 * The batch again on its strategies and seeds, on the setup with the Chief's
 * change (in its own ids) made in the owner's terms (`setupWithFix`). The
 * After batch plays that setup itself, so the setup "Save the fixed setup"
 * stores is exactly the one whose count the screen shows: replayed over the
 * same nights, it gets the same After count. The engine's `applyFix` still
 * judges whether the change fits this setup; one that doesn't, or a fixed
 * setup that no longer fits the floor, is dropped and After replays Before.
 */
export function rerunOwner(
  manifest: LevelManifest,
  floor: FloorGraph,
  setup: OwnerSetup,
  before: BatchResult,
  fix: ChiefFix,
  name?: string,
): OwnerRerun {
  const engineFix = toEngineFix(fix, ownerZones(manifest, floor, before.seeds[0]));
  const summary = summariseBatch(before);
  const drop = (reason: string): OwnerRerun => ({
    fix: engineFix,
    dropped: reason,
    before: summary,
    after: summary,
    beforeResult: before,
    afterResult: before,
    fixed: null,
  });
  const first = before.seeds.length > 0 ? levelForSetup(manifest, floor, setup, before.seeds[0]) : null;
  if (!first) return drop(`the setup "${setup.name}" does not fit this floor`);
  const fits = applyFix(first, engineFix.change);
  if (!fits.ok) return drop(fits.reason);
  const changed = setupWithFix(setup, engineFix, first, name ?? fixedName(setup));
  const problems = validateOwnerSetup(changed, floor);
  if (problems.length > 0) return drop(problems[0].reason);
  const afterResult = runBatch(ownerBatchInput(manifest, floor, changed, before.strategies, before.seeds));
  const after = summariseBatch(afterResult);
  // A change that let no fewer out is not called a fix (the name plays no part in the batch).
  const fixed = name === undefined && after.escaped >= summary.escaped ? { ...changed, name: changedName(setup) } : changed;
  return { fix: engineFix, dropped: null, before: summary, after, beforeResult: before, afterResult, fixed };
}
