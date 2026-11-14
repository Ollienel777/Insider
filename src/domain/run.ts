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

export const RunTurn = z.object({
  turn: z.int().nonnegative(),
  player: PlayerAction,
  guards: z.array(GuardPosition),
  alarm: AlarmState,
  /** Present on the turn the Chief's orders (and rationale) arrived. */
  chief: ChiefOrders.optional(),
});
export type RunTurn = z.infer<typeof RunTurn>;

export const RunLog = z
  .object({
    buildingId: Id,
    missionId: Id,
    seed: z.int(),
    turns: z.array(RunTurn),
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
