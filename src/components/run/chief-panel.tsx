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
    }
  | { status: "error"; seq: number; message: string };

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
 */
export function useChiefStream(state: ChiefState): Revealed {
  const words = state.status === "ready" ? state.answer.orders.rationale.split(/\s+/).length : 0;
  const rows = ROW_COUNT(state);
  const key = state.status === "ready" ? state.seq : -1;
  const [shown, setShown] = useState<{ key: number; ticks: number }>({ key: -1, ticks: 0 });
  const total = words + rows;
  const ticks = shown.key === key ? shown.ticks : 0;

  useEffect(() => {
    if (key === -1) return;
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

  return { words: Math.min(ticks, words), rows: Math.max(0, ticks - words), done: key !== -1 && ticks >= total };
}

const SOURCE_NOTE: Record<ChiefAnswer["source"], string> = {
  model: "",
  recorded: "Recorded orders: no model was called.",
  template: "Rule-based orders: no recording for this moment, and no model was called.",
};

const REASON_NOTE: Record<NonNullable<ChiefAnswer["reason"]>, string> = {
  "fake mode": "Fake mode.",
  timeout: "The model didn't answer in time.",
  error: "The model call failed.",
};

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
      data-source={answer?.source}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <h2 id="chief-label" className="label-caps text-text-3">
          Security Chief
        </h2>
        {answer && answer.source !== "model" ? (
          <span
            data-testid="chief-recorded-chip"
            title={`${SOURCE_NOTE[answer.source]}${answer.reason ? ` ${REASON_NOTE[answer.reason]}` : ""}`}
            className="rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2"
          >
            {answer.source === "recorded" ? "Recorded" : "Rule-based"}
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
  const rows: { key: string; testId: string; guard?: string; intent: string; zone: string; note?: string }[] = [
    ...applied.map((o: GuardOrder) => ({ key: `o-${o.guardId}`, testId: "chief-order", guard: o.guardId, intent: o.intent, zone: zoneName(o.zoneId) })),
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
        className="text-base text-text-1"
      >
        {words.slice(0, revealed.words).join(" ")}
        {revealed.words < words.length ? <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 bg-text-2" /> : null}
      </p>
      {answer.source !== "model" ? (
        <p data-testid="chief-source-note" className="text-sm text-text-2">
          {SOURCE_NOTE[answer.source]}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul data-testid="chief-orders" aria-label="Orders" className="flex flex-col">
          {rows.slice(0, revealed.rows).map((row) => (
            <li
              key={row.key}
              data-testid={row.testId}
              data-guard={row.guard}
              data-intent={row.intent}
              className={cn(
                "grid grid-cols-[32px_88px_minmax(0,1fr)] items-baseline border-b border-border py-1.5 text-sm last:border-b-0",
                "animate-in fade-in-0 duration-base",
              )}
            >
              <span className={cn("font-mono", row.note ? "text-text-2 line-through decoration-n-500" : "text-text-1")}>
                {row.guard ?? ""}
              </span>
              <span className={cn("font-mono text-xs uppercase", row.note ? "text-text-2" : "text-danger")}>{row.intent}</span>
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

/** The guards whose dashed route waits for its order row: every guard ordered in a ready answer whose row is not shown yet. */
export function hiddenRoutes(state: ChiefState, revealed: Revealed): Set<string> {
  if (state.status !== "ready") return new Set();
  return new Set(state.applied.applied.slice(revealed.rows).map((o) => o.guardId));
}
