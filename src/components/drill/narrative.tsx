"use client";

import { Fragment, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DrillReport as DrillNarrative } from "@/domain";
import type { DrillFacts } from "@/drill";
import { noteResponse } from "@/lib/demo-status";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

/** What `POST /api/drill/narrative` answers. */
export interface NarrativeAnswer {
  narrative: DrillNarrative;
  recorded: boolean;
  reason?: "fake mode" | "configuration" | "timeout" | "error";
  recording?: string;
}

export type NarrativeLoad =
  | { status: "loading" }
  | { status: "ready"; answer: NarrativeAnswer }
  | { status: "none"; message: string }
  | { status: "error"; message: string };

/** The request the drill screen sends: the facts, and nothing of the floor. */
export function narrativeRequest(facts: DrillFacts): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts }) };
}

/** Asks the narrator. A 404 means nothing is recorded for this drill, which is not an error. */
export async function askNarrator(facts: DrillFacts, fetcher: typeof fetch = fetch): Promise<NarrativeLoad> {
  try {
    const response = await fetcher("/api/drill/narrative", narrativeRequest(facts));
    const body = (await response.json().catch(() => ({}))) as Partial<NarrativeAnswer> & { error?: string };
    if (response.ok && body.narrative) {
      noteResponse(body);
      return { status: "ready", answer: body as NarrativeAnswer };
    }
    if (response.status === 404) return { status: "none", message: body.error ?? "no recorded narrative" };
    return { status: "error", message: body.error ?? `the narrator answered ${response.status}` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

const REASON: Record<NonNullable<NarrativeAnswer["reason"]>, string> = {
  "fake mode": "Fake mode: no model was called. This narrative was recorded for this drill.",
  configuration: "No model was called: a setting refuses live calls. This narrative was recorded for this drill.",
  timeout: "The model didn't answer within the time limit, so the narrative recorded for this drill stands in.",
  error: "The model call failed, so the narrative recorded for this drill stands in.",
};

/** Milliseconds between words as the narrative streams in. */
const WORD_MS = 22;

/**
 * The narrator's paragraph and three recommendations, streamed in word by
 * word once `start` is true (after the playback), or whole under reduced
 * motion. A recorded narrative carries the `recorded` chip. Remount it (a
 * new `key`) to stream it again.
 */
export function DrillNarrativePanel({
  load,
  start,
  onRetry,
  liveScan = false,
}: {
  load: NarrativeLoad;
  start: boolean;
  onRetry: () => void;
  /** The floor came from a live scan, so its facts stay in the browser and no narrative is asked for. */
  liveScan?: boolean;
}) {
  const words = load.status === "ready" ? wordsOf(load.answer.narrative) : 0;
  const reduced = useReducedMotion();
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    if (!start || reduced || words === 0) return;
    const timer = window.setInterval(() => {
      setTicks((n) => {
        if (n + 1 >= words) window.clearInterval(timer);
        return Math.min(words, n + 1);
      });
    }, WORD_MS);
    return () => window.clearInterval(timer);
  }, [start, words, reduced]);
  const shown = reduced ? words : ticks;

  const answer = load.status === "ready" ? load.answer : null;
  return (
    <section aria-labelledby="narrative-label" data-testid="drill-narrative" data-status={liveScan ? "off" : load.status} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 id="narrative-label" className="label-caps text-text-3">
          Drill narrator
        </h2>
        {answer?.recorded ? (
          <span
            data-testid="recorded-chip"
            title={answer.reason ? REASON[answer.reason] : "A recorded narrative."}
            className="rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2"
          >
            Recorded
          </span>
        ) : null}
      </div>
      {liveScan ? (
        <p className="text-sm text-text-2">
          Off for a live scan: the floor&apos;s plan stays in this browser, so nothing about it goes to a model.
        </p>
      ) : answer && !start ? (
        // The answer is in but the playback is not done: hold the words' full height under the skeleton, so
        // the bottleneck and the rest below stay where they are when the words replace it.
        <div className="relative">
          <Streamed narrative={answer.narrative} shown={0} reserve />
          <div data-testid="narrative-skeleton" className="absolute inset-x-0 top-0 flex flex-col gap-2">
            <Skeleton className="h-4" />
            <Skeleton className="h-4" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      ) : load.status === "loading" ? (
        <div data-testid="narrative-skeleton" className="flex flex-col gap-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : load.status === "none" ? (
        <p className="text-sm text-text-2">No narrative was recorded for this drill, so none is shown. The figures above stand on their own.</p>
      ) : load.status === "error" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-text-2">The narrator didn&apos;t answer ({load.message}).</p>
          <Button onClick={onRetry}>Retry</Button>
        </div>
      ) : answer ? (
        <Streamed narrative={answer.narrative} shown={shown} />
      ) : null}
    </section>
  );
}

/**
 * A word that must not break at its hyphens or dashes: a door id ("(d-server-closet):"), or a number range,
 * with a hyphen or the en dash the board's labels use ("2206–2209").
 */
export function keepsWhole(word: string): boolean {
  return /\bd-[a-z0-9-]+/.test(word) || (/\d/.test(word) && /[-–]/.test(word));
}

function wordsOf(narrative: DrillNarrative): number {
  return [narrative.scenario, ...narrative.recommendations].reduce((n, s) => n + s.split(/\s+/).length, 0);
}

/**
 * The narrative with its first `shown` words visible; the rest keeps its space, so nothing shifts as it streams.
 * With `reserve`, an invisible copy that only holds the space.
 */
function Streamed({ narrative, shown, reserve = false }: { narrative: DrillNarrative; shown: number; reserve?: boolean }) {
  const texts = [narrative.scenario, ...narrative.recommendations];
  const counts = texts.map((t) => t.split(/\s+/).length);
  // The words before each part, so each part knows how many of its own are shown.
  const before = counts.map((_, i) => counts.slice(0, i).reduce((s, n) => s + n, 0));
  const part = (index: number) => {
    const words = texts[index].split(/\s+/);
    const visible = Math.max(0, Math.min(words.length, shown - before[index]));
    return (
      <>
        {words.map((word, i) => (
          <Fragment key={i}>
            {i > 0 ? " " : ""}
            {i < visible ? (
              keepsWhole(word) ? (
                <span className="whitespace-nowrap">{word}</span>
              ) : (
                word
              )
            ) : (
              // An unshown word wraps exactly as it will once shown, so nothing reflows as the words stream in.
              <span aria-hidden className={cn("invisible", keepsWhole(word) && "whitespace-nowrap")}>
                {word}
              </span>
            )}
          </Fragment>
        ))}
      </>
    );
  };
  const done = shown >= wordsOf(narrative);
  return (
    <div
      data-testid={reserve ? "narrative-reserve" : "narrative-text"}
      data-done={reserve ? undefined : done}
      aria-busy={reserve ? undefined : !done}
      aria-hidden={reserve || undefined}
      className={cn("flex flex-col gap-3", reserve && "invisible")}
    >
      <p className="text-base text-text-1">{part(0)}</p>
      <ol className="flex flex-col gap-1.5">
        {narrative.recommendations.map((_, i) => (
          <li key={i} className="flex gap-3 text-sm text-text-1">
            <span className="font-mono text-xs leading-5 text-text-3">{i + 1}</span>
            <span>{part(i + 1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
