"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getMatterport } from "@/adapters/matterport";
import { ALARM_STYLE } from "@/components/run/alarm-banner";
import { loadRunLog } from "@/components/run/run-log-store";
import { BuildingScreen } from "@/components/shell/building-screen";
import { LayerDot } from "@/components/shell/layer-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Building, LevelManifest, RunLog } from "@/domain";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import { cn } from "@/lib/utils";
import { debriefOf, LATE_NOTE, notStarted, UnreadableLog, type Debrief, type Decision } from "./debrief";
import { ReplayBoard } from "./replay-board";
import { OwnerModeLink } from "@/components/owner/owner-mode-link";

export type DebriefBuilding = Pick<Building, "id" | "name" | "matterportModelId">;

type Load =
  | { status: "loading" }
  /**
   * Nothing to replay: no run in storage (`none`), a run on the board that hasn't had a turn yet
   * (`not-started`), or a log that cannot be replayed on this level (`unreadable`).
   */
  | { status: "empty"; reason: EmptyReason }
  | { status: "no-floor" }
  | { status: "error"; message: string }
  | { status: "ready"; placed: PlacedLevel; debrief: Debrief };

/**
 * The line above Try again on a finished run, by how it ended. The Debrief is
 * where the heist ends (SPEC §2 beat 7; Drill Mode is on hold, Q8), so its
 * one primary action sends the player back in. Par is the shortest quiet
 * route, so a clean exit can make par but never beat it: one already on par
 * (or on a floor with no par) is sent to find another way out instead.
 */
export function tryAgainLine({ outcome, stats }: Pick<Debrief, "outcome" | "stats">): string {
  if (outcome === "caught") return "Same floor, same rounds. Try another way in.";
  if (stats.par !== null && stats.turns > stats.par) return "Clean exit. Run it again and make par.";
  return "Clean exit. Run it again by a different way out.";
}

/**
 * The Debrief screen (SPEC §2 beat 7, DESIGN.md Debrief). It reads the run's
 * log from storage, places the same level on the same floor with the log's
 * seed, and shows the grade and the outcome, three stats, the replay board
 * with a scrubber, and the Chief's decisions as a timeline. Built to read in
 * five seconds: the outcome, what caught the player or how they got out, and
 * what the Chief did, before Try again sends the player back in.
 */
