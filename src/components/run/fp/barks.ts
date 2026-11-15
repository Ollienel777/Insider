"use client";

// What a guard says when it half-notices the player (issue 146): written
// lines for the radio line, no audio. Read from two run states, the turn
// before and the turn after, and from nothing the engine does not keep: on
// the turn the engine has a guard hear the player (a sprint or a pick within
// hearing range, below Alert), that guard asks who is there.
//
// A bark is the guard's voice for what the crew would call a noise. It never
// stands in for anything more:
//
// - A sighting is the crew's callout, as on the board, and so is a cleaner's
//   glimpse (the crew says the cleaner sees you). A turn somebody saw the
//   player on has no bark.
// - It takes the air only from the plan step or the crew's noise callout. A
//   sighting callout, a Chief's line or a note (how the run ended) takes it
//   back at once, and the bark is not said again after it.
// - One bark at a time, and none for `BARK_GAP_MS` after the last, so a door
//   picked turn after turn in a guard's hearing is one "Hello?", not a new
//   line every turn.
// - What it remembers belongs to one run: Restart starts from silence.
//
// Two layers, as radio.ts: `barkOf` and `tuneBark` are pure, with the time
// passed in; `useBark` is the clock that drives them on the Run screen.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RunState } from "@/engine";
import type { RadioKind, RadioMessage } from "../radio";
import { noiseCue } from "./notice";

export interface Bark {
  /** Tells one bark from the next: the turn it was said on, and who said it. */
  key: string;
  speaker: string;
  text: string;
  tone: "warning";
}

/** What a guard says on hearing the player, picked by the turn so a run reads the same each time. */
export const GUARD_BARKS = ["Hello?", "Who's there?", "Did you hear that?", "Someone there?"] as const;
/** How long a bark holds the radio line, in milliseconds. */
export const BARK_HOLD_MS = 1800;
/** How long after a bark the next may be said, in milliseconds. */
export const BARK_GAP_MS = 6000;

/** The bark the turn from `before` to `after` gives, or null. */
export function barkOf(before: RunState | null, after: RunState): Bark | null {
  if (!before || after.status !== "playing" || after.board !== before.board || after.turn !== before.turn + 1) return null;
  const turn = before.turn;
  // A sighting is not half-noticed: the crew calls it. A cleaner's look raises a transition of its own.
  if (after.alarmEvents.some((e) => e.turn === turn && (e.cause.kind === "camera" || e.cause.kind === "guard" || e.cause.kind === "cleaner"))) return null;
  const heard = noiseCue(after).heardBy[0];
  return heard ? { key: `${turn}:${heard}`, speaker: heard, text: GUARD_BARKS[turn % GUARD_BARKS.length], tone: "warning" } : null;
}

/** Whether the radio's own line leaves the air to a bark: only the plan step, a noise callout, or silence. */
export function barkMayTalk(radio: RadioKind | null): boolean {
  return radio === null || radio === "step" || radio === "noise";
}

/** What the barks remember: the run they belong to, the one on the air and until when, and when the last was said. */
export interface BarkState {
  run: unknown;
  bark: (Bark & { until: number }) | null;
  saidAt: number;
}

export const BARK_SILENT: BarkState = { run: null, bark: null, saidAt: -Infinity };

/**
 * The barks at time `now`: `run` tells one run from the next (the Run screen
 * passes the board), `heard` is a new turn's bark (`barkOf`) or null, and
 * `radio` the kind of line the radio would say. Returns `state` itself when
 * nothing changed.
 */
export function tuneBark(state: BarkState, run: unknown, heard: Bark | null, radio: RadioKind | null, now: number): BarkState {
  const was = state.run === run ? state : { ...BARK_SILENT, run };
  let { bark, saidAt } = was;
  // Its hold is over, or a line that outranks it has the air: it is not said again.
  if (bark && (now >= bark.until || !barkMayTalk(radio))) bark = null;
  if (heard && !bark && barkMayTalk(radio) && now - saidAt >= BARK_GAP_MS) {
    bark = { ...heard, until: now + BARK_HOLD_MS };
    saidAt = now;
  }
  return was === state && bark === state.bark ? state : { run, bark, saidAt };
}

/**
 * The bark on the air now, or null. Off (null throughout) when `on` is false,
 * so the board's radio is untouched. `radio` is the line the radio would say
 * without it.
 */
export function useBark(run: RunState | null, on: boolean, radio: RadioMessage | null): Bark | null {
  const last = useRef<RunState | null>(null);
  const [state, setState] = useState<BarkState>(BARK_SILENT);
  const kind = radio?.kind ?? null;

  // Each new run state brings the bark its turn gave, if any; a line that outranks the bark drops it.
  // Before the browser paints, so the crew's noise callout a bark stands in for is not drawn first.
  useLayoutEffect(() => {
    const before = last.current;
    last.current = run;
    if (!on || !run) return;
    const heard = before === run ? null : barkOf(before, run);
    setState((s) => tuneBark(s, run.board, heard, kind, performance.now()));
  }, [run, on, kind]);
  // The end of its hold.
  const until = state.bark?.until ?? null;
  const board = run?.board ?? null;
  useEffect(() => {
    if (until === null) return;
    const timer = setTimeout(() => setState((s) => tuneBark(s, board, null, kind, performance.now())), Math.max(0, until - performance.now()));
    return () => clearTimeout(timer);
  }, [until, board, kind]);

  if (!on || !run || state.run !== run.board || !barkMayTalk(kind)) return null;
  return state.bark;
}
