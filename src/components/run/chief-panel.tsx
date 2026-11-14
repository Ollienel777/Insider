"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { GuardOrder } from "@/domain";
import type { AppliedOrders } from "@/engine";
import { cn } from "@/lib/utils";
import type { ChiefAnswer } from "./chief-request";

/** The Chief's side of the run, as the Run screen tracks it. */
export type ChiefState =
  | { status: "idle" }
  /** A call is out for the alarm event numbered `seq` (its index in `run.alarmEvents`). */
  | { status: "pending"; seq: number }
  | {
      status: "ready";
      seq: number;
      answer: ChiefAnswer;
      /** What the engine kept and dropped when it applied the orders. */
      applied: Pick<AppliedOrders, "applied" | "dropped" | "locked">;
      /** It landed after the run had ended: shown, but no guard got its orders. */
      late?: boolean;
    }
  | { status: "error"; seq: number; message: string };

/** What a Chief answer that landed after the run ended says in place of its orders taking effect. */
export const LATE_NOTE = "Arrived after the run ended. None of these orders reached the guards.";

/** Milliseconds between streamed words, and between order rows once the words are in. */
export const STREAM = { wordMs: 35, rowMs: 160, pauseMs: 150 } as const;

/** How much of a ready answer is on screen: words of the rationale, then order rows. */
export interface Revealed {
  words: number;
  rows: number;
  done: boolean;
}

const ROW_COUNT = (state: ChiefState) =>
  state.status === "ready" ? state.applied.applied.length + state.applied.locked.length + state.applied.dropped.length : 0;

/**
 * Streams a ready answer onto the screen (DESIGN.md, the re-plan): the
 * rationale word by word, then the orders row by row. Under
 * `prefers-reduced-motion` it appears whole. A new answer starts again.
 *
 * The stream is keyed by the ready state itself, not by its `seq`: after
 * Restart the first alarm event is numbered 0 again, and a key by number
 * would find the last run's finished count and show the new answer whole
 * for a frame before it restarted (#68).
 */
