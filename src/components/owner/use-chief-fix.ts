// A hook for the batch debrief's "Suggest a fix" (issue 127): sums the batch,
// asks the Chief for one change, applies it and plays the batch again in the
// browser. The debrief screen that calls it, and issue 128's compare, render
// `before` and `after`.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BatchResult, BatchSummary, FloorGraph, LevelManifest } from "@/domain";
import { summariseBatch } from "@/engine";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import { askFix, fixSummaryOf, playFix, type FixAnswer, type Rerun } from "./chief-fix";

export type ChiefFixState =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "done"; answer: FixAnswer; rerun: Rerun; ms: number }
  | { status: "error"; message: string };

/**
 * `summary` is the batch summed (null before a batch); `suggest()` asks and reruns, a new call cancelling the last.
 * Pass `placedFor` when the batch was played on a setup other than the generated one (an owner's): the
 * summary and the rerun then read that setup. Keep it stable (memoised), or every render makes a new `suggest`.
 */
export function useChiefFix(
  manifest: LevelManifest | null,
  floor: FloorGraph | null,
  batch: BatchResult | null,
  placedFor?: (seed: number) => PlacedLevel,
): { summary: BatchSummary | null; fix: ChiefFixState; suggest: () => void } {
  // Kept with the batch it answers, so a new batch reads as idle at once.
  const [held, setHeld] = useState<{ batch: BatchResult | null; state: ChiefFixState }>({ batch: null, state: { status: "idle" } });
  const fix: ChiefFixState = held.batch === batch ? held.state : { status: "idle" };
  const pending = useRef<AbortController | null>(null);
  const summary = useMemo(() => (batch ? summariseBatch(batch) : null), [batch]);

  // A new batch makes the last fix stale, and so does leaving: stop asking for it.
  useEffect(() => () => pending.current?.abort(), [batch]);

  const suggest = useCallback(() => {
    if (!manifest || !floor || !batch || !summary || batch.seeds.length === 0) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const setFix = (state: ChiefFixState) => setHeld({ batch, state });
    setFix({ status: "asking" });
    Promise.resolve()
      .then(() => {
        const placed = placedFor ? placedFor(batch.seeds[0]) : placeLevel(manifest, floor, batch.seeds[0]);
        return askFix({ buildingId: manifest.buildingId, summary: fixSummaryOf(summary, placed) }, { signal: controller.signal });
      })
      .then((answer) => {
        if (controller.signal.aborted) return;
        const started = performance.now();
        const rerun = playFix(manifest, floor, batch, answer.fix, placedFor);
        setFix({ status: "done", answer, rerun, ms: Math.round(performance.now() - started) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFix({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
  }, [manifest, floor, batch, summary, placedFor]);

  return { summary, fix, suggest };
}
