// Coverage and open windows on screen (issue 120): what the floor plan
// says about a setup, beside what the crew's attempts say. Read from
// `measureSetup`, so it needs no batch and follows every edit.
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
      className={cn("flex flex-col gap-1 text-sm text-text-2", className)}
    >
      <p data-testid={`${testId}-coverage`}>{coverageLine(measure)}</p>
      <p data-testid={`${testId}-windows`}>{windowsLine(measure)}</p>
      {first ? (
        <p data-testid={`${testId}-first`} className="text-xs">
          {first}
        </p>
      ) : null}
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
      <p className="text-xs text-text-2">{MEASURE_NOTE(to)}</p>
    </div>
  );
}

/** What the two numbers mean, in one line, and what they leave out. */
export const MEASURE_NOTE = (m: Pick<SetupMeasure, "noun">) =>
  `Coverage is the share of the floor a camera or guard watches at some point in every night the crew plays; an open window is a way in and a turn of one of those nights from which a crew can take the ${m.noun} and get out without a guard or camera seeing it or a guard hearing it. From the floor plan alone, with no attempts played: it leaves out night cleaners, and being seen is not being caught.`;
