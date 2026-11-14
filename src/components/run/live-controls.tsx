"use client";

// What Live mode puts on the Run screen (issue 99): the Tactical / Live switch
// and the turn timer. Both sit over corners of the board's area, where an
// isometric floor leaves room, so the board's top bar, which is already full
// at 1280 px, keeps its width. The state they show comes from play-mode.ts and
// turn-clock.ts.
import { Pause, Play, StepForward, Timer, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlayMode } from "./play-mode";
import { LIVE_TURN_MS, type LiveClock, type TurnClockState } from "./turn-clock";

/**
 * The switch and, in Live, the timer. Mount it inside the board's area (a
 * positioned box): the switch takes the bottom-right corner (the top-right on
 * a phone, where the board is small), the timer the bottom-left.
 */
export function LiveControls({
  mode,
  onChange,
  clock,
}: {
  mode: PlayMode;
  onChange: (mode: PlayMode) => void;
  clock: LiveClock;
}) {
  return (
    <>
      <PlayModeSwitch mode={mode} onChange={onChange} className="absolute right-6 max-md:top-3 md:bottom-3" />
      <TurnTimer clock={clock} className="absolute bottom-3 left-6" />
    </>
  );
}

const MODES: readonly { mode: PlayMode; label: string; hint: string; icon: LucideIcon }[] = [
  { mode: "tactical", label: "Tactical", hint: "Tactical: nothing moves until you do", icon: StepForward },
  { mode: "live", label: "Live", hint: "Live: a turn you let run out passes on its own", icon: Timer },
];

/**
 * The play mode switch: two buttons, one pressed. Tactical is the board as it
 * was; Live starts the turn clock. On a phone each button is its icon, and its
 * name stays for screen readers.
 */
export function PlayModeSwitch({
  mode,
  onChange,
  className,
}: {
  mode: PlayMode;
  onChange: (mode: PlayMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Play mode"
      data-testid="play-mode"
      data-mode={mode}
      className={cn("flex rounded-sm bg-surface-1 shadow-e-1", className)}
    >
      {MODES.map(({ mode: option, label, hint, icon: Icon }, i) => {
        const on = option === mode;
        return (
          <button
            key={option}
            type="button"
            data-testid={`play-mode-${option}`}
            aria-pressed={on}
            title={hint}
            onClick={() => onChange(option)}
            className={cn(
              "relative inline-flex h-10 min-w-10 items-center justify-center border text-sm font-medium select-none md:px-3",
              "transition-colors duration-fast ease-out focus-visible:z-10",
              "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
              i === 0 ? "rounded-l-sm" : "-ml-px rounded-r-sm",
              on
                ? "z-[1] border-border-strong bg-surface-3 text-text-1"
                : "border-border text-text-2 hover:bg-surface-3 hover:text-text-1",
            )}
          >
            <Icon aria-hidden className="md:hidden" />
            <span className="max-md:sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The clock's state in a word. Under `prefers-reduced-motion` the bar stands still, and this is what the timer says. */
export const CLOCK_LABEL: Readonly<Record<Exclude<TurnClockState, "off" | "over">, string>> = {
  running: "Running",
  paused: "Paused",
  held: "On hold",
};

/**
 * The turn timer: the clock's state in a word, a bar that drains over the
 * turn, and the pause button with its key. The bar is a CSS animation
 * (`.turn-drain`, globals.css) lasting `LIVE_TURN_MS`, started over on each
 * lap and frozen while the clock is not running, so it stops where the
 * countdown stopped. Nothing shows in Tactical, before a run is on the board,
 * or once it has ended.
 */
export function TurnTimer({ clock, className }: { clock: LiveClock; className?: string }) {
  const { state } = clock;
  if (state === "off" || state === "over") return null;
  const running = state === "running";
  const paused = state === "paused";
  return (
    <div
      data-testid="turn-timer"
      data-state={state}
      className={cn("flex rounded-sm border border-border bg-surface-1 shadow-e-1", className)}
    >
      <div className="flex h-10 flex-col justify-center gap-1.5 px-3">
        <p
          role="status"
          data-testid="turn-timer-state"
          className={cn("label-caps", running ? "text-text-2" : "text-text-1")}
        >
          {CLOCK_LABEL[state]}
        </p>
        <span aria-hidden className="block h-1 w-28 overflow-hidden bg-surface-3 max-md:w-20">
          <span
            // A new lap is a new element, so its animation starts from a full bar.
            key={clock.lap}
            data-testid="turn-timer-bar"
            className={cn("turn-drain block size-full", running ? "bg-accent" : "bg-n-400")}
            style={{ animationDuration: `${LIVE_TURN_MS}ms`, animationPlayState: running ? "running" : "paused" }}
          />
        </span>
      </div>
      <button
        type="button"
        data-testid="turn-pause"
        aria-label={paused ? "Resume the clock" : "Pause the clock"}
        aria-keyshortcuts="P"
        onClick={clock.togglePause}
        className={cn(
          "inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-r-sm border-l border-border select-none md:px-3",
          "text-text-2 transition-colors duration-fast ease-out hover:bg-surface-3 hover:text-text-1",
          "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
        )}
      >
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        <kbd
          aria-hidden
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-xs text-text-2 max-md:hidden"
        >
          P
        </kbd>
      </button>
    </div>
  );
}