export function DebriefScreen({
  building,
  manifest,
  heistMode,
}: {
  building: DebriefBuilding;
  manifest: LevelManifest | null;
  heistMode?: string;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const fail = (error: unknown) => {
      if (live) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
    };
    // Storage is the browser's: read it after mount.
    const log: RunLog | null = loadRunLog(building.id);
    if (!log || !manifest || notStarted(log)) {
      // No cached manifest is the building with no level, not a missing run.
      const next: Load = !manifest ? { status: "no-floor" } : { status: "empty", reason: log ? "not-started" : "none" };
      const timer = setTimeout(() => live && setLoad(next), 0);
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }
    const matterport = getMatterport(heistMode);
    matterport.adapter
      .loadFloor(building)
      .then((floor) => {
        if (!live) return;
        if (!floor) return setLoad({ status: "no-floor" });
        try {
          const placed = placeLevel(manifest, floor, log.seed);
          setLoad({ status: "ready", placed, debrief: debriefOf(placed, log) });
        } catch (error) {
          if (error instanceof UnreadableLog) setLoad({ status: "empty", reason: "unreadable" });
          else fail(error);
        }
      }, fail)
      .catch(fail);
    return () => {
      live = false;
    };
  }, [building, manifest, heistMode, attempt]);

  const runHref = `/b/${encodeURIComponent(building.id)}/run`;

  if (load.status === "ready") {
    // Keyed on the log it reads, so a reload that brings a shorter log starts its scrubber afresh.
    const { debrief } = load;
    return (
      <DebriefReady
        key={`${debrief.outcome}-${debrief.frames.length}-${debrief.decisions.length}`}
        placed={load.placed}
        debrief={debrief}
        runHref={runHref}
      />
    );
  }

  const message =
    load.status === "empty" ? (
      <Message
        testId="debrief-empty"
        reason={load.reason}
        {...EMPTY[load.reason]}
        action={
          <Link href={runHref} className={buttonVariants({ variant: "primary" })}>
            {load.reason === "not-started" ? "Back to the run" : "Start the run"}
          </Link>
        }
      />
    ) : load.status === "no-floor" ? (
      <Message
        testId="debrief-no-floor"
        label="No floor yet"
        title="This building has no board to replay on yet."
        body="Only Halvorsen Tower has a floor plan so far. Pick it on the map to play the run."
        action={
          <Link href="/" className={buttonVariants({ variant: "secondary" })}>
            Back to the map
          </Link>
        }
      />
    ) : load.status === "error" ? (
      <Message
        testId="debrief-error"
        label="The replay didn't load"
        title="The debrief couldn't be set up."
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
    ) : (
      <Skeleton data-testid="debrief-skeleton" className="absolute inset-x-6 inset-y-0 rounded-md bg-surface-1" />
    );

  return (
    <BuildingScreen
      visualLabel="Replay"
      visual={
        <div className="absolute inset-0 flex flex-col">
          <div className="h-14 shrink-0" />
          <div className="relative min-h-0 flex-1">{message}</div>
          <div className="h-16 shrink-0" />
        </div>
      }
      panel={
        load.status === "loading" ? (
          <div className="flex flex-col gap-6" data-testid="debrief-panel-skeleton">
            <Skeleton className="h-[104px]" />
            <Skeleton className="h-16" />
            <Skeleton className="h-48" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="label-caps text-text-3">Debrief</p>
            <h1 className="text-xl font-semibold text-text-1">{building.name}</h1>
          </div>
        )
      }
    />
  );
}

