"use client";

// The radio in Live mode (issue 100): which one line is on the air. It makes
// no model call. It reads what the app already has, the crew's next plan
// step, the last turn's sighting or noise, and the Security Chief's re-plan as
// its stream reaches each sentence, and says one of them at a time:
//
// - The plan step is the line when nobody else is talking. A note (the sprint
//   hint, how the run ended) stands in for it while it applies.
// - A callout takes the air at once, and keeps it for its hold even when the
//   next turn is quiet, so a quick next move does not cut it off.
// - The Chief's lines follow in the order they streamed, each held for its
//   hold: the stream itself writes a sentence in a few hundred milliseconds,
//   too fast to read one line at a time. These are the Chief's own words, who
//   it sends where and why, so every sentence gets its turn. While the Chief
//   is being read out, a later callout waits; the danger meter shows it.
// - What it remembers belongs to one run. Restart starts from silence: a
//   callout still holding the air from the run before is not said again.
//
// Two layers: `tuneRadio`, `radioLine` and `radioWake` are pure, with the time
// passed in, so the order is tested without a timer; `useRadio` is the clock
// that drives them on the Run screen.
import { useEffect, useMemo, useRef, useState } from "react";

/** The shortest time a callout or a Chief line keeps the air before the next line may take it, in milliseconds. */
export const RADIO_HOLD_MS = 1300;
/** A long line keeps the air this much longer for each character, up to `RADIO_HOLD_MAX_MS`. */
const HOLD_PER_CHAR_MS = 22;
const RADIO_HOLD_MAX_MS = 4000;

/** How long a line keeps the air: `RADIO_HOLD_MS`, and longer for a line too long to read in that. */
export function radioHold(text: string): number {
  return Math.min(RADIO_HOLD_MAX_MS, Math.max(RADIO_HOLD_MS, text.length * HOLD_PER_CHAR_MS));
}

/** What a line is, which sets its speaker and its colour. */
export type RadioKind = "step" | "note" | "sighting" | "noise" | "chief";

/** One line on the radio. `tag` says where a Chief's line came from when no model wrote it. */
export interface RadioMessage {
  kind: RadioKind;
  text: string;
  tag?: string | null;
}

/** A sighting or a noise in words, and the turn it happened on. */
export interface RadioCallout {
  turn: number;
  kind: "sighting" | "noise";
  text: string;
}

/** The Chief's re-plan as the radio hears it. */
export interface RadioChief {
  /** Tells one answer from the next: any value that is the same for the same answer. */
  answer: unknown;
  /** The lines the stream has reached so far, in order. */
  lines: readonly string[];
  /** The stream has ended: no more lines are coming. */
  done: boolean;
  /** Where the answer came from, when not from a live model: "Recorded". */
  tag?: string | null;
}

/** What the radio could say, read off the app's state on every render. */
export interface RadioFacts {
  /**
   * Tells one run from the next: any value that is the same on every turn of
   * a run and different after Restart (the Run screen passes the run's board).
   * What the radio remembers belongs to one run, and is dropped with it.
   */
  run: unknown;
  /** The crew's next plan step; null when the plan has none left. */
  step: string | null;
  /** A line that stands in for the step while it applies; null otherwise. */
  note: string | null;
  /** The last turn's callout; null when nobody noticed the player on it. */
  callout: RadioCallout | null;
  /** The Chief's re-plan; null while the Chief has nothing to say. */
  chief: RadioChief | null;
}

/** What the radio remembers between renders: what went on the air, and until when it keeps it. */
export interface RadioState {
  /** The run this memory is of (`RadioFacts.run`). Nothing in it is said on another run. */
  run: unknown;
  /** The last callout to take the air, and when its hold ends. */
  callout: (RadioCallout & { until: number }) | null;
  /**
   * The Chief answer being read out. `index` is its line on the air: -1 before
   * the first, and the number of lines once the read-out is over. `until` is
   * when the next line may take the air.
   */
  chief: { answer: unknown; index: number; until: number } | null;
}

/** A radio that has said nothing yet, on no run. */
export const RADIO_SILENT: RadioState = { run: null, callout: null, chief: null };

/**
 * The radio as it joins a run already under way (the player chose Live
 * mid-run): a callout from the last turn goes on the air now, and whatever the
 * Chief has already said is not read out again.
 */
export function tuneIn(facts: RadioFacts, now: number): RadioState {
  const { callout, chief } = facts;
  const index = chief ? (chief.done ? chief.lines.length : chief.lines.length - 1) : -1;
  return {
    run: facts.run,
    callout: callout ? { ...callout, until: now + radioHold(callout.text) } : null,
    chief: chief ? { answer: chief.answer, index, until: now + radioHold(chief.lines[index] ?? "") } : null,
  };
}

/**
 * The radio's memory at time `now`, given what it could say. Returns `state`
 * itself when nothing changed. A new run (Restart, a level placed again)
 * starts from silence: a callout still holding the air from the run before,
 * and the Chief's read-out, are dropped with that run.
 */
