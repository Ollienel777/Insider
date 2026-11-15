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
 * The alarm beat (issue 222): the turn after a sighting first raises the alarm
 * to Alert or Lockdown waits at least this long for the player, in
 * milliseconds. The guards were sent converging on the sighting turn and the
 * Chief re-plans on it; without the beat the next one or two turns, 0.7 s
 * each in first person, catch the player before the radio has read the
 * re-plan. With it, the sighting's callout, then the Chief's re-plan, are on
 * the air and the guards move on his orders before a capture can end the run.
 * It is time, not a turn: the engine, and so the log, the Debrief's replay and
 * Owner Mode's runs, are the same turns either way. It never waits on the
 * Chief: the beat is the same length whether his answer is in or not.
 */
export const ALARM_BEAT_MS = 2500;

/** Whether the turn just played raised the alarm into Alert or Lockdown from below them: the turn the beat follows. */
export function alarmBeat(run: RunState | null): boolean {
  if (!run) return false;
  const high = (alarm: string) => alarm === "alert" || alarm === "lockdown";
  return run.alarmEvents.some((e) => e.turn === run.turn - 1 && !high(e.from) && high(e.to));
}

/** How long the clock gives the turn `run` is on: `turnMs`, or the alarm beat after a sighting that raised the alarm. */
export function turnLength(run: RunState | null, turnMs: number): number {
  return alarmBeat(run) ? Math.max(turnMs, ALARM_BEAT_MS) : turnMs;
}

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
  /** Starts the countdown over with a whole turn left, or `ms` for this one turn (the alarm beat). A held clock stays held. */
  restart(ms?: number): void;
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
    restart(ms) {
      left = ms ?? turnMs;
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
 * board; `running`; `paused` by the player; `held` by a Why card, a hidden
 * tab or the caller; `over` once the run has ended.
 */
export type TurnClockState = "off" | "running" | "paused" | "held" | "over";

/**
 * The clock's state, from what the screen knows. Tactical is the clock
 * switched off, whatever else is true. A run that has ended is over, paused
 * or not; the player's pause shows over a hold, since it is the one they
 * have to lift themselves.
 */
export function clockState({
  live,
  run,
  paused,
  held,
}: {
  live: boolean;
  run: RunState | null;
  /** The player paused it. */
  paused: boolean;
  /** Something else holds it: a Why card, a hidden tab, the caller. */
  held: boolean;
}): TurnClockState {
  if (!live || !run) return "off";
  if (run.status !== "playing") return "over";
  if (paused) return "paused";
  return held ? "held" : "running";
}

/**
 * The first move (issue 171): in first person the clock waits for the player
 * to move before it plays a turn, so they can look around first. It is one
 * more hold beside the others, lifted by the player rather than by the
 * screen: while it waits the clock plays nothing, so the run log and the
 * Debrief's replay hold only the turns that were played.
 *
 * It waits again on entering first person and on a restart (the turn number
 * going back). A turn the player plays while it waits (a number key, a walk
 * into the next node) is their first move too.
 */
export interface FirstMove {
  /** Waiting for a first move is asked for: in first person. */
  readonly on: boolean;
  /** The player has moved since it was asked for. */
  readonly moved: boolean;
  readonly board: unknown;
  readonly turn: number;
}

export const NO_FIRST_MOVE: FirstMove = { on: false, moved: false, board: null, turn: 0 };

/** The first move as the run stands now. The same object when nothing changed, so a caller can keep it in state. */
export function followRun(was: FirstMove, on: boolean, run: RunState | null): FirstMove {
  const board = run?.board ?? null;
  const turn = run?.turn ?? 0;
  if (was.on === on && was.board === board && was.turn === turn) return was;
  const fresh = !was.on || was.board !== board || turn < was.turn;
  const moved = on && !fresh && (was.moved || turn > was.turn);
  return { on, moved, board, turn };
}

/** The keys that are a first move: W A S D and ↑ ↓ walk, E uses. Looking (the mouse, ← →) is not. */
export const FIRST_MOVE_KEYS: ReadonlySet<string> = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "KeyE"]);

/**
 * The first move after a key. A key only counts while nothing else holds the
 * clock: another hold (the scan's picture still coming in) comes first, and
 * the wait for the first move starts once it lifts.
 */
export function pressKey(was: FirstMove, code: string, heldElsewhere: boolean): FirstMove {
  if (!was.on || was.moved || heldElsewhere || !FIRST_MOVE_KEYS.has(code)) return was;
  return { ...was, moved: true };
}

