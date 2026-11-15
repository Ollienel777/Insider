"use client";

// What the first-person view puts on the Run screen (issue 115): the Board /
// First person switch, and the view itself, loaded only when it is chosen so
// the board's page does not carry the renderer. The Run screen imports from
// here and nowhere else under fp/.
import dynamic from "next/dynamic";
import { Footprints, Grid3x3, type LucideIcon } from "lucide-react";
import type { FloorGraph } from "@/domain";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FP } from "./tuning";
import type { RunView, RunViewState } from "./view-store";

export { useRunView } from "./view-store";

/** The view, in its own bundle and never rendered on the server: it needs a canvas and WebGL. */
export const FirstPersonView = dynamic(() => import("./first-person-view"), {
  ssr: false,
  loading: () => <Skeleton data-testid="fp-loading" className="absolute inset-x-6 inset-y-0 rounded-md bg-surface-1" />,
});

/** The status line when first person cannot be drawn and the board comes back. */
/** First person's turn: short enough that the guards never seem to wait on the player (issue 115). */
export { FP_TURN_MS as FIRST_PERSON_TURN_MS } from "./tuning";

/** First person's pace, for the HUD to speak in seconds rather than hops and turns (`usePlayHud`). */
export const FIRST_PERSON_PACE = Object.freeze({ unitM: FP.unitM, runMps: FP.runMps, turnMs: FP.turnMs });

/** The turn the clock plays for first person, which the view supplies: the next pick while E is held, or a wait. */
export type HeldAction = (run: import("@/engine").RunState) => import("@/engine").Action;

/** A guard's bark or the crew's near miss on the radio line, in first person (issue 146). */
export { useBark, type Bark } from "./barks";

export const FP_UNAVAILABLE = "First person needs WebGL, which this browser isn't giving it. You're on the board.";

/**
 * Whether the Run screen shows first person: it was chosen, it can be drawn,
 * and the floor is a fixture floor. A floor from a live scan has no room
 * rectangles of ours to build walls from (and its own Inside view).
 */
export function firstPersonOn(state: RunViewState, floor: FloorGraph): boolean {
  return state.view === "first-person" && floor.source === "fixture";
}

const VIEWS: readonly { view: RunView; label: string; hint: string; icon: LucideIcon }[] = [
  { view: "board", label: "Board", hint: "Board: the floor from above, played by number keys", icon: Grid3x3 },
  { view: "first-person", label: "First person", hint: "First person: walk the floor with W, A, S, D and the mouse", icon: Footprints },
];

/**
 * The view switch: two buttons, one pressed. It sits over the top of the
 * board's area, towards the right, clear of the board's top bar, which is
 * full at 1280 px. The corners are spoken for: the mute button (PR 104) has
 * the top right one (`top-2 right-8`, about 70 px wide), the play mode switch
 * and the turn timer (PR 105) the bottom two, so this stands 128 px in from the
 * right edge, on the mute button's line. Nothing shows on a floor from a live
 * scan, or on a phone showing the board: first person needs a keyboard.
 */
export function ViewSwitch({ state, floor, className }: { state: RunViewState; floor: FloorGraph; className?: string }) {
  if (floor.source !== "fixture") return null;
  return (
    <div
      role="group"
      aria-label="View"
      data-testid="run-view"
      data-view={state.view}
      className={cn(
        "absolute top-2 z-10 flex rounded-sm bg-surface-1 shadow-e-1 max-md:left-3 md:right-32",
        // A phone is not offered first person, but one that remembers it keeps the way back to the board.
        state.view === "board" ? "max-md:hidden" : null,
        className,
      )}
    >
      {VIEWS.map(({ view, label, hint, icon: Icon }, i) => {
        const on = view === state.view;
        const off = view === "first-person" && state.unavailable;
        return (
          <button
            key={view}
            type="button"
            data-testid={`run-view-${view}`}
            aria-pressed={on}
            disabled={off}
            title={off ? "First person needs WebGL, which this browser isn't giving it" : hint}
            onClick={(event) => {
              state.choose(view);
              // The keys go to the view, not back to this button: Space would press it again.
              event.currentTarget.blur();
            }}
            className={cn(
              "relative inline-flex h-10 items-center justify-center gap-2 border px-3 text-sm font-medium select-none",
              "transition-colors duration-fast ease-out focus-visible:z-10 disabled:cursor-not-allowed disabled:text-text-3",
              "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
              i === 0 ? "rounded-l-sm" : "-ml-px rounded-r-sm",
              on
                ? "z-[1] border-border-strong bg-surface-3 text-text-1"
                : "border-border text-text-2 hover:bg-surface-3 hover:text-text-1",
            )}
          >
            <Icon aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
