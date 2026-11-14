// Coverage and unwatched routes on screen (issue 120): what the floor plan
// says about a setup, beside what the crew's attempts say. Read from
// `measureSetup`, so it needs no batch and follows every edit.
import { cn } from "@/lib/utils";
import { coverageLine, measureChange, routesLine, type SetupMeasure } from "./setup-measure";

/** The two lines, each number in mono: "Coverage: 53% of the floor…" and "Unwatched routes: 0 of 2…". */
export function MeasureLines({ measure, testId, className }: { measure: SetupMeasure; testId: string; className?: string }) {
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
    </div>
  );
}

/** One side's two numbers, short, for a card: "50% watched · 0/2 unwatched". */
export function MeasureChips({ measure, testId }: { measure: SetupMeasure; testId: string }) {
  return (
    <p
      data-testid={testId}
      data-coverage={measure.coverage}
      data-unwatched={measure.unwatched}
      title={`${coverageLine(measure)} ${routesLine(measure)}`}
      className="font-mono text-xs text-text-2 tabular-nums"
    >
      {measure.coverage}% watched · {measure.unwatched}/{measure.entries} unwatched
    </p>
  );
}

/** "Coverage 50% → 57%, unwatched routes 0 → 0.", with what each means under it. */
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

/** What the two numbers mean, in one line. */
export const MEASURE_NOTE = (m: Pick<SetupMeasure, "noun">) =>
  `Coverage is the share of the floor a camera or guard watches at some point in a night; an unwatched route is a way in that reaches the ${m.noun} without passing anything that ever watches. From the floor plan alone: no attempts played.`;