export function useChiefStream(state: ChiefState): Revealed {
  const words = state.status === "ready" ? state.answer.orders.rationale.split(/\s+/).length : 0;
  const rows = ROW_COUNT(state);
  const key = state.status === "ready" ? state : null;
  const [shown, setShown] = useState<{ key: ChiefState | null; ticks: number }>({ key: null, ticks: 0 });
  const total = words + rows;
  const ticks = key !== null && shown.key === key ? shown.ticks : 0;

  useEffect(() => {
    if (key === null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout>;
    if (reduce) {
      timer = setTimeout(() => setShown({ key, ticks: total }), 0);
      return () => clearTimeout(timer);
    }
    let tick = 0;
    const step = () => {
      tick += 1;
      setShown({ key, ticks: tick });
      if (tick < total) timer = setTimeout(step, tick < words ? STREAM.wordMs : tick === words ? STREAM.pauseMs : STREAM.rowMs);
    };
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [key, total, words]);

  return { words: Math.min(ticks, words), rows: Math.max(0, ticks - words), done: key !== null && ticks >= total };
}

/**
 * The panel's one line on where the orders came from, true on every path
 * (#30, R1-M2): the model wrote them; the model was called and the recorded
 * or rule-based orders stood in because it timed out or failed; or no model
 * was called at all (fake mode, forced to fixtures in the demo settings, or a
 * setting that refuses every live call).
 */
export function chiefSourceNote(answer: Pick<ChiefAnswer, "source" | "reason">): string {
  if (answer.source === "model") return "Live orders: the model wrote these.";
  const kind = answer.source === "recorded" ? "recorded" : "rule-based";
  if (answer.reason === "timeout") return `The model was called but didn't answer in time, so ${kind} orders stand in.`;
  if (answer.reason === "error") return `The model was called but the call failed, so ${kind} orders stand in.`;
  if (answer.reason === "configuration") return `No model was called: a setting refuses live calls, so ${kind} orders stand in.`;
  return answer.source === "recorded"
    ? "Recorded orders: no model was called."
    : "Rule-based orders: no recording for this moment, and no model was called.";
}

/**
 * The Security Chief's section of the Run panel (DESIGN.md, the hero screen,
 * step 3): its mono caps label, the rationale streamed word by word, then
 * the orders row by row as the engine kept them, the zones it locked, and
 * any order the engine dropped. While a call is out it shows its label and a
 * one-line skeleton; the guards are already moving.
 */
export function ChiefPanel({
  state,
  revealed,
  zoneName,
  onRetry,
}: {
  state: ChiefState;
  revealed: Revealed;
  zoneName: (zoneId: string) => string;
  onRetry: () => void;
}) {
  const answer = state.status === "ready" ? state.answer : null;
  return (
    <section
      aria-labelledby="chief-label"
      data-testid="chief-panel"
      data-state={state.status}
      data-seq={state.status === "idle" ? undefined : state.seq}
      data-source={answer?.source}
      data-late={state.status === "ready" && state.late ? "true" : undefined}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <h2 id="chief-label" className="label-caps text-text-3">
          Security Chief
        </h2>
        {answer && answer.source !== "model" ? (
          <span
            data-testid="chief-recorded-chip"
            title={chiefSourceNote(answer)}
            className="rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2"
          >
            {answer.source === "recorded" ? "Recorded" : "Rule-based"}
          </span>
        ) : null}
        {state.status === "ready" && state.late ? (
          <span
            data-testid="chief-late-chip"
            className="rounded-sm border border-dashed border-border px-1.5 py-0.5 label-caps text-text-2"
          >
            After the end
          </span>
        ) : null}
        {state.status === "pending" ? (
          <span className="ml-auto text-xs text-text-2" data-testid="chief-pending">
            Re-planning…
          </span>
        ) : null}
      </div>

      {state.status === "idle" ? (
        <p className="text-sm text-text-2">Re-plans the guards each time the alarm changes.</p>
      ) : state.status === "pending" ? (
        <Skeleton data-testid="chief-skeleton" className="h-6" />
      ) : state.status === "error" ? (
        <div
          data-testid="chief-error"
          className="flex flex-col items-start gap-2 rounded-r-sm border-l-2 border-danger bg-surface-2 py-3 pr-4 pl-3"
        >
          <p className="text-sm text-text-1">The Chief didn&apos;t answer: {state.message}</p>
          <p className="text-sm text-text-2">The guards keep converging on where you were seen.</p>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : answer ? (
        <Ready state={state} answer={answer} revealed={revealed} zoneName={zoneName} />
      ) : null}
    </section>
  );
}

function Ready({
  state,
  answer,
  revealed,
  zoneName,
}: {
  state: Extract<ChiefState, { status: "ready" }>;
  answer: ChiefAnswer;
  revealed: Revealed;
  zoneName: (zoneId: string) => string;
}) {
  const words = answer.orders.rationale.split(/\s+/);
  const { applied, locked, dropped } = state.applied;
  const late = state.late === true;
  const rows: { key: string; testId: string; guard?: string; intent: string; zone: string; note?: string }[] = [
    ...applied.map((o: GuardOrder, i) => ({ key: `o-${i}`, testId: "chief-order", guard: o.guardId, intent: o.intent, zone: zoneName(o.zoneId) })),
    ...locked.map((l) => ({ key: `l-${l.zoneId}`, testId: "chief-lock", intent: "lock", zone: zoneName(l.zoneId) })),
    ...dropped.map((d, i) => ({
      key: `d-${i}`,
      testId: "chief-dropped",
      guard: "guardId" in d.order ? d.order.guardId : undefined,
      intent: "guardId" in d.order ? d.order.intent : "lock",
      zone: "guardId" in d.order ? d.order.zoneId : d.order.lockZone,
      note: d.reason,
    })),
  ];
  return (
    <>
      <p className="sr-only">{answer.orders.rationale}</p>
      <p
        aria-hidden
        data-testid="chief-rationale"
        data-done={revealed.done ? "true" : "false"}
        className={cn("text-base", late ? "text-text-2" : "text-text-1")}
      >
        {words.slice(0, revealed.words).join(" ")}
        {revealed.words < words.length ? <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 bg-text-2" /> : null}
      </p>
      {late ? (
        <p data-testid="chief-late" className="text-sm text-text-2">
          {LATE_NOTE}
        </p>
      ) : null}
      <p data-testid="chief-source-note" data-reason={answer.reason} className="text-sm text-text-2">
        {chiefSourceNote(answer)}
      </p>
      {rows.length > 0 ? (
        <ul data-testid="chief-orders" aria-label="Orders" className="flex flex-col">
          {rows.slice(0, revealed.rows).map((row) => (
            <li
              key={row.key}
              data-testid={row.testId}
              data-guard={row.guard}
              data-intent={row.intent}
              data-late={late ? "true" : undefined}
              className={cn(
                "grid grid-cols-[32px_88px_minmax(0,1fr)] items-baseline border-b border-border py-1.5 text-sm last:border-b-0",
                "animate-in fade-in-0 duration-base",
              )}
            >
              <span className={cn("font-mono", row.note ? "text-text-2 line-through decoration-n-500" : "text-text-1")}>
                {row.guard ?? ""}
              </span>
              {/* A late order never moved a guard: never in the colour of one that did. */}
              <span className={cn("font-mono text-xs uppercase", row.note || late ? "text-text-2" : "text-danger")}>{row.intent}</span>
              <span className="min-w-0 truncate text-text-2" title={row.note ?? row.zone}>
                {row.note ? `Dropped: ${row.note}` : row.zone}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * The guards whose dashed route waits for its order row: every guard ordered in a ready answer whose row is not
 * shown yet. A late answer orders no guard, so none waits on it.
 */
export function hiddenRoutes(state: ChiefState, revealed: Revealed): Set<string> {
  if (state.status !== "ready" || state.late) return new Set();
  return new Set(state.applied.applied.slice(revealed.rows).map((o) => o.guardId));
}
