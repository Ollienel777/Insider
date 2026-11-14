"use client";

import Link from "next/link";
import { FastForward, Printer, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getMatterport } from "@/adapters/matterport";
import { BuildingScreen } from "@/components/shell/building-screen";
import { LayerDot } from "@/components/shell/layer-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Building, FloorGraph } from "@/domain";
import { DRILL_FLOOR, drillFacts, simulateDrill, type DrillFloorChoice, type DrillReport } from "@/drill";
import { DrillBoard } from "./drill-board";
import { DrillPanel, type Phase } from "./drill-panel";
import { askNarrator, DrillNarrativePanel, type NarrativeLoad } from "./narrative";
import { planNumberedAs, playbackMs, speedFor } from "./playback";
import { useReducedMotion } from "./use-reduced-motion";

/** The drill's disclaimer (DESIGN.md, Data and copy voice), word for word. */
export const DRILL_DISCLAIMER =
  "A planning aid, not a life-safety calculation. Headcount is estimated from CoStar's occupied area.";

type Load =
  | { status: "loading" }
  | { status: "ready"; floor: FloorGraph; live: boolean }
  | { status: "no-floor" }
  | { status: "error"; message: string };

type Drill =
  | { ok: true; report: DrillReport; baseline: DrillReport }
  | { ok: false; message: string };

