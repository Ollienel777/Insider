// The browser's side of Owner Mode's batch (issue 126): ask the crew for its
// strategies (POST /api/crew/strategies, body `{buildingId, setupId?}` and
// nothing else, SPEC §4.5), then play each across the seeds on the board
// here, where the floor stays. The batch view (issue 127) renders the result.
"use client";

import type { StrategiesAnswer } from "@/agents/crew/strategies";
import { BatchResult, DroppedStrategy, Strategy, type FloorGraph, type LevelManifest } from "@/domain";
import { BATCH_SEEDS, runBatch } from "@/engine";
import { noteResponse } from "@/lib/demo-status";
import { placeLevel } from "@/level/placer";

export type { StrategiesAnswer };

/** The crew chip's note when the rule-based strategies stood in (issue 205). */
export const RULE_BASED_CREW = "Rule-based strategies from the level's ways in: the model didn't answer in time.";

export interface StrategiesRequest {
  buildingId: string;
  setupId?: string;
}

/** Asks the crew for its strategies; throws with the server's message on a failure. */
export async function askStrategies(
  request: StrategiesRequest,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<StrategiesAnswer> {
  const doFetch = options.fetch ?? fetch;
  const body: StrategiesRequest = { buildingId: request.buildingId, ...(request.setupId && { setupId: request.setupId }) };
  const response = await doFetch("/api/crew/strategies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const answer = (await response.json().catch(() => null)) as (Partial<StrategiesAnswer> & { error?: string }) | null;
  if (!response.ok || !answer) throw new Error(answer?.error ?? `the crew didn't plan (HTTP ${response.status})`);
  noteResponse(answer);
  return {
    strategies: Strategy.array().parse(answer.strategies),
    dropped: DroppedStrategy.array().parse(answer.dropped ?? []),
    recorded: answer.recorded === true,
    ...(answer.reason && { reason: answer.reason }),
    ...(answer.derived === true && { derived: true }),
  };
}

/**
 * Plays the strategies on the floor, each across `seeds` (the level placed
 * afresh per seed). The server's drops come first in `dropped`, then the
 * board's (an entry or zone the manifest has but this floor could not place).
 */
export function playBatch(
  manifest: LevelManifest,
  floor: FloorGraph,
  answer: Pick<StrategiesAnswer, "strategies" | "dropped">,
  seeds: readonly number[] = BATCH_SEEDS,
): BatchResult {
  const result = runBatch({
    buildingId: manifest.buildingId,
    strategies: answer.strategies,
    seeds,
    levelFor: (seed) => placeLevel(manifest, floor, seed).level,
  });
  return { ...result, dropped: [...answer.dropped, ...result.dropped] };
}
