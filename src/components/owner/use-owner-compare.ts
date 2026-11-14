// The Owner screen's compare (issue 31): two setups played on one answer from
// the crew, so both sides meet the same strategies on the same nights. The
// crew is asked by the building's id alone, as for a single batch; neither
// setup leaves the browser. A new call cancels the last.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FloorGraph, LevelManifest } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { askStrategies } from "./crew-batch";
import { compareOwnerSetups, type PairSide } from "./owner-batch";

export type OwnerPair =
  | { status: "idle" }
  | { status: "planning" }
  | { status: "done"; sides: [PairSide, PairSide]; recorded: boolean; reason?: string }
  | { status: "error"; message: string };

export function useOwnerCompare(manifest: LevelManifest, floor: FloorGraph) {
  const [pair, setPair] = useState<OwnerPair>({ status: "idle" });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const compare = useCallback(
    (a: OwnerSetup, b: OwnerSetup) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      setPair({ status: "planning" });
      askStrategies({ buildingId: manifest.buildingId }, { signal: controller.signal })
        .then((answer) => {
          if (controller.signal.aborted) return;
          const sides = compareOwnerSetups(manifest, floor, a, b, answer);
          setPair({ status: "done", sides, recorded: answer.recorded, ...(answer.reason && { reason: answer.reason }) });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setPair({ status: "error", message: error instanceof Error ? error.message : String(error) });
        });
    },
    [manifest, floor],
  );

  return { pair, compare };
}
