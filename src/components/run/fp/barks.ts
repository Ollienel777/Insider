"use client";

// What a guard says when it half-notices the player (issue 146): written
// lines for the radio line, no audio. Read from two run states, the turn
// before and the turn after, and from nothing the engine does not keep: on
// the turn the engine has a guard hear the player (a sprint or a pick within
// hearing range), or a cleaner glimpse them. A suspicion, not a sighting: a
// full sighting is the crew's callout, as on the board.
import { useEffect, useRef, useState } from "react";
import type { RunState } from "@/engine";
import { noiseCue } from "./notice";

export interface Bark {
  /** Tells one bark from the next: the turn it was said on, and what. */
  key: string;
  speaker: string;
  text: string;
  tone: "warning";
}

/** What a guard says on hearing the player, picked by the turn so a run reads the same each time. */
export const GUARD_BARKS = ["Hello?", "Who's there?", "Did you hear that?", "Someone there?"] as const;
export const CLEANER_BARKS = ["Is someone there?", "Hello? Security?"] as const;
/** How long a bark holds the radio line, in milliseconds. */
export const BARK_HOLD_MS = 1800;

/** The bark the turn from `before` to `after` gives, or null. */
export function barkOf(before: RunState | null, after: RunState): Bark | null {
  if (!before || after.status !== "playing" || after.board !== before.board || after.turn !== before.turn + 1) return null;
  const turn = before.turn;
  const events = after.alarmEvents.filter((e) => e.turn === turn);
  // A sighting is not half-noticed: the crew calls it.
  if (events.some((e) => e.cause.kind === "camera" || e.cause.kind === "guard")) return null;
  const heard = noiseCue(after).heardBy[0];
  if (heard) return { key: `${turn}:${heard}`, speaker: heard, text: GUARD_BARKS[turn % GUARD_BARKS.length], tone: "warning" };
  const cleaner = events.find((e) => e.cause.kind === "cleaner")?.cause.id;
  if (cleaner) return { key: `${turn}:${cleaner}`, speaker: cleaner, text: CLEANER_BARKS[turn % CLEANER_BARKS.length], tone: "warning" };
  return null;
}

/**
 * The bark on the air now: each new one for `BARK_HOLD_MS`, then null. Off
 * (null throughout) when `on` is false, so the board's radio is untouched.
 */
export function useBark(run: RunState | null, on: boolean): Bark | null {
  const last = useRef<RunState | null>(null);
  const [bark, setBark] = useState<Bark | null>(null);
  useEffect(() => {
    const before = last.current;
    last.current = run;
    if (!on || !run) return;
    const next = barkOf(before, run);
    if (next) setBark(next);
  }, [run, on]);
  useEffect(() => {
    if (!bark) return;
    const timer = setTimeout(() => setBark(null), BARK_HOLD_MS);
    return () => clearTimeout(timer);
  }, [bark]);
  return on ? bark : null;
}
