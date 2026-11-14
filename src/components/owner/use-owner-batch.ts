// The Owner screen's three steps as one hook (issue 128): run the crew's 50
// attempts against the setup, ask the Chief for one change, and apply it and
// run the batch again. Each answer is kept with the setup it was played on
// (`key`), so an edit makes the results read as stale at once. A new call
// cancels the last. The crew's strategies are asked once per building and
// kept, so every Run plays the same set.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchResult, BatchSummary, FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { summariseBatch } from "@/engine";
import { placeLevel } from "@/level/placer";
import { askFix, fixSummaryOf, type FixAnswer } from "./chief-fix";
import { askStrategies, type StrategiesAnswer } from "./crew-batch";
import { playOwnerBatch, rerunOwner, type OwnerRerun } from "./owner-batch";

export type OwnerBatch =
  | { status: "idle" }
  | { status: "planning" }
  | {
      status: "done";
      key: string;
      /** The setup it was played on. */
      setup: OwnerSetup;
      result: BatchResult;
      summary: BatchSummary;
      recorded: boolean;
      reason?: string;
      ms: number;
    }
  | { status: "error"; message: string };

export type OwnerFix =
  | { status: "idle" }
  | { status: "asking" }
  | { status: "suggested"; answer: FixAnswer }
  | { status: "applied"; answer: FixAnswer; rerun: OwnerRerun; ms: number }
  | { status: "error"; message: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useOwnerBatch(manifest: LevelManifest | null, floor: FloorGraph | null) {
  const [batch, setBatch] = useState<OwnerBatch>({ status: "idle" });
  const [fix, setFix] = useState<OwnerFix>({ status: "idle" });
  const pending = useRef<AbortController | null>(null);
  // The crew's answer, kept per building: every Run after the first replays the same strategies, so an
  // edit changes the count only by what it changes, and the crew is asked once (live, one paid call).
  const crew = useRef<{ buildingId: string; answer: Promise<StrategiesAnswer> } | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const start = () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    return controller;
  };

  /** Plays the batch on `setup`; `key` names the setup as it stands. */
  const run = useCallback(
    (setup: OwnerSetup, key: string) => {
      if (!manifest || !floor) return;
      const controller = start();
      setBatch({ status: "planning" });
      setFix({ status: "idle" });
      const { buildingId } = manifest;
      let asked = crew.current?.buildingId === buildingId ? crew.current.answer : null;
      if (!asked) {
        // Not tied to this Run's signal: a Run cancelled by the next must not cancel the answer both share.
        const answer = askStrategies({ buildingId });
        asked = answer;
        crew.current = { buildingId, answer };
        // A failed ask is not kept: the next Run asks again.
        answer.catch(() => {
          if (crew.current?.answer === answer) crew.current = null;
        });
      }
      asked
        .then((answer) => {
          if (controller.signal.aborted) return;
          const started = performance.now();
          const result = playOwnerBatch(manifest, floor, setup, answer);
          setBatch({
            status: "done",
            key,
            setup,
            result,
            summary: summariseBatch(result),
            recorded: answer.recorded,
            ...(answer.reason && { reason: answer.reason }),
            ms: Math.round(performance.now() - started),
          });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setBatch({ status: "error", message: message(error) });
        });
    },
    [manifest, floor],
  );

  const suggest = useCallback(() => {
    if (!manifest || !floor || batch.status !== "done") return;
    const controller = start();
    setFix({ status: "asking" });
    Promise.resolve()
      .then(() => {
        const placed = placeLevel(manifest, floor, batch.result.seeds[0]);
        return askFix({ buildingId: manifest.buildingId, summary: fixSummaryOf(batch.summary, placed) }, { signal: controller.signal });
      })
      .then((answer) => {
        if (!controller.signal.aborted) setFix({ status: "suggested", answer });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFix({ status: "error", message: message(error) });
      });
  }, [manifest, floor, batch]);

  const apply = useCallback(() => {
    if (!manifest || !floor || batch.status !== "done" || fix.status !== "suggested") return;
    try {
      const started = performance.now();
      const rerun = rerunOwner(manifest, floor, batch.setup, batch.result, fix.answer.fix);
      setFix({ status: "applied", answer: fix.answer, rerun, ms: Math.round(performance.now() - started) });
    } catch (error) {
      setFix({ status: "error", message: message(error) });
    }
  }, [manifest, floor, batch, fix]);

  return { batch, fix, run, suggest, apply };
}