function DebriefReady({
  placed,
  debrief,
  runHref,
}: {
  placed: PlacedLevel;
  debrief: Debrief;
  runHref: string;
}) {
  const last = debrief.frames.length - 1;
  const [frame, setFrame] = useState(last);
  const now = debrief.frames[frame];
  // One tick per frame the Chief decided on; a late decision's is grey, as its timeline mark is hollow.
  const ticks = useMemo(
    () => [...new Map(debrief.decisions.map((d) => [d.turn, d.late] as const)).entries()],
    [debrief.decisions],
  );

  return (
    <BuildingScreen
      visualLabel="Replay"
      visual={
        <div className="absolute inset-0 flex flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 px-6">
            <span className="flex items-center gap-2 label-caps text-text-2">
              <LayerDot layer="matterport" decorative />
              Replay
            </span>
            <span aria-hidden className="h-4 w-px bg-border" />
            <span className="truncate text-sm text-text-1">
              {now.turn === 0 ? "The start" : `After turn ${now.turn}`}
            </span>
            <span
              data-testid="replay-alarm"
              data-state={now.alarm}
              className={cn("ml-auto label-caps", ALARM_STYLE[now.alarm].text)}
            >
              {ALARM_STYLE[now.alarm].label}
            </span>
          </div>

          <div className="relative min-h-0 flex-1">
            <ReplayBoard placed={placed} frames={debrief.frames} frame={frame} caught={debrief.outcome === "caught"} />
            {/* Over the board, not in the action block: the panel keeps its height for the Chief's timeline. */}
            <OwnerModeLink
              buildingId={placed.level.buildingId}
              className="absolute top-3 right-6 w-auto bg-surface-1/90 backdrop-blur-sm"
            />
          </div>

          <div className="flex h-16 shrink-0 items-center gap-4 px-6">
            <label htmlFor="replay-turn" className="label-caps text-text-3">
              Turn
            </label>
            <div className="relative min-w-0 flex-1">
              <input
                id="replay-turn"
                data-testid="replay-slider"
                type="range"
                min={0}
                max={last}
                step={1}
                value={frame}
                onChange={(e) => setFrame(Number(e.target.value))}
                aria-valuetext={now.turn === 0 ? "Start" : `Turn ${now.turn} of ${last}`}
                className="h-10 w-full cursor-pointer accent-n-200"
              />
              {/* A tick under each turn the Chief re-planned on. */}
              <div aria-hidden className="pointer-events-none absolute inset-x-2 bottom-0 h-1.5">
                {ticks.map(([turn, late]) => (
                  <span
                    key={turn}
                    data-testid="replay-chief-tick"
                    data-late={late ? "true" : undefined}
                    className={cn("absolute top-0 h-1.5 w-0.5 -translate-x-1/2", late ? "bg-text-3" : "bg-danger")}
                    style={{ left: `${last === 0 ? 0 : (turn / last) * 100}%` }}
                  />
                ))}
              </div>
            </div>
            <p className="w-16 shrink-0 text-right font-mono text-sm text-text-1 tabular-nums">
              <span data-testid="replay-turn">{now.turn}</span>
              <span className="text-text-2">/{last}</span>
            </p>
          </div>
        </div>
      }
      panel={<DebriefPanel debrief={debrief} frame={frame} onScrub={setFrame} runHref={runHref} />}
      action={
        <div className="flex flex-col gap-3">
          {debrief.outcome === "playing" ? null : (
            <>
              <p data-testid="try-again-line" className="text-sm text-text-2">
                {tryAgainLine(debrief)}
              </p>
              <Link
                href={runHref}
                data-testid="debrief-try-again"
                className={cn(buttonVariants({ variant: "primary" }), "w-full")}
              >
                Try again
              </Link>
            </>
          )}
          <Link
            href="/"
            data-testid="debrief-to-map"
            className={cn(buttonVariants({ variant: "ghost" }), "w-full")}
          >
            Pick another building
          </Link>
        </div>
      }
    />
  );
}

type EmptyReason = "none" | "not-started" | "unreadable";

/** What the Debrief says when it has no run to replay, by why. */
const EMPTY: Record<EmptyReason, { label: string; title: string; body: string }> = {
  none: {
    label: "No run yet",
    title: "There's no run to debrief yet.",
    body: "Play the run first. The debrief replays it turn by turn and grades it.",
  },
  "not-started": {
    label: "Not started",
    title: "The run on the board hasn't started yet.",
    body: "Make your first move on the Run screen. The debrief replays the run turn by turn and grades it.",
  },
  unreadable: {
    label: "Can't replay",
    title: "This run can't be replayed on this level.",
    body: "Play it again and the debrief will have its replay, stats and the Chief's decisions.",
  },
};

const GRADE_TONE: Record<NonNullable<Debrief["grade"]>, string> = {
  S: "text-success",
  A: "text-success",
  B: "text-text-1",
  C: "text-warning",
  D: "text-danger",
};

