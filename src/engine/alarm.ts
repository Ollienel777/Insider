// The alarm machine (SPEC §4.3, D10): Calm → Suspicious → Alert → Lockdown.
//
// - A sighting by a guard or a camera raises the alarm to Alert, or from
//   Alert to Lockdown. A camera with analytics raises it one step more. A
//   turn's sightings count as one step, however many things saw the player.
// - Noise a guard hears, or a cleaner's sighting, raises it to Suspicious at
//   most.
// - Decay: the alarm drops one step after `HOLD` turns in a row with nothing
//   to hold it at its level (a sighting holds any level; noise or a cleaner
//   holds Suspicious). So Alert is held 3 turns after the last sighting.
//   Lockdown does not decay.
// - On reaching Alert or Lockdown, every guard is sent to the last-known
//   zone at once, before any Chief order; on decaying to Calm, every guard
//   goes back to its patrol.
//
// Every transition appends one `AlarmEvent`; the Chief (#20) re-plans on them.
import type { AlarmState } from "@/domain";
import { isAlert, guardOn, zoneOf, type RunState } from "./state";

/** What caused a transition. `id` names the camera, guard or cleaner, when there is one. */
export interface AlarmCause {
  kind: "camera" | "guard" | "cleaner" | "noise" | "decay" | "set";
  id?: string;
}

export interface AlarmEvent {
  /** The turn it happened on. A `setAlarm` between turns carries the next turn's number. */
  turn: number;
  from: AlarmState;
  to: AlarmState;
  /** The zone the player was last detected in, as the event leaves it; null if never. */
  lastKnownZone: string | null;
  cause: AlarmCause;
}

/** Something that noticed the player this turn, and where. */
export interface Detection {
  /** A sighting can raise Alert; a suspicion raises Suspicious at most. */
  strength: "sighting" | "suspicion";
  /** For a camera with analytics: one step more. */
  extraStep?: boolean;
  nodeId: string;
  cause: AlarmCause;
}

/** What has already happened to the alarm during the current turn. */
export interface TurnMarks {
  /** A sighting has already raised the alarm this turn. */
  sighted: boolean;
  /** Something held the alarm at its level this turn, so it does not decay. */
  held: boolean;
}

export const LEVELS: readonly AlarmState[] = ["calm", "suspicious", "alert", "lockdown"];

/** Turns in a row with nothing holding it before the alarm drops a step. Lockdown never drops. */
export const HOLD: Readonly<Partial<Record<AlarmState, number>>> = { suspicious: 3, alert: 3 };

const rank = (alarm: AlarmState) => LEVELS.indexOf(alarm);

/** The run after `detection`: the last-known zone moved to it, and the alarm raised if it raises. */
export function detect(run: RunState, detection: Detection, turn: number, marks: TurnMarks): RunState {
  const now = rank(run.alarm);
  let next = now;
  if (detection.strength === "sighting") {
    if (!marks.sighted) next = Math.max(now + 1, rank("alert")) + (detection.extraStep ? 1 : 0);
    marks.sighted = true;
    marks.held = true;
  } else {
    next = Math.max(now, rank("suspicious"));
    if (now <= rank("suspicious")) marks.held = true;
  }
  const seen = { ...run, lastKnown: zoneOf(run.board, detection.nodeId) };
  const to = LEVELS[Math.min(next, LEVELS.length - 1)];
  return to === run.alarm ? seen : transition(seen, to, turn, detection.cause);
}

/** The end of a turn: the alarm decays a step if nothing has held it for its hold. */
export function settle(run: RunState, turn: number, marks: TurnMarks): RunState {
  if (marks.held) return { ...run, alarmQuiet: 0 };
  const alarmQuiet = run.alarmQuiet + 1;
  const hold = HOLD[run.alarm];
  if (hold === undefined || alarmQuiet < hold) return { ...run, alarmQuiet };
  return transition(run, LEVELS[rank(run.alarm) - 1], turn, { kind: "decay" });
}

/**
 * Sets the alarm from outside a turn (a Chief decision, a drill, a test),
 * as a transition with cause `set`. Raising it to Alert or Lockdown sends the
 * guards to the last-known zone, and, with the player on a guard's node,
 * ends the run as caught.
 */
export function setAlarm(run: RunState, alarm: AlarmState): RunState {
  const next = alarm === run.alarm ? run : transition(run, alarm, run.turn, { kind: "set" });
  if (run.status === "playing" && isAlert(alarm) && guardOn(next.guards, [next.playerNode])) {
    return { ...next, status: "caught" };
  }
  return next;
}

/** Moves the alarm to `to`, logs the event, and applies what the new level does to the guards. */
function transition(run: RunState, to: AlarmState, turn: number, cause: AlarmCause): RunState {
  const event: AlarmEvent = { turn, from: run.alarm, to, lastKnownZone: run.lastKnown?.zoneId ?? null, cause };
  let { guards } = run;
  const { lastKnown } = run;
  if (rank(to) > rank(run.alarm) && isAlert(to) && lastKnown) {
    guards = guards.map((g) => ({ ...g, target: lastKnown }));
  } else if (to === "calm") {
    guards = guards.map((g) => ({ ...g, target: null }));
  }
  return { ...run, alarm: to, alarmQuiet: 0, guards, alarmEvents: [...run.alarmEvents, event] };
}
