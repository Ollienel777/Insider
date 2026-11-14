// The browser's side of the batch debrief's fix (issue 127). The batch and the
// floor stay here: the Chief gets a `FixSummary` of counts, zone ids and
// element ids (POST /api/chief/fix, body `{buildingId, summary}`, SPEC §4.5),
// and its change comes back in those ids, is mapped to the engine's, applied
// to every seed's level and played again, so the debrief can show the count
// before and after.
"use client";

import type { FixAnswer } from "@/agents/chief/fix";
import {
  ChiefFix,
  FixRequest,
  type BatchResult,
  type BatchSummary,
  type FixChange,
  type FixSummary,
  type FloorGraph,
  type LevelManifest,
} from "@/domain";
import { compileBoard, rerunWithFix, zoneOf, type Rerun } from "@/engine";
import { chiefZones, type ChiefZones } from "@/components/run/chief-request";
import { noteResponse } from "@/lib/demo-status";
import { placeLevel, type PlacedLevel } from "@/level/placer";

export type { FixAnswer, Rerun };

const MAX_ROUTE = 24;
const MAX_DETECTORS = 8;
const MAX_TURNS = 24;
const MAX_STRATEGIES = 8;
const MAX_ZONES = 64;

/** The summary as the Chief reads it: the route by zone, the zones by id and name, nothing of the floor. */
export function fixSummaryOf(summary: BatchSummary, placed: PlacedLevel, zones: ChiefZones = chiefZones(placed)): FixSummary {
  const board = compileBoard(placed.level);
  const chiefId = (nodeId: string) => {
    const engineId = zoneOf(board, nodeId).zoneId;
    return zones.toChief.get(engineId) ?? null;
  };
  const route = summary.topRoute
    ? summary.topRoute.nodes
        .map(chiefId)
        .filter((id): id is string => id !== null)
        .filter((id, i, all) => i === 0 || id !== all[i - 1])
        .slice(0, MAX_ROUTE)
    : [];
  const onRoute = new Set(route);
  const offered =
    zones.zones.length <= MAX_ZONES
      ? zones.zones
      : [...zones.zones.filter((z) => onRoute.has(z.id)), ...zones.zones.filter((z) => !onRoute.has(z.id))].slice(0, MAX_ZONES);
  return FixRequest.shape.summary.parse({
    total: summary.total,
    escaped: summary.escaped,
    byStrategy: summary.byStrategy.slice(0, MAX_STRATEGIES),
    topRoute: summary.topRoute && route.length > 0 ? { zones: route, count: summary.topRoute.count } : null,
    detectors: summary.detectors.slice(0, MAX_DETECTORS).map((d) => ({
      kind: d.kind,
      ...(d.id && { id: d.id.slice(0, 64) }),
      count: d.count,
      turns: d.turns.slice(0, MAX_TURNS),
    })),
    zones: offered,
  });
}

/** Asks the Chief for its fix; throws with the server's message on a failure. */
export async function askFix(
  request: FixRequest,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<FixAnswer> {
  const doFetch = options.fetch ?? fetch;
  const body: FixRequest = FixRequest.parse({ buildingId: request.buildingId, summary: request.summary });
  const response = await doFetch("/api/chief/fix", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const answer = (await response.json().catch(() => null)) as (Partial<FixAnswer> & { error?: string }) | null;
  if (!response.ok || !answer) throw new Error(answer?.error ?? `the Chief didn't suggest a fix (HTTP ${response.status})`);
  noteResponse(answer);
  const source = answer.source === "model" || answer.source === "template" ? answer.source : "recorded";
  return {
    fix: ChiefFix.parse(answer.fix),
    // The server's own flag: a model that answered with a change that didn't fit is not recorded.
    recorded: typeof answer.recorded === "boolean" ? answer.recorded : source !== "model",
    source,
    ...(answer.reason && { reason: answer.reason }),
    ...(answer.dropped && { dropped: answer.dropped }),
  };
}

/** The change in the engine's zone ids. An id the Chief made up stays as it is, and `applyFix` refuses it. */
export function toEngineFix(fix: ChiefFix, zones: ChiefZones): ChiefFix {
  const engineId = (id: string) => zones.toEngine.get(id) ?? id;
  const change: FixChange =
    fix.change.kind === "lock-door"
      ? { ...fix.change, elementId: engineId(fix.change.elementId) }
      : fix.change.to !== undefined
        ? { ...fix.change, to: engineId(fix.change.to) }
        : fix.change;
  return { ...fix, change };
}

/**
 * Plays the batch's strategies on its seeds again with the change made to
 * each seed's level (placed afresh, as `playBatch` does), and sums both.
 */
export function playFix(manifest: LevelManifest, floor: FloorGraph, before: BatchResult, fix: ChiefFix): Rerun {
  const zones = chiefZones(placeLevel(manifest, floor, before.seeds[0]));
  return rerunWithFix(
    {
      buildingId: manifest.buildingId,
      strategies: before.strategies,
      seeds: before.seeds,
      levelFor: (seed) => placeLevel(manifest, floor, seed).level,
    },
    toEngineFix(fix, zones),
    before,
  );
}
