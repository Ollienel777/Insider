// A hook for Owner Mode's "Run 50 attempts" (issue 126): fetches the crew's
// strategies and plays the batch in the browser. The button and the batch
// view that call it land in issue 127.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchResult, FloorGraph, LevelManifest } from "@/domain";
import { askStrategies, playBatch } from "./crew-batch";

export type CrewBatch =
  | { status: "idle" }
  | { status: "planning" }
  | { status: "done"; result: BatchResult; recorded: boolean; ms: number }
  | { status: "error"; message: string };

/** `run()` asks the crew and plays every strategy across the seeds; a new call cancels the last. */
export function useCrewBatch(
  manifest: LevelManifest | null,
  floor: FloorGraph | null,
  setupId?: string,
): { batch: CrewBatch; run: () => void } {
  const [batch, setBatch] = useState<CrewBatch>({ status: "idle" });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const run = useCallback(() => {
    if (!manifest || !floor) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBatch({ status: "planning" });
    askStrategies({ buildingId: manifest.buildingId, setupId }, { signal: controller.signal })
      .then((answer) => {
        if (controller.signal.aborted) return;
        const started = performance.now();
        const result = playBatch(manifest, floor, answer);
        setBatch({ status: "done", result, recorded: answer.recorded, ms: Math.round(performance.now() - started) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setBatch({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
  }, [manifest, floor, setupId]);

  return { batch, run };
}