/** Whether the clock is waiting for the first move. */
export const awaitingMove = (gate: FirstMove): boolean => gate.on && !gate.moved;

/** The clock as the Run screen's Live pieces see it (the timer now; the play HUD and the scan view next). */
export interface LiveClock {
  state: TurnClockState;
  /** Held only for the player's first move, with nothing else holding it: what the first-person hint says. */
  awaitingMove: boolean;
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
 * it over, for `ALARM_BEAT_MS` after a sighting that raised the alarm; the
 * Chief's orders landing mid-turn do not. When it runs out the
 * clock plays `clockAction` through `play`. `P` pauses and resumes, except
 * while typing. It also holds while a Why card is open, while the tab is
 * hidden and while the caller says `hold`, then, with `startOnMove`, until
 * the player's first move; and it is done once the run has ended. It never holds for the Security Chief: his orders apply on the turn
 * they land.
 */
export function useTurnClock({
  live,
  run,
  play,
  hold = false,
  turnMs = LIVE_TURN_MS,
  action,
  startOnMove = false,
}: {
  live: boolean;
  /** The run on the board; null while there is none. */
  run: RunState | null;
  /** The Run screen's one path for an action. The latest one is always the one called. */
  play: (action: Action) => void;
  /**
   * Holds the countdown from outside for as long as it is true, keeping the time left: for a
   * view that needs the turn to wait for it, as the scan view's camera does while it travels.
   */
  hold?: boolean;
  /** The turn's length: `LIVE_TURN_MS` unless a view needs its own (first person's is shorter). */
  turnMs?: number;
  /** The turn the clock plays when one runs out, in place of `clockAction`: first person picks only while E is held. */
  action?: (run: RunState) => Action;
  /** Holds the clock until the player's first move (`FIRST_MOVE_KEYS`, or a turn they play): first person's look around. */
  startOnMove?: boolean;
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

  // The first move is one hold among the others, and waits behind them (issue 171).
  const [firstMove, setFirstMove] = useState(NO_FIRST_MOVE);
  const followed = followRun(firstMove, live && startOnMove, run);
  if (followed !== firstMove) setFirstMove(followed);
  const heldElsewhere = whyOpen || hidden || hold;
  const waiting = awaitingMove(followed);

  const state = clockState({ live, run, paused, held: heldElsewhere || waiting });

  const listening = waiting && !heldElsewhere && state !== "off" && state !== "over";
  useEffect(() => {
    if (!listening) return;
    // In the capture phase, ahead of first person's own handler, which marks the keys it takes as handled.
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if ((event.target as Element | null)?.closest?.(TYPING)) return;
      setFirstMove((was) => pressKey(was, event.code, false));
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening]);

  const clock = useRef<TurnClock | null>(null);
  /** The run state the countdown is running for. */
  const timed = useRef<RunState | null>(null);
  /** The last time the countdown ran out: which turn it ran out on, and how many times it has. */
  const [due, setDue] = useState<{ run: RunState | null; laps: number }>({ run: null, laps: 0 });

  // One clock for as long as the screen is mounted. Stopped on unmount, so a second mount (React's
  // strict mode in development) leaves one countdown, not two.
  useEffect(() => {
    const created = createTurnClock(() => setDue((was) => ({ run: timed.current, laps: was.laps + 1 })), turnMs);
    clock.current = created;
    return () => {
      created.stop();
      clock.current = null;
    };
  }, [turnMs]);

  const tracked = live ? run : null;
  useEffect(() => {
    // The turn after a sighting that raised the alarm is the alarm beat's length (issue 222).
    if (!sameTurn(timed.current, tracked)) clock.current?.restart(turnLength(tracked, turnMs));
    timed.current = tracked;
  }, [tracked, turnMs]);

  // A new turn length makes a new clock, which starts held: release it here too.
  useEffect(() => {
    clock.current?.hold(state !== "running");
  }, [state, turnMs]);

  // The clock's turn is played from an effect on the render that follows the timeout, not from the
  // timer's own callback. That render holds every update queued before it (the Chief's orders, the
  // player's own key), so `run` and `play` here are the latest: the turn is never played on a
  // state the screen has already left. A timeout for a turn the player ended first is dropped.
  const playDue = useEffectEvent((dueOn: RunState | null) => {
    if (state === "running" && run && sameTurn(dueOn, run)) play((action ?? clockAction)(run));
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

  return { state, awaitingMove: listening && state === "held", lap: `${run?.turn ?? 0}:${due.laps}`, togglePause };
}
