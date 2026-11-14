"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getMatterport } from "@/adapters/matterport";
import { BuildingScreen } from "@/components/shell/building-screen";
import { LayerDot } from "@/components/shell/layer-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Building, LevelManifest } from "@/domain";
import { act, createRun, toRunLog, type Action, type RunState } from "@/engine";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import { cn } from "@/lib/utils";
import { AlarmBanner } from "./alarm-banner";
import { actionForKey, canTake, choices as choicesOf, describeTurn, guardOrders, planSteps, roomName, type Choice } from "./board";
import { BoardView } from "./board-view";

export type RunBuilding = Pick<Building, "id" | "name" | "matterportModelId">;

/** The seed every run of the demo uses, so a rehearsed run plays the same way in front of judges. */
export const RUN_SEED = 7;

/** Where the run's log is kept for the Debrief (SPEC §4.1: run logs live in localStorage). */
export const runLogKey = (buildingId: string) => `heist:run-log:${buildingId}`;

type Load =
  | { status: "loading" }
  | { status: "ready"; placed: PlacedLevel; live: boolean }
  | { status: "no-floor" }
  | { status: "error"; message: string };

/**
 * The Run screen (SPEC §2 beat 5, DESIGN.md the hero screen): the isometric
 * board on the left, the alarm, the objective, the plan and the guards'
 * orders on the right. The floor comes from the Matterport adapter in the
 * browser (SPEC §4.5), the placer turns the cached manifest into a level on
 * it, and the engine plays it. Keys: 1–9 a neighbour, W wait, Space take.
 */
