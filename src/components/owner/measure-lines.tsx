// Coverage and unwatched routes on screen (issue 120): what the floor plan
// says about a setup, beside what the crew's attempts say. Read from
// `measureSetup`, so it needs no batch and follows every edit.
import { cn } from "@/lib/utils";
import { coverageLine, measureChange, routesLine, timingLine, type SetupMeasure } from "./setup-measure";

/**
 * The two lines, "Coverage: 47% of the floor…" and "Unwatched routes: 0 of
 * 2…", what they mean under them, and, beside a count where attempts got out
 * with no route unwatched, how they did it.
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
  return (
    <div
      data-testid={testId}
      data-coverage={measure.coverage}
      data-unwatched={measure.unwatched}
      data-entries={measure.entries}
      className={cn("flex flex-col gap-1 text-sm text-text-2", className)}
    >
      <p data-testid={`${testId}-coverage`}>{coverageLine(measure)}</p>
      <p data-testid={`${testId}-routes`}>{routesLine(measure)}</p>
      {timing ? (
        <p data-testid={`${testId}-timing`} className="text-text-1">
          {timing}
        </p>
      ) : null}
      <p data-testid={`${testId}-note`} className="text-xs">
        {MEASURE_NOTE(measure)}
      </p>
    </div>
  );
}

/** One side's two numbers, short, for a card: "43% watched · 0/2 ways in unwatched". */
export function MeasureChips({ measure, testId }: { measure: SetupMeasure; testId: string }) {
  return (
    <p
      data-testid={testId}
      data-coverage={measure.coverage}
      data-unwatched={measure.unwatched}
      title={`${coverageLine(measure)} ${routesLine(measure)}`}
      className="font-mono text-xs text-text-2 tabular-nums"
    >
      {measure.coverage}% watched · {measure.unwatched}/{measure.entries} ways in unwatched
    </p>
  );
}

/** "Coverage 43% → 50%, unwatched routes 0 → 0.", with what each means under it. */
export function MeasureChange({ from, to, testId }: { from: SetupMeasure; to: SetupMeasure; testId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p
        data-testid={testId}
        data-coverage-from={from.coverage}
        data-coverage-to={to.coverage}
        data-unwatched-from={from.unwatched}
        data-unwatched-to={to.unwatched}
        className="font-mono text-sm text-text-1 tabular-nums"
      >
        {measureChange(from, to)}.
      </p>
      <p className="text-xs text-text-2">{MEASURE_NOTE(to)}</p>
    </div>
  );
}

/** What the two numbers mean, in one line, and what they leave out. */
export const MEASURE_NOTE = (m: Pick<SetupMeasure, "noun">) =>
  `Coverage is the share of the floor a camera or guard watches at some point in every night the crew plays; a way in is unwatched if, on any of those nights, it has a route to the ${m.noun} that no camera or guard sees that night. From the floor plan alone, with no attempts played: it leaves out hearing and night cleaners, and being seen is not being caught.`;
