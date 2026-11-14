import { LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";

// The objective line (issue 100): where the player is going. A mono caps
// label, the goal in the mission's own words, and the hops left to it. It
// takes plain words and numbers and knows nothing about the board, so the
// first-person scan view shows the same line.

export interface ObjectiveLineProps {
  /** The mono caps label over the goal: "Objective", "Way out". */
  label: string;
  /** The goal, in a short line. */
  goal: string;
  /** Hops left to the goal. Null leaves the count out (no route, or nowhere left to go). */
  hops: number | null;
  /** Locked doors on the way, said beside the count. */
  locks?: number;
  /** A word beside the label once the objective is in hand: "Files taken". */
  taken?: string | null;
  /** What the player can do where they stand, in place of the count: "Take the files". */
  action?: { label: string; onAct: () => void; keyHint?: string } | null;
  className?: string;
}

export function ObjectiveLine({ label, goal, hops, locks = 0, taken = null, action = null, className }: ObjectiveLineProps) {
  return (
    <section aria-label="Objective" data-testid="objective-line" className={cn("flex min-w-0 items-center gap-4", className)}>
      <div className="min-w-0">
        <p className="flex items-center gap-2 label-caps text-text-3">
          {label}
          {taken ? (
            <span data-testid="objective-taken" className="text-success">
              {taken}
            </span>
          ) : null}
        </p>
        <p data-testid="objective-goal" className="mt-1 text-base font-medium text-text-1 md:truncate">
          {goal}
        </p>
      </div>
      {action ? (
        <button
          type="button"
          data-testid="objective-action"
          aria-keyshortcuts={action.keyHint}
          onClick={action.onAct}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-2 rounded-sm bg-accent px-3 text-sm font-medium text-accent-ink select-none",
            "transition-colors duration-fast ease-out hover:bg-accent-hover active:bg-accent-active",
          )}
        >
          {action.label}
          {action.keyHint ? (
            <kbd
              aria-hidden
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-accent-ink px-1 font-mono text-xs max-md:hidden"
            >
              {action.keyHint}
            </kbd>
          ) : null}
        </button>
      ) : hops !== null ? (
        <p data-testid="hops-left" data-hops={hops} data-locks={locks} className="flex shrink-0 items-baseline gap-2 border-l border-border pl-4">
          <span className="font-mono text-lg font-medium text-text-1">{hops}</span>
          <span className="label-caps text-text-2">{hops === 1 ? "hop" : "hops"}</span>
          {locks > 0 ? (
            <span data-testid="hops-locked" className="flex items-center gap-1 self-center label-caps text-text-2">
              <LockKeyhole aria-hidden className="size-4 stroke-[1.5]" />
              <span className="max-md:sr-only">{locks === 1 ? "locked door" : `${locks} locked doors`}</span>
            </span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
