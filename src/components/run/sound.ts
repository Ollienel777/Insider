// The run's sound cues (issue 101): which sounds a change of run state calls
// for. This file is the mapping only: two run states in, a list of cues out.
// It makes no sound and touches no browser API, so it runs, and is tested,
// where Web Audio does not exist. sound-synth.ts turns a cue into sound.
import type { AlarmState } from "@/domain";
import { LEVELS, neighbours, shortestPath, type RunState } from "@/engine";

export type Cue =
  /** A footstep per hop: one for a move, two for a sprint (one if it was stopped half-way). */
  | { kind: "step"; hops: 1 | 2; sprint: boolean }
  /** A turn of picking a lock that has not opened yet. */
  | { kind: "pick" }
  /** The picked door opens. */
  | { kind: "unlock" }
  /** The objective is taken. */
  | { kind: "take" }
  /** A guard or a camera saw the player. Noise a guard heard, and a cleaner, are not this. */
  | { kind: "spotted" }
  | { kind: "alarm-rise"; to: AlarmState }
  | { kind: "alarm-fall"; to: AlarmState }
  /** Out with the objective: the run is won. */
  | { kind: "escape" }
  | { kind: "caught" }
  /** The nearest guard is `hops` hops away, within `PULSE_RANGE`. Closer is a quicker pulse. */
  | { kind: "pulse"; hops: number };

/** A guard further than this many hops away makes no pulse. */
export const PULSE_RANGE = 4;

/**
 * Whether `next` is `previous` played on: the same board, and no earlier
 * turn. A restart is not: it puts a fresh run on a board of its own.
 */
export function sameRun(previous: RunState, next: RunState): boolean {
  return next.board === previous.board && next.turn >= previous.turn;
}

/**
 * The cues for the change from `previous` to `next`, in the order they should
 * be heard: what the player did, who saw it, what the alarm did, how the run
 * ended, then the guard pulse.
 *
 * Nothing plays without a run on both sides, or across a restart: a fresh run
 * differs from the old one in everything, and none of it happened. The
 * footstep, the pick and the pulse are per turn, so a change between turns (the
 * Chief's orders landing) repeats none of them.
 */
export function cuesFor(previous: RunState | null, next: RunState | null): Cue[] {
  if (!previous || !next || !sameRun(previous, next)) return [];
  const cues: Cue[] = [];
  const turned = next.turn > previous.turn;

  if (turned) {
    const action = next.turns[next.turns.length - 1].player.kind;
    if (action === "move" || action === "sprint") {
      // A sprint never ends next to where it began, unless a guard stopped it on the way.
      const oneHop = neighbours(next.board, previous.playerNode).some((exit) => exit.to === next.playerNode);
      cues.push({ kind: "step", hops: action === "sprint" && !oneHop ? 2 : 1, sprint: action === "sprint" });
    } else if (action === "pick") {
      // A pick either leaves the door part-picked, or opens it (engine/actions.ts).
      cues.push({ kind: next.picking ? "pick" : "unlock" });
    }
  }
  if (next.carrying && !previous.carrying) cues.push({ kind: "take" });

  // A sighting below Lockdown always moves the alarm, and its event names what saw the player.
  // At Lockdown the alarm has nowhere to go, but only a sighting moves `lastSeen` there (engine/alarm.ts).
  const events = next.alarmEvents.slice(previous.alarmEvents.length);
  const bySight = events.some((event) => event.cause.kind === "guard" || event.cause.kind === "camera");
  const atLockdown = previous.alarm === "lockdown" && next.lastSeen !== null && next.lastSeen.turn >= previous.turn;
  if (bySight || (turned && atLockdown)) cues.push({ kind: "spotted" });

  const change = LEVELS.indexOf(next.alarm) - LEVELS.indexOf(previous.alarm);
  if (change > 0) cues.push({ kind: "alarm-rise", to: next.alarm });
  if (change < 0) cues.push({ kind: "alarm-fall", to: next.alarm });

  if (previous.status === "playing" && next.status === "won") cues.push({ kind: "escape" });
  if (previous.status === "playing" && next.status === "caught") cues.push({ kind: "caught" });

  if (turned && next.status === "playing") {
    const hops = hopsToNearestGuard(next);
    if (hops !== null && hops <= PULSE_RANGE) cues.push({ kind: "pulse", hops });
  }
  return cues;
}

/**
 * Hops from the player to the nearest guard, or null when no guard can reach
 * them. Guards carry keys, so a locked door is no further. Cleaners are not
 * guards: they never catch anyone.
 */
export function hopsToNearestGuard(run: RunState): number | null {
  const path = shortestPath(
    run.board,
    run.playerNode,
    run.guards.map((guard) => guard.nodeId),
  );
  return path ? path.length - 1 : null;
}
