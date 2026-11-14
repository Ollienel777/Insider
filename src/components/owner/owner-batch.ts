// The Owner screen's batch (issue 128): the crew's strategies played against
// the owner's setup, the Chief's one change, and the same batch again with it
// made. The setup and the floor stay in the browser: the crew is asked by the
// building's id alone, and the Chief reads the batch's `FixSummary` (zone and
// element ids, SPEC §4.5). It always plays the setup applied: the untouched
// starting point plays the generated level exactly, as the batch debrief
// plays it (issue 127).
"use client";

import type { BatchResult, ChiefFix, FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { BATCH_SEEDS, rerunWithFix, runBatch, type BatchInput, type Rerun } from "@/engine";
import { chiefZones, type ChiefZones } from "@/components/run/chief-request";
import { placeLevel } from "@/level/placer";
import { toEngineFix } from "./chief-fix";
import type { StrategiesAnswer } from "./crew-batch";
import { levelForSetup } from "./owner-edit";

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

/** The zones as the Chief names them: the placer's, which a setup never changes. */
export function ownerZones(manifest: LevelManifest, floor: FloorGraph, seed: number = BATCH_SEEDS[0]): ChiefZones {
  return chiefZones(placeLevel(manifest, floor, seed));
}

/** The batch again on its strategies and seeds with the Chief's change (in its own ids) made to every seed's level. */
export function rerunOwner(
  manifest: LevelManifest,
  floor: FloorGraph,
  setup: OwnerSetup,
  before: BatchResult,
  fix: ChiefFix,
): Rerun {
  const input = ownerBatchInput(manifest, floor, setup, before.strategies, before.seeds);
  return rerunWithFix(input, toEngineFix(fix, ownerZones(manifest, floor, before.seeds[0])), before);
}