/** The drill and its every-stair-open baseline, or why the inputs cannot describe one. */
export function runDrill(building: Building, floor: FloorGraph, choice: DrillFloorChoice = DRILL_FLOOR): Drill {
  try {
    return {
      ok: true,
      report: simulateDrill(building, floor, { floor: choice }),
      baseline: simulateDrill(building, floor, { floor: choice, blockedStair: null }),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The Drill screen (SPEC §2 beat 7, DESIGN.md Drill): the same building and
 * board as the heist, run as an evacuation drill. The floor comes from the
 * Matterport adapter in the browser and the simulation runs here, so the
 * floor never leaves the browser (SPEC §4.5); only the report's figures and
 * room names go to the narrator, and not at all for a live scan.
 */
export function DrillScreen({ building, heistMode }: { building: Building; heistMode?: string }) {
  const [loaded, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const matterport = getMatterport(heistMode);
    const fail = (error: unknown) => {
      if (live) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
    };
    matterport.adapter
      .loadFloor(building)
      .then((floor) => {
        if (!live) return;
        setLoad(floor ? { status: "ready", floor, live: floor.source === "matterport" } : { status: "no-floor" });
      }, fail)
      .catch(fail);
    return () => {
      live = false;
    };
  }, [building, heistMode, attempt]);

  const floor = loaded.status === "ready" ? loaded.floor : null;
  const drill = useMemo(() => (floor ? runDrill(building, floor) : null), [building, floor]);
  const retry = () => {
    setLoad({ status: "loading" });
    setAttempt((a) => a + 1);
  };

  if (loaded.status === "ready" && drill?.ok) {
    return <DrillReady key={attempt} report={drill.report} baseline={drill.baseline} floor={loaded.floor} liveScan={loaded.live} />;
  }

  const message =
    loaded.status === "no-floor" ? (
      <BoardMessage
        testId="drill-empty"
        label="No floor yet"
        title="This building has no board to drill on yet."
        body="Only Halvorsen Tower has a floor plan so far. Pick it on the map to run its drill."
        action={
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            Back to the map
          </Link>
        }
      />
    ) : loaded.status === "error" || (drill && !drill.ok) ? (
      <BoardMessage
        testId="drill-error"
        label="The drill didn't run"
        title="The drill couldn't be set up."
        body={loaded.status === "error" ? loaded.message : drill && !drill.ok ? drill.message : ""}
        action={<Button onClick={retry}>Retry</Button>}
      />
    ) : (
      <Skeleton data-testid="drill-skeleton" className="absolute inset-x-6 inset-y-0 rounded-md bg-surface-1" />
    );

  return (
    <BuildingScreen
      visualLabel="Drill view"
      visual={
        <div className="absolute inset-0 flex flex-col">
          <div className="h-14 shrink-0" />
          <div className="relative min-h-0 flex-1">{message}</div>
          <Footer />
        </div>
      }
      panel={
        loaded.status === "loading" ? (
          <div className="flex flex-col gap-6" data-testid="drill-panel-skeleton">
            <Skeleton className="h-[92px]" />
            <Skeleton className="h-24" />
            <Skeleton className="h-32" />
            <Skeleton className="h-40" />
          </div>
        ) : null
      }
      action={<PrintAction />}
    />
  );
}

/** The drill once it has run: the playback, then the report. */
function DrillReady({
  report,
  baseline,
  floor,
  liveScan,
}: {
  report: DrillReport;
  baseline: DrillReport;
  floor: FloorGraph;
  liveScan: boolean;
}) {
  const reduced = useReducedMotion();
  const speed = speedFor(report.timeToClearS);
  const [take, setTake] = useState(0);
  const [simS, setSimS] = useState(0);
  const [skipped, setSkipped] = useState(-1);
  const phase: Phase = reduced || skipped === take || simS >= report.timeToClearS ? "done" : "playing";
  const shownS = phase === "done" ? report.timeToClearS : simS;

  useEffect(() => {
    if (reduced || skipped === take) return;
    const total = playbackMs(report.timeToClearS, speed);
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(total, now - started);
      setSimS(total === 0 ? report.timeToClearS : (elapsed / total) * report.timeToClearS);
      if (elapsed < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [report, speed, reduced, take, skipped]);

  const facts = useMemo(() => drillFacts(report, baseline, floor), [report, baseline, floor]);
  const [narrative, setNarrative] = useState<NarrativeLoad>({ status: "loading" });
  const [ask, setAsk] = useState(0);
  useEffect(() => {
    if (liveScan) return;
    let live = true;
    askNarrator(facts).then((result) => {
      if (live) setNarrative(result);
    });
    return () => {
      live = false;
    };
  }, [facts, liveScan, ask]);

  const replay = useCallback(() => {
    setSimS(0);
    setTake((t) => t + 1);
  }, []);
  const numberedAs = planNumberedAs(
    floor.rooms.map((r) => r.label),
    report.headcount.floor,
  );

  return (
    <BuildingScreen
      visualLabel="Drill view"
      visual={
        <div className="absolute inset-0 flex flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 px-6">
            <span className="flex shrink-0 items-center gap-2 whitespace-nowrap label-caps text-text-2">
              <LayerDot layer="matterport" decorative />
              Matterport
              <span className="max-md:hidden">{liveScan ? " · floor plan from the scan" : " · floor plan from fixtures"}</span>
            </span>
            <span aria-hidden className="h-4 w-px bg-border" />
            <span className="truncate text-sm text-text-1 max-md:hidden">
              Evacuation drill, floor {report.headcount.floor}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <span data-testid="drill-speed" className="font-mono text-xs text-text-2">
                {phase === "playing" ? `${speed}× speed` : `played at ${speed}×`}
              </span>
              {phase === "playing" ? (
                <Button variant="ghost" onClick={() => setSkipped(take)}>
                  <FastForward aria-hidden />
                  Skip to the result
                </Button>
              ) : (
                <Button variant="ghost" onClick={replay} disabled={reduced}>
                  <RotateCcw aria-hidden />
                  Replay
                </Button>
              )}
            </span>
          </div>
          <div className="relative min-h-0 flex-1">
            <DrillBoard floor={floor} report={report} simS={shownS} />
          </div>
          <Footer legend />
        </div>
      }
      panel={
        <DrillPanel
          report={report}
          baselineS={baseline.timeToClearS}
          numberedAs={numberedAs}
          simS={shownS}
          phase={phase}
          narrative={
            <DrillNarrativePanel
              key={`${take}-${ask}`}
              load={narrative}
              start={phase === "done"}
              liveScan={liveScan}
              onRetry={() => {
                setNarrative({ status: "loading" });
                setAsk((a) => a + 1);
              }}
            />
          }
        />
      }
      action={<PrintAction />}
    />
  );
}

/** "Print drill plan": the screen's primary action, disabled until the printable plan exists. */
function PrintAction() {
  return (
    <span className="group relative block">
      <Button
        variant="primary"
        disabled
        aria-describedby="print-soon"
        data-testid="print-drill-plan"
        className="w-full"
      >
        <Printer aria-hidden />
        Print drill plan
      </Button>
      <span
        id="print-soon"
        role="tooltip"
        className="pointer-events-none absolute inset-x-0 bottom-full mb-2 rounded-sm border border-border bg-surface-3 px-3 py-2 text-sm text-text-1 opacity-0 shadow-e-2 transition-opacity duration-fast group-hover:opacity-100"
      >
        The printable drill plan isn&apos;t built yet.
      </span>
    </span>
  );
}

function Footer({ legend = false }: { legend?: boolean }) {
  return (
    <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
      <p data-testid="drill-disclaimer" className="text-sm text-text-2">
        {DRILL_DISCLAIMER}
      </p>
      {legend ? (
        <div className="flex shrink-0 items-center gap-4 text-sm text-text-2 max-md:hidden">
          <Legend swatch={<span className="size-2 rounded-full bg-n-200" />}>Occupant</Legend>
          <Legend swatch={<span className="size-2.5 rotate-45 border border-n-100" />}>Warden post</Legend>
          <Legend swatch={<span className="size-3 rounded-full border border-dashed border-n-100" />}>Queue</Legend>
        </div>
      ) : null}
    </div>
  );
}

function Legend({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="flex w-4 items-center justify-center">
        {swatch}
      </span>
      {children}
    </span>
  );
}

function BoardMessage({
  testId,
  label,
  title,
  body,
  action,
}: {
  testId: string;
  label: string;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="absolute inset-x-6 inset-y-0 flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface-1 p-6 text-center"
    >
      <p className="label-caps text-text-3">{label}</p>
      <p className="text-lg font-semibold text-text-1">{title}</p>
      <p className="max-w-md text-sm break-words text-text-2">{body}</p>
      {action}
    </div>
  );
}
