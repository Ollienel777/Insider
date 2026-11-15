// How long the guards keep after the player in real-time play (issue 219).
//
// The engine counts the alarm's memory in turns: three with no sighting and
// it drops a step (engine/alarm.ts). On the board those are three deliberate
// turns. In first person a turn is 0.7 s, so the guards gave up two seconds
// after losing the player, and a player who kept running was never caught.
// Here the memory is set in seconds and turned into turns for the mode's
// clock, and a guard that reaches the last-seen spot searches round it.
//
// Only real-time play asks for this (first person and Live). The turn-based
// board, autoplay and Owner Mode's odds play by the engine's own rules.
import type { Pursuit } from "@/engine";

/** Seconds with no sighting before the alarm drops a step, in real-time play. */
export const PURSUIT_HOLD_S = Object.freeze({
  suspicious: 8,
  alert: 10,
  /** The turn-based Lockdown never drops; in real time it falls back to Alert, so one bad stretch does not end the run. */
  lockdown: 15,
});

/** How many hops round the last-seen spot a guard searches once it has reached it. */
export const PURSUIT_SEARCH_HOPS = 2;

const made = new Map<number, Pursuit>();

/** The pursuit for a clock whose turn lasts `turnMs`: the same object for the same clock, so setting it twice changes nothing. */
export function realTimePursuit(turnMs: number): Pursuit {
  let pursuit = made.get(turnMs);
  if (!pursuit) {
    const turns = (seconds: number) => Math.max(3, Math.ceil((seconds * 1000) / turnMs));
    pursuit = Object.freeze({
      hold: Object.freeze({
        suspicious: turns(PURSUIT_HOLD_S.suspicious),
        alert: turns(PURSUIT_HOLD_S.alert),
        lockdown: turns(PURSUIT_HOLD_S.lockdown),
      }),
      searchHops: PURSUIT_SEARCH_HOPS,
    });
    made.set(turnMs, pursuit);
  }
  return pursuit;
}
