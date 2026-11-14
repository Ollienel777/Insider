"use client";

// Live mode's turn clock (issue 99). The engine is turn-based and stays so: a
// turn is still one `act`. In Live the turn no longer waits for the player. It
// ends when they act, or after `LIVE_TURN_MS` when they don't, and the clock
// then plays the turn for them through the Run screen's own `play`: the same
// path a key takes, so a clock turn is logged, replayed, and can raise the
// alarm and call the Chief like any other.
//
// Three layers, the first two free of React so they run under fake timers:
// `clockAction` (which turn the clock plays), `createTurnClock` (the countdown,
// with its hold), and `useTurnClock` (what the Run screen mounts).
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Action, RunState } from "@/engine";

/**
 * How long a Live turn waits for the player, in milliseconds. One number for
 * the whole of Live mode: the first-person view needs about this long, since a
 * camera hop takes 0.7 to 1.1 s on screen.
 */
export const LIVE_TURN_MS = 1100;

/**
 * The turn the clock plays when the player lets one run out: a `wait`, or the
 * next `pick` of the lock they are part-way through, so a pick that takes two
 * turns is not thrown away by the clock between them. A door that has come
 * unlocked since (the Chief's lock lifting as the alarm decays) is not picked
 * again: the engine would refuse it, and the run would stand still.
 */
export function clockAction(run: RunState): Action {
  const doorId = run.picking?.doorId;
  return doorId !== undefined && run.locked.includes(doorId) ? { kind: "pick", doorId } : { kind: "wait" };
}

/** Whether `a` and `b` are the same turn of the same run. The Chief's orders landing mid-turn make a new state of the same turn. */
export function sameTurn(a: RunState | null, b: RunState | null): boolean {
  return a !== null && b !== null && a.board === b.board && a.turn === b.turn;
}

export interface TurnClock {
  /** Starts the countdown over with a whole turn left. A held clock stays held. */
  restart(): void;
  /** Holds the countdown where it is, or lets it run on from there. */
  hold(held: boolean): void;
  /** Milliseconds left in the turn. */
  left(): number;
  /** Ends the clock: nothing fires after this. */
  stop(): void;
}

/**
 * A countdown of `turnMs` that calls `onTimeout` each time it runs out, and
 * starts over by itself, so a turn the caller could not play (the engine
 * refused it) costs one lap and never stops the clock. It is made held:
 * `hold(false)` starts it. Held, it keeps the time it had left.
 */
export function createTurnClock(onTimeout: () => void, turnMs: number = LIVE_TURN_MS): TurnClock {
  let left = turnMs;
  /** When the running countdown was armed; null while held or stopped. */
  let since: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const disarm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    disarm();
    since = performance.now();
    timer = setTimeout(() => {
      // The next lap is armed before the handler runs: whatever it does, the clock goes on.
      left = turnMs;
      arm();
      onTimeout();
    }, left);
  };
  const remaining = () => (since === null ? left : Math.max(0, left - (performance.now() - since)));

  return {
    restart() {
      left = turnMs;
      if (since !== null) arm();
    },
    hold(held) {
      if (stopped || held === (since === null)) return;
      if (held) {
        left = remaining();
        since = null;
        disarm();
      } else {
        arm();
      }
    },
    left: remaining,
    stop() {
      stopped = true;
      left = remaining();
      since = null;
      disarm();
    },
  };
}

/**
 * What the clock is doing: `off` in Tactical and while no run is on the
 * board; `running`; `paused` by the player; `held` by a Why card or a hidden
 * tab; `over` once the run has ended.
 */
export type TurnClockState = "off" | "running" | "paused" | "held" | "over";

/** The clock as the Run screen's Live pieces see it (the timer now; the play HUD and the scan view next). */
export interface LiveClock {
  state: TurnClockState;
  /** Changes whenever the countdown starts over. The timer keys its bar on it. */
  lap: string;
  /** Pauses the clock, or resumes it: what `P` does. Does nothing while the clock is off or the run is over. */
  togglePause: () => void;
}

