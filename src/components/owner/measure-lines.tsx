// Coverage and open windows on screen (issue 120): what the floor plan says
// about a setup, beside what the crew's attempts say. Read from
// `measureSetup`, so it needs no batch and follows every edit.
import { cn } from "@/lib/utils";
import { coverageLine, firstWindowLine, measureChange, windowsLine, type SetupMeasure } from "./setup-measure";

/** The lines, each number in mono: "Coverage: 53% of the floor…", "Open windows: 4 of 8 moments…", and which way the first goes. */
export function MeasureLines({ measure, testId, className }: { measure: SetupMeasure; testId: string; className?: string }) {
  const first = firstWindowLine(measure);
  return (
    <div
      data-testid={testId}
      data-coverage={measure.coverage}
      data-windows={measure.windows.open}
      data-moments={measure.windows.moments}
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
    </div>
  );
}

/** One side's two numbers, short, for a card: "50% watched · 4/8 open". */
export function MeasureChips({ measure, testId }: { measure: SetupMeasure; testId: string }) {
  return (
    <p
      data-testid={testId}
      data-coverage={measure.coverage}
      data-windows={measure.windows.open}
      data-moments={measure.windows.moments}
      title={`${coverageLine(measure)} ${windowsLine(measure)}`}
      className="font-mono text-xs text-text-2 tabular-nums"
    >
      {measure.coverage}% watched · {measure.windows.open}/{measure.windows.moments} open
    </p>
  );
}

/** "Coverage 50% → 57%, open windows 4 → 2.", with what each means under it. */
export function MeasureChange({ from, to, testId }: { from: SetupMeasure; to: SetupMeasure; testId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p
        data-testid={testId}
        data-coverage-from={from.coverage}
        data-coverage-to={to.coverage}
        data-windows-from={from.windows.open}
        data-windows-to={to.windows.open}
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
  `Coverage is the share of the floor a camera or guard watches at some point in a night; an open window is a way in and a turn of the night from which a crew can take the ${m.noun} and get out without a guard or camera seeing it or a guard hearing it. From the floor plan alone: no attempts played.`;