export function RunScreen({
  building,
  manifest,
  heistMode,
}: {
  building: RunBuilding;
  /** The cached manifest; null when the building has no level yet. */
  manifest: LevelManifest | null;
  heistMode?: string;
}) {
  const [loaded, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [run, setRun] = useState<RunState | null>(null);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    if (!manifest) return;
    let live = true;
    const matterport = getMatterport(heistMode);
    matterport.adapter
      .loadFloor(building)
      .then(
        (floor) => {
          if (!live) return;
          if (!floor) return setLoad({ status: "no-floor" });
          const placed = placeLevel(manifest, floor, RUN_SEED);
          setLoad({ status: "ready", placed, live: matterport.mode === "live" });
          setRun(createRun(placed.level));
          setStatus(`You're in at the ${placed.entries[0].label.toLowerCase()}. Pick a number to move.`);
        },
        (error: unknown) => {
          if (live) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
        },
      )
      .catch((error: unknown) => {
        if (live) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      live = false;
    };
  }, [building, manifest, heistMode, attempt]);

  const load: Load = manifest ? loaded : { status: "no-floor" };
  const placed = load.status === "ready" ? load.placed : null;

  const play = useCallback(
    (action: Action) => {
      if (!placed || !run) return;
      const result = act(run, action);
      if (!result.ok) {
        setStatus(`Not possible: ${result.reason}.`);
        return;
      }
      setRun(result.run);
      setStatus(describeTurn(placed, run, result.run));
      try {
        window.localStorage.setItem(runLogKey(building.id), JSON.stringify(toRunLog(result.run)));
      } catch {
        // Storage can be full or blocked; the run itself goes on.
      }
    },
    [placed, run, building.id],
  );

  const restart = useCallback(() => {
    if (!placed) return;
    setRun(createRun(placed.level));
    setStatus("Back at the start. The guards are on their rounds.");
  }, [placed]);

  useEffect(() => {
    if (!run) return;
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      // Space and Enter keep their meaning on a focused button or link; the game keys work everywhere else.
      if ((event.key === " " || event.key === "Enter") && target?.closest("button, a")) return;
      const action = actionForKey(event.key, run!);
      if (event.key === " ") event.preventDefault();
      if (action) {
        event.preventDefault();
        play(action);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, play]);

  const options = useMemo(() => (run ? choicesOf(run) : []), [run]);
  const over = run !== null && run.status !== "playing";

  return (
    <BuildingScreen
      visualLabel="Run board"
      visual={
        <div className="absolute inset-0 flex flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 px-6">
            <span className="flex items-center gap-2 label-caps text-text-2">
              <LayerDot layer="matterport" decorative />
              Matterport
              <span className="max-md:hidden">
                {load.status === "ready" && load.live ? " · floor plan from the scan" : " · floor plan from fixtures"}
              </span>
            </span>
            <span aria-hidden className="h-4 w-px bg-border" />
            <span className="truncate text-sm text-text-1">{manifest?.mission.title}</span>
            <Button variant="ghost" className="ml-auto" onClick={restart} disabled={!run || run.turn === 0}>
              <RotateCcw aria-hidden />
              Restart
            </Button>
          </div>

          <div className="relative min-h-0 flex-1">
            {load.status === "loading" ? (
              <Skeleton data-testid="board-skeleton" className="absolute inset-x-6 inset-y-0 rounded-md bg-surface-1" />
            ) : load.status === "no-floor" ? (
              <BoardMessage
                testId="board-empty"
                label="No floor yet"
                title="This building's level isn't ready yet."
                body="Only Halvorsen Tower has a board so far. Pick it on the map to play the run."
                action={
                  <Link href="/" className={buttonVariants({ variant: "secondary" })}>
                    Back to the map
                  </Link>
                }
              />
            ) : load.status === "error" ? (
              <BoardMessage
                testId="board-error"
                label="The level didn't place"
                title="The board couldn't be set up."
                body={load.message}
                action={
                  <Button
                    onClick={() => {
                      setLoad({ status: "loading" });
                      setAttempt((a) => a + 1);
                    }}
                  >
                    Retry
                  </Button>
                }
              />
            ) : run && placed ? (
              <BoardView placed={placed} run={run} choices={options} onChoose={(c: Choice) => play(c.action)} />
            ) : null}
          </div>

          <div className="flex h-16 shrink-0 items-center justify-between gap-6 px-6">
            <p data-testid="run-status" aria-live="polite" className="min-w-0 text-sm text-text-1 md:truncate">
              {status}
            </p>
            <div className="flex shrink-0 items-center gap-4 text-sm text-text-2 max-md:hidden">
              <span className="flex items-center gap-2">
                <Kbd>1–9</Kbd> move
              </span>
              <span className="flex items-center gap-2">
                <Kbd>W</Kbd> wait
              </span>
              <span className={cn("flex items-center gap-2", run && canTake(run) ? "text-text-1" : null)}>
                <Kbd>Space</Kbd> take
              </span>
            </div>
          </div>
        </div>
      }
      panel={<RunPanel manifest={manifest} placed={placed} run={run} />}
      action={
        over ? (
          <Link
            href={`/b/${encodeURIComponent(building.id)}/debrief`}
            className={buttonVariants({ variant: "primary" })}
          >
            See the debrief
          </Link>
        ) : null
      }
    />
  );
}

function RunPanel({
  manifest,
  placed,
  run,
}: {
  manifest: LevelManifest | null;
  placed: PlacedLevel | null;
  run: RunState | null;
}) {
  if (!manifest || !placed || !run) {
    return (
      <div className="flex flex-col gap-6" data-testid="panel-skeleton">
        <Skeleton className="h-[112px]" />
        <Skeleton className="h-20" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  const steps = planSteps(placed, run, manifest.mission.objective);
  const orders = guardOrders(placed, run);
  const floor = placed.level.floor;

  return (
    <div className="flex flex-col gap-6">
      <AlarmBanner alarm={run.alarm} turn={run.turn} />

      {run.status !== "playing" ? <Outcome placed={placed} run={run} /> : null}

      <section aria-labelledby="objective-label" className="flex flex-col gap-2">
        <h2 id="objective-label" className="label-caps text-text-3">
          Objective
        </h2>
        <p data-testid="objective" className="text-base text-text-1">
          {manifest.mission.objective}
          {run.carrying ? (
            <span className="ml-2 rounded-sm border border-success px-1.5 py-0.5 align-middle label-caps text-success">
              Taken
            </span>
          ) : null}
        </p>
        <p className="text-sm text-text-2">{manifest.mission.exitCondition}.</p>
      </section>

      <section aria-labelledby="plan-label" className="flex flex-col gap-2">
        <h2 id="plan-label" className="label-caps text-text-3">
          The plan
        </h2>
        <ol data-testid="plan" className="flex flex-col">
          {steps.map((step, i) => (
            <li
              key={step.label}
              data-state={step.state}
              aria-current={step.state === "next" ? "step" : undefined}
              className={cn(
                "flex items-baseline gap-3 border-l-2 py-1.5 pl-3 text-sm",
                step.state === "next"
                  ? "border-accent bg-accent-wash text-text-1"
                  : step.state === "done"
                    ? "border-transparent text-text-2 line-through decoration-n-500"
                    : "border-transparent text-text-2",
              )}
            >
              <span className="font-mono text-xs text-text-3">{i + 1}</span>
              {step.label}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="guards-label" className="flex flex-col gap-2">
        <h2 id="guards-label" className="label-caps text-text-3">
          Guards
        </h2>
        <ul data-testid="guard-orders" className="flex flex-col">
          {run.guards.map((guard) => {
            const order = orders.find((o) => o.guardId === guard.id);
            return (
              <li
                key={guard.id}
                data-guard={guard.id}
                data-intent={order?.intent ?? "round"}
                className="grid grid-cols-[32px_88px_minmax(0,1fr)] items-baseline border-b border-border py-1.5 text-sm last:border-b-0"
              >
                <span className="font-mono text-text-1">{guard.id}</span>
                <span className={cn("font-mono text-xs uppercase", order ? "text-danger" : "text-text-2")}>
                  {order ? "converge" : "round"}
                </span>
                <span className="truncate text-text-2">{order ? order.zone : roomName(floor, guard.nodeId)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-sm text-text-2">Security shown is game fiction derived from building class and era.</p>
    </div>
  );
}

function Outcome({ placed, run }: { placed: PlacedLevel; run: RunState }) {
  const won = run.status === "won";
  return (
    <section
      data-testid="run-outcome"
      data-status={run.status}
      className={cn("rounded-md border bg-surface-2 p-4", won ? "border-success" : "border-danger")}
    >
      <p className={cn("label-caps", won ? "text-success" : "text-danger")}>{won ? "Clean exit" : "Caught"}</p>
      <p className="mt-1 text-lg font-semibold text-text-1">
        {won ? "Out with the files." : `Caught in the ${roomName(placed.level.floor, run.playerNode)}.`}
      </p>
      <p className="mt-1 text-sm text-text-2">
        {run.turn} turns, {run.alarmEvents.filter((e) => e.cause.kind !== "decay").length} alarm raises. The debrief has
        the replay.
      </p>
    </section>
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

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-border bg-surface-2 px-1.5 font-mono text-xs text-text-1">
      {children}
    </kbd>
  );
}