const WHY_CARD = '[data-testid="why-card"]';
const TYPING = "input, textarea, select, [contenteditable=true], [contenteditable='']";

const never = () => false;
const noWatch = () => () => {};

/** Tells `onChange` whenever a Why card may have opened or closed. The board owns the card; the page shows it. */
function watchWhyCard(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
const whyCardOpen = () => document.querySelector(WHY_CARD) !== null;

function watchTab(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const tabHidden = () => document.visibilityState === "hidden";

/**
 * The turn clock on the Run screen. In Tactical (`live` false) it is off:
 * nothing is timed, watched or listened for, and no key is claimed.
 *
 * In Live a countdown of `LIVE_TURN_MS` runs for each turn of `run`. A new
 * turn or a new run (the player acted, Restart, a level placed again) starts
 * it over; the Chief's orders landing mid-turn do not. When it runs out the
 * clock plays `clockAction` through `play`. `P` pauses and resumes, except
 * while typing. It also holds while a Why card is open and while the tab is
 * hidden, and it is done once the run has ended.
 */
export function useTurnClock({
  live,
  run,
  play,
}: {
  live: boolean;
  /** The run on the board; null while there is none. */
  run: RunState | null;
  /** The Run screen's one path for an action. The latest one is always the one called. */
  play: (action: Action) => void;
}): LiveClock {
  const [paused, setPaused] = useState(false);
  // Leaving Live drops the pause, so choosing Live again starts the clock.
  const [wasLive, setWasLive] = useState(live);
  if (wasLive !== live) {
    setWasLive(live);
    setPaused(false);
  }
  const whyOpen = useSyncExternalStore(live ? watchWhyCard : noWatch, live ? whyCardOpen : never, never);
  const hidden = useSyncExternalStore(live ? watchTab : noWatch, live ? tabHidden : never, never);

  const state: TurnClockState =
    !live || !run ? "off" : run.status !== "playing" ? "over" : paused ? "paused" : whyOpen || hidden ? "held" : "running";

  const clock = useRef<TurnClock | null>(null);
  /** The run state the countdown is running for. */
  const timed = useRef<RunState | null>(null);
  /** The last time the countdown ran out: which turn it ran out on, and how many times it has. */
  const [due, setDue] = useState<{ run: RunState | null; laps: number }>({ run: null, laps: 0 });

  // One clock for as long as the screen is mounted. Stopped on unmount, so a second mount (React's
  // strict mode in development) leaves one countdown, not two.
  useEffect(() => {
    const created = createTurnClock(() => setDue((was) => ({ run: timed.current, laps: was.laps + 1 })));
    clock.current = created;
    return () => {
      created.stop();
      clock.current = null;
    };
  }, []);

  const tracked = live ? run : null;
  useEffect(() => {
    if (!sameTurn(timed.current, tracked)) clock.current?.restart();
    timed.current = tracked;
  }, [tracked]);

  useEffect(() => {
    clock.current?.hold(state !== "running");
  }, [state]);

  // The clock's turn is played from an effect on the render that follows the timeout, not from the
  // timer's own callback. That render holds every update queued before it (the Chief's orders, the
  // player's own key), so `run` and `play` here are the latest: the turn is never played on a
  // state the screen has already left. A timeout for a turn the player ended first is dropped.
  const playDue = useEffectEvent((dueOn: RunState | null) => {
    if (state === "running" && run && sameTurn(dueOn, run)) play(clockAction(run));
  });
  useLayoutEffect(() => {
    if (due.laps > 0) playDue(due.run);
  }, [due]);

  const pausable = state === "running" || state === "paused" || state === "held";
  const togglePause = useCallback(() => {
    if (pausable) setPaused((was) => !was);
  }, [pausable]);

  useEffect(() => {
    if (!pausable) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "p" && event.key !== "P") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target?.closest?.(TYPING)) return;
      event.preventDefault();
      setPaused((was) => !was);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pausable]);

  return { state, lap: `${run?.turn ?? 0}:${due.laps}`, togglePause };
}
