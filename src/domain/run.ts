// One play-through, turn by turn (SPEC §4.1). Debrief replays it, and the
// Chief adapts from a summary of past runs. Kept in `localStorage`.
import { z } from "zod";
import { ChiefOrders } from "./agents";
import { Id } from "./common";

export const AlarmState = z.enum(["calm", "suspicious", "alert", "lockdown"]);
export type AlarmState = z.infer<typeof AlarmState>;

/** `sprint` covers two hops in one turn. */
export const PlayerActionKind = z.enum(["move", "sprint", "wait", "pick", "use", "take", "exit"]);
export type PlayerActionKind = z.infer<typeof PlayerActionKind>;

/** What the player did this turn, and the node they ended it on. */
export const PlayerAction = z.object({ kind: PlayerActionKind, nodeId: Id });
export type PlayerAction = z.infer<typeof PlayerAction>;

export const GuardPosition = z.object({ guardId: Id, nodeId: Id });
export type GuardPosition = z.infer<typeof GuardPosition>;

/** Where a Chief decision came from: a live model, a recorded reply, or the deterministic template. */
export const ChiefSource = z.enum(["model", "recorded", "template"]);
export type ChiefSource = z.infer<typeof ChiefSource>;

export const RunTurn = z.object({
  turn: z.int().nonnegative(),
  player: PlayerAction,
  guards: z.array(GuardPosition),
  alarm: AlarmState,
  /** Present on the turn the Chief's orders (and rationale) arrived. */
  chief: ChiefOrders.optional(),
  /** Where `chief` came from, as the Run screen received it. */
  chiefSource: ChiefSource.optional(),
});
export type RunTurn = z.infer<typeof RunTurn>;

/** How a run stands: still playing, out with the objective, or caught. */
export const RunOutcome = z.enum(["playing", "won", "caught"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

/** One alarm transition, as the engine records it (engine/alarm.ts `AlarmEvent`). */
export const RunAlarmEvent = z.object({
  turn: z.int().nonnegative(),
  from: AlarmState,
  to: AlarmState,
  lastKnownZone: Id.nullable(),
  cause: z.object({
    kind: z.enum(["camera", "guard", "cleaner", "noise", "decay", "set"]),
    id: Id.optional(),
  }),
});
export type RunAlarmEvent = z.infer<typeof RunAlarmEvent>;

/**
 * A Chief decision that arrived after the run had ended, as on the turn a
 * sighting both raised the alarm and the player was caught. The Run screen
 * showed it, but its orders never reached the guards.
 */
export const LateChief = z.object({
  /** The turns played when it arrived: the run's last frame. */
  turn: z.int().nonnegative(),
  chief: ChiefOrders,
  chiefSource: ChiefSource.optional(),
});
export type LateChief = z.infer<typeof LateChief>;

/**
 * The Chief's orders applied mid-run but not yet in a turn's entry: the next
 * turn's entry carries them (`RunTurn.chief`), so this rides on the log only
 * until the player moves. It lets the Debrief, opened between turns, list the
 * decision the guards are already acting on.
 */
export const PendingChief = z.object({
  /** The turns played when it was applied: the run's last frame, and the number of the turn that will log it. */
  turn: z.int().nonnegative(),
  chief: ChiefOrders,
  chiefSource: ChiefSource.optional(),
});
export type PendingChief = z.infer<typeof PendingChief>;

export const RunLog = z
  .object({
    buildingId: Id,
    missionId: Id,
    seed: z.int(),
    turns: z.array(RunTurn),
    /** How the run stood when the log was written. Absent from logs written before the Debrief (#22). */
    status: RunOutcome.optional(),
    /** Every alarm transition of the run, in order. Absent from logs written before the Debrief (#22). */
    alarmEvents: z.array(RunAlarmEvent).optional(),
    /** The Chief's answer that landed after the run ended, if one did. Its orders were never applied. */
    lateChief: LateChief.optional(),
    /** The Chief's orders applied to a run still being played, before a turn's entry carries them. */
    pendingChief: PendingChief.optional(),
    /**
     * The engine rules the run was played under (engine/log.ts `RUN_RULES`).
     * Absent from logs written before #94, whose engine applied the Chief's
     * orders at Calm too; from rules 2 on, orders given at Calm are dropped.
     */
    rules: z.int().positive().optional(),
  })
  .superRefine((log, ctx) => {
    log.turns.forEach((t, i) => {
      if (t.turn !== i) {
        ctx.addIssue({
          code: "custom",
          path: ["turns", i, "turn"],
          message: `turn ${i} is numbered ${t.turn}; turns are numbered 0, 1, 2… in order`,
        });
      }
    });
  });
export type RunLog = z.infer<typeof RunLog>;