export function tuneRadio(state: RadioState, facts: RadioFacts, now: number): RadioState {
  const sameRun = state.run === facts.run;
  const was = sameRun ? state : { ...RADIO_SILENT, run: facts.run };

  let callout = was.callout;
  if (facts.callout) {
    // A new turn's callout takes the air at once.
    if (callout?.turn !== facts.callout.turn || callout.text !== facts.callout.text) {
      callout = { ...facts.callout, until: now + radioHold(facts.callout.text) };
    }
  } else if (callout && now >= callout.until) {
    callout = null;
  }

  let chief: RadioState["chief"] = null;
  if (facts.chief) {
    const { answer, lines, done } = facts.chief;
    const read = was.chief;
    // A new answer starts unread. Its first line waits for the callout on the air to have its hold.
    const reading = read !== null && read.answer === answer ? read : { answer, index: -1, until: callout?.until ?? -Infinity };
    const next = reading.index + 1;
    if (now >= reading.until && next < lines.length) chief = { answer, index: next, until: now + radioHold(lines[next]) };
    // The last line has had its hold and no more are coming: the Chief is off the air.
    else if (now >= reading.until && done && reading.index < lines.length) chief = { answer, index: lines.length, until: now };
    else chief = reading;
  }

  return sameRun && callout === state.callout && chief === state.chief ? state : { run: facts.run, callout, chief };
}

/**
 * The one line on the air: the Chief's line being read out; else the callout
 * (this turn's, or the last one while it keeps its hold); else the note; else
 * the plan step. This turn's callout is read from `facts`, so it shows in the
 * same render as the turn, before the radio's clock has ticked. What `state`
 * remembers of another run is not said: a fresh run's first render already
 * has none of the last run's lines.
 */
export function radioLine(state: RadioState, facts: RadioFacts): RadioMessage | null {
  const mine = state.run === facts.run;
  const read = mine ? state.chief : null;
  const reading = facts.chief && read && read.answer === facts.chief.answer ? facts.chief.lines[read.index] : undefined;
  if (facts.chief && reading !== undefined) return { kind: "chief", text: reading, tag: facts.chief.tag ?? null };
  const callout = facts.callout ?? (mine ? state.callout : null);
  if (callout) return { kind: callout.kind, text: callout.text };
  if (facts.note) return { kind: "note", text: facts.note };
  return facts.step ? { kind: "step", text: facts.step } : null;
}

/** When `tuneRadio` next has something to change with the facts as they are; null when only new facts can change it. */
export function radioWake(state: RadioState, facts: RadioFacts): number | null {
  // A memory of another run is dropped on the next tune, whenever that is: nothing to wait for.
  if (state.run !== facts.run) return null;
  const wakes: number[] = [];
  if (state.callout && !facts.callout) wakes.push(state.callout.until);
  if (state.chief && facts.chief && state.chief.answer === facts.chief.answer) {
    const { lines, done } = facts.chief;
    const more = state.chief.index + 1 < lines.length || (done && state.chief.index < lines.length);
    if (more) wakes.push(state.chief.until);
  }
  return wakes.length > 0 ? Math.min(...wakes) : null;
}

/**
 * The line on the air on the Run screen. `facts` null turns the radio off
 * (Tactical, or no run on the board): nothing is timed, and the next time it
 * comes on it joins the run as it stands (`tuneIn`).
 */
export function useRadio(facts: RadioFacts | null): RadioMessage | null {
  const [state, setState] = useState<RadioState | null>(null);
  /** The same memory, where the clock's own callback reads it. */
  const latest = useRef<RadioState | null>(null);

  // The facts by value, so the clock below starts over only when one of them changes.
  const on = facts !== null;
  const run = facts?.run;
  const step = facts?.step ?? null;
  const note = facts?.note ?? null;
  const calloutTurn = facts?.callout?.turn;
  const calloutKind = facts?.callout?.kind;
  const calloutText = facts?.callout?.text;
  const answer = facts?.chief?.answer;
  const lines = facts?.chief?.lines.join("\n");
  const done = facts?.chief?.done;
  const tag = facts?.chief?.tag ?? null;
  const stable = useMemo<RadioFacts | null>(() => {
    if (!on) return null;
    const callout =
      calloutTurn !== undefined && calloutKind !== undefined && calloutText !== undefined
        ? { turn: calloutTurn, kind: calloutKind, text: calloutText }
        : null;
    const chief =
      lines !== undefined && done !== undefined ? { answer, lines: lines === "" ? [] : lines.split("\n"), done, tag } : null;
    return { run, step, note, callout, chief };
  }, [on, run, step, note, calloutTurn, calloutKind, calloutText, answer, lines, done, tag]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = performance.now();
      const was = latest.current;
      const next = stable ? (was ? tuneRadio(was, stable, now) : tuneIn(stable, now)) : null;
      latest.current = next;
      setState(next);
      const wake = next && stable ? radioWake(next, stable) : null;
      if (wake !== null) timer = setTimeout(tick, Math.max(0, wake - now));
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [stable]);

  return stable ? radioLine(state ?? RADIO_SILENT, stable) : null;
}