function DebriefPanel({
  debrief,
  frame,
  onScrub,
  runHref,
}: {
  debrief: Debrief;
  frame: number;
  onScrub: (frame: number) => void;
  runHref: string;
}) {
  const { stats, outcome } = debrief;
  const label = outcome === "won" ? "Clean exit" : outcome === "caught" ? "Caught" : "Run not finished";
  const tone = outcome === "won" ? "text-success" : outcome === "caught" ? "text-danger" : "text-text-2";
  return (
    <div className="flex flex-col gap-6">
      <section data-testid="debrief-outcome" data-status={outcome} aria-labelledby="outcome-label" className="flex gap-4">
        <div className="flex w-16 shrink-0 flex-col items-center rounded-md border border-border bg-surface-2 py-2">
          <p className="label-caps text-text-3">Grade</p>
          <p
            data-testid="debrief-grade"
            data-grade={debrief.grade ?? ""}
            className={cn("text-3xl font-semibold", debrief.grade ? GRADE_TONE[debrief.grade] : "text-text-2")}
          >
            {debrief.grade ?? "–"}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p id="outcome-label" className={cn("label-caps", tone)}>
            {label}
          </p>
          <h1 data-testid="debrief-headline" className="text-lg font-semibold text-text-1">
            {debrief.headline}
          </h1>
          <p data-testid="debrief-detail" className="text-sm text-text-2">
            {debrief.detail}
          </p>
        </div>
      </section>

      <section aria-label="Stats" className="flex flex-col gap-2">
        <dl className="grid grid-cols-3 gap-2">
          <Stat id="turns" term="Turns" value={stats.turns} note={stats.par !== null ? `par ${stats.par}` : "no par"} />
          <Stat
            id="noise"
            term="Noise"
            value={stats.noise}
            note={stats.noise === 0 ? "silent" : [count(stats.picks, "pick"), count(stats.sprints, "sprint")].filter(Boolean).join(", ")}
          />
          <Stat id="detections" term="Detections" value={stats.detections} note={`peak ${ALARM_STYLE[stats.peak].label}`} />
        </dl>
        <p data-testid="debrief-grade-reason" className="text-sm text-text-2">
          {debrief.gradeReason}
        </p>
        {outcome === "playing" ? (
          // The Run screen keeps no run it is left on: it opens on a fresh one, so the link says so.
          <Link
            href={runHref}
            data-testid="debrief-run-again"
            className={cn(buttonVariants({ variant: "secondary" }), "self-start")}
          >
            Start the run over
          </Link>
        ) : null}
      </section>

      <section aria-labelledby="chief-timeline-label" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="chief-timeline-label" className="label-caps text-text-3">
            Security Chief
          </h2>
          <p className="label-caps text-text-3">
            {debrief.decisions.length} {debrief.decisions.length === 1 ? "decision" : "decisions"}
          </p>
        </div>
        {debrief.decisions.length === 0 ? (
          <p data-testid="chief-none" className="text-sm text-text-2">
            {debrief.noDecisions}
          </p>
        ) : (
          <ol data-testid="chief-timeline" className="flex flex-col">
            {debrief.decisions.map((decision, i) => (
              <DecisionItem
                key={`${decision.late ? "late" : "on"}-${decision.turn}`}
                decision={decision}
                last={i === debrief.decisions.length - 1}
                current={frame === decision.turn}
                onScrub={onScrub}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function count(n: number, one: string): string | null {
  return n === 0 ? null : `${n} ${n === 1 ? one : `${one}s`}`;
}

function Stat({ id, term, value, note }: { id: string; term: string; value: number; note: string }) {
  return (
    <div data-testid="debrief-stat" data-stat={id} className="flex flex-col rounded-md border border-border bg-surface-2 px-3 py-2">
      <dt className="label-caps text-text-3">{term}</dt>
      <dd className="font-mono text-xl font-medium text-text-1 tabular-nums" data-testid="debrief-stat-value">
        {value}
      </dd>
      <dd className="text-xs text-text-2">{note}</dd>
    </div>
  );
}

const SOURCE_CHIP: Record<NonNullable<Decision["source"]>, { label: string; note: string } | null> = {
  model: null,
  // The run keeps where orders came from, not why: a live call that failed
  // also lands here, so the note says only that the model did not write them.
  recorded: { label: "Recorded", note: "Recorded orders: not written by the model." },
  template: { label: "Rule-based", note: "Rule-based orders: not written by the model." },
};

function DecisionItem({
  decision,
  last,
  current,
  onScrub,
}: {
  decision: Decision;
  last: boolean;
  current: boolean;
  onScrub: (frame: number) => void;
}) {
  const chip = decision.source ? SOURCE_CHIP[decision.source] : null;
  return (
    <li
      data-testid="chief-decision"
      data-turn={decision.turn}
      data-late={decision.late ? "true" : undefined}
      className="relative flex gap-3 pb-4 last:pb-0"
    >
      {/* The timeline's rail and this decision's mark on it. */}
      {!last ? <span aria-hidden className="absolute top-5 bottom-0 left-1.5 w-px -translate-x-1/2 bg-border" /> : null}
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-3 shrink-0 rounded-full border-2",
          // A late decision never reached the guards: its mark is hollow and dashed, never filled in danger.
          decision.late
            ? cn("border-dashed border-text-3", current ? "bg-surface-3" : "bg-surface-1")
            : current
              ? "border-danger bg-danger"
              : "border-danger bg-surface-1",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onScrub(decision.turn)}
            aria-label={`Show the board on turn ${decision.turn}`}
            aria-pressed={current}
            className="-my-2 -ml-2 inline-flex h-10 items-center rounded-sm px-2 font-mono text-xs tracking-[0.06em] text-text-1 uppercase hover:bg-surface-3"
          >
            Turn {decision.turn}
          </button>
          {chip ? (
            <span
              data-testid="chief-decision-source"
              title={chip.note}
              className="rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2"
            >
              {chip.label}
            </span>
          ) : null}
          {decision.late ? (
            <span
              data-testid="chief-decision-late-chip"
              className="rounded-sm border border-dashed border-border px-1.5 py-0.5 label-caps text-text-2"
            >
              After the end
            </span>
          ) : null}
        </div>
        <p data-testid="chief-decision-rationale" className={cn("text-base", decision.late ? "text-text-2" : "text-text-1")}>
          {decision.rationale}
        </p>
        {decision.late ? (
          <p data-testid="chief-decision-late" className="text-sm text-text-2">
            {LATE_NOTE}
          </p>
        ) : null}
        {decision.orders.length + decision.locks.length + decision.dropped.length > 0 ? (
          <ul aria-label="Orders" className="flex flex-col">
            {decision.orders.map((o, i) => (
              <OrderRow key={`o-${i}`} guard={o.guardId} intent={o.intent} zone={o.zone} late={decision.late} />
            ))}
            {decision.locks.map((zone) => (
              <OrderRow key={`l-${zone}`} guard="" intent="lock" zone={zone} late={decision.late} />
            ))}
            {decision.dropped.map((d, i) => (
              <OrderRow key={`d-${i}`} guard={d.guardId} intent={d.intent} zone={`Dropped: ${d.reason}`} dropped />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function OrderRow({
  guard,
  intent,
  zone,
  dropped = false,
  late = false,
}: {
  guard: string;
  intent: string;
  zone: string;
  dropped?: boolean;
  /** Ordered, but after the run ended: shown, never in the colour of an order that moved a guard. */
  late?: boolean;
}) {
  return (
    <li
      data-testid={dropped ? "chief-decision-dropped" : "chief-decision-order"}
      data-intent={intent}
      className="grid grid-cols-[32px_64px_minmax(0,1fr)] items-baseline border-b border-border py-1 text-sm last:border-b-0"
    >
      <span className={cn("font-mono", dropped ? "text-text-2 line-through decoration-n-500" : "text-text-1")}>{guard}</span>
      <span className={cn("font-mono text-xs uppercase", dropped || late ? "text-text-2" : "text-danger")}>{intent}</span>
      <span className="truncate text-text-2" title={zone}>
        {zone}
      </span>
    </li>
  );
}

function Message({
  testId,
  reason,
  label,
  title,
  body,
  action,
}: {
  testId: string;
  reason?: EmptyReason;
  label: string;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      data-reason={reason}
      className="absolute inset-x-6 inset-y-0 flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface-1 p-6 text-center"
    >
      <p className="label-caps text-text-3">{label}</p>
      <p className="text-lg font-semibold text-text-1">{title}</p>
      <p className="max-w-md text-sm break-words text-text-2">{body}</p>
      {action}
    </div>
  );
}
