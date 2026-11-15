// Coverage and open windows on screen (issue 120): what the floor plan
// says about a setup, beside what the crew's attempts say. Read from
// `measureSetup`, so it needs no batch and follows every edit.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { coverageLine, firstWindowLine, measureChange, timingLine, windowsLine, type SetupMeasure } from "./setup-measure";

/**
 * The two lines, "Coverage: 47% of the floor…" and "Open windows: 7 of 80
 * moments…", which way the first window goes, what they mean under them, and,
 * beside a count where attempts got out with no window open, how they did it.
 */
export function MeasureLines({
  measure,
  testId,
  escaped,
  className,
}: {
  measure: SetupMeasure;
  testId: string;
  /** The attempts that got out, when the lines sit under a count. */
  escaped?: number;
  className?: string;
}) {
  const timing = escaped === undefined ? null : timingLine(measure, escaped);
  const first = firstWindowLine(measure);
  return (
    <div
      data-testid={testId}
      data-coverage={measure.coverage}
      data-windows={measure.windows.measured ? measure.windows.open : undefined}
      data-moments={measure.windows.measured ? measure.windows.moments : undefined}
      data-entries={measure.entries}
      className={cn("flex flex-col gap-2 text-sm text-text-2", className)}
    >
      {/* The two numbers at a glance; the sentences that say them in full fold under the tiles (issue 166). */}
      <dl className="grid grid-cols-2 gap-2">
        <MeasureTile term="Watched" value={`${measure.coverage}%`} note="of the floor, every night" />
        <MeasureTile
          term="Open windows"
          value={measure.windows.measured ? `${measure.windows.open} / ${measure.windows.moments}` : "—"}
          note={measure.windows.measured ? "moments to get in and out unseen" : "not measured on this floor"}
        />
      </dl>
      {timing ? (
        <p data-testid={`${testId}-timing`} className="text-text-1">
          {timing}
        </p>
      ) : null}
      <MeasureNote measure={measure} testId={`${testId}-note`}>
        <p data-testid={`${testId}-coverage`}>{coverageLine(measure)}</p>
        <p data-testid={`${testId}-windows`}>{windowsLine(measure)}</p>
        {first ? <p data-testid={`${testId}-first`}>{first}</p> : null}
      </MeasureNote>
    </div>
  );
}

/** One number in a small tile, as the Debrief's stats are drawn. */
function MeasureTile({ term, value, note }: { term: string; value: string; note: string }) {
  return (
    <div className="flex flex-col rounded-md border border-border bg-surface-2 px-3 py-2">
      <dt className="label-caps text-text-3">{term}</dt>
      <dd className="font-mono text-xl font-medium text-text-1 tabular-nums">{value}</dd>
      <dd className="text-xs text-text-2">{note}</dd>
    </div>
  );
}

/** One side's two numbers, short, for a card: "43% watched · 7/80 open", or "43% watched · windows not measured". */
export function MeasureChips({ measure, testId }: { measure: SetupMeasure; testId: string }) {
  return (
    <p
      data-testid={testId}
      data-coverage={measure.coverage}
      data-windows={measure.windows.measured ? measure.windows.open : undefined}
      data-moments={measure.windows.measured ? measure.windows.moments : undefined}
      title={`${coverageLine(measure)} ${windowsLine(measure)}`}
      className="font-mono text-xs text-text-2 tabular-nums"
    >
      {measure.coverage}% watched · {measure.windows.measured ? `${measure.windows.open}/${measure.windows.moments} open` : "windows not measured"}
    </p>
  );
}

/** "Coverage 43% → 50%, open windows 40 of 80 → 20 of 80.", with what each means under it. */
export function MeasureChange({ from, to, testId }: { from: SetupMeasure; to: SetupMeasure; testId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p
        data-testid={testId}
        data-coverage-from={from.coverage}
        data-coverage-to={to.coverage}
        data-windows-from={from.windows.measured ? from.windows.open : undefined}
        data-windows-to={to.windows.measured ? to.windows.open : undefined}
        className="font-mono text-sm text-text-1 tabular-nums"
      >
        {measureChange(from, to)}.
      </p>
      <MeasureNote measure={to} />
    </div>
  );
}

/**
 * What the two numbers mean, folded under a one-line summary: printed in full
 * under every count, its sixty words pushed the strategies and the Chief's fix
 * below the fold on Owner Mode's panel (issue 166). The text is unchanged.
 */
function MeasureNote({
  measure,
  testId,
  children,
}: {
  measure: Pick<SetupMeasure, "noun">;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <details className="text-xs text-text-2">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-sm hover:text-text-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 stroke-[1.5] transition-transform duration-fast [[open]>summary_&]:rotate-90" />
        What these numbers mean
      </summary>
      <div className="mt-1 flex flex-col gap-1">
        {children}
        <p data-testid={testId}>{MEASURE_NOTE(measure)}</p>
      </div>
    </details>
  );
}

/** What the two numbers mean, in one line, and what they leave out. */
export const MEASURE_NOTE = (m: Pick<SetupMeasure, "noun">) =>
  `Coverage is the share of the floor a camera or guard watches at some point in every night the crew plays; an open window is a way in and a turn of one of those nights from which a crew can take the ${m.noun} and get out without a guard or camera seeing it or a guard hearing it. From the floor plan alone, with no attempts played: it leaves out night cleaners, and being seen is not being caught.`;
