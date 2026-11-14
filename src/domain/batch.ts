// Owner Mode's batch (#126, epic #131): the crew proposes a handful of
// strategies in one structured call, and the engine plays each across a set
// of seeds. A strategy names only manifest ids (an entry, zones), never a
// node of the floor (SPEC §4.5); the browser resolves it on the board.
import { z } from "zod";
import { Id, Text } from "./common";

/**
 * When the crew moves off the entry: at once, or after a short seeded pause
 * (0-2 turns) with a deeper peek and more patience. Not a full guard round.
 */
export const StrategyTiming = z.enum(["immediate", "wait-for-round"]);
export type StrategyTiming = z.infer<typeof StrategyTiming>;

/**
 * How the planner weighs the way to the objective: the fewest moves, through
 * the quiet zones where it can, or around the cameras' cover.
 */
export const RoutePreference = z.enum(["shortest", "quiet-zones", "avoid-cameras"]);
export type RoutePreference = z.infer<typeof RoutePreference>;

/** How long the crew holds for a clear move before it goes anyway, and whether it sprints. */
export const RiskTolerance = z.enum(["low", "medium", "high"]);
export type RiskTolerance = z.infer<typeof RiskTolerance>;

export const STRATEGY_VIA_MAX = 2;
/** Short: five strategies must fit the fast call's 400-token budget (SPEC §4.5). */
export const STRATEGY_RATIONALE_MAX = 120;

/** One way in, as the crew proposes it. */
export const Strategy = z.object({
  /** A short slug, unique in the set. */
  id: Id.max(40),
  name: Text.max(40),
  /** An entry id of the manifest: where the crew comes in. */
  entryId: Id,
  /** An entry id of the manifest: where the crew leaves with the objective. */
  exitId: Id,
  timing: StrategyTiming,
  route: RoutePreference,
  /** Zone ids of the manifest to pass through on the way to the objective, in order. */
  via: z.array(Id).max(STRATEGY_VIA_MAX),
  risk: RiskTolerance,
  rationale: Text.max(STRATEGY_RATIONALE_MAX),
});
export type Strategy = z.infer<typeof Strategy>;

/** The crew's one answer: about five strategies. */
export const StrategySet = z.object({ strategies: z.array(Strategy).min(1).max(8) });
export type StrategySet = z.infer<typeof StrategySet>;

/** A strategy left out, and why. */
export const DroppedStrategy = z.object({ strategyId: z.string(), reason: Text });
export type DroppedStrategy = z.infer<typeof DroppedStrategy>;

/** What first noticed the player: a camera, guard or cleaner by id, or a guard that heard noise. */
export const Detector = z.object({
  kind: z.enum(["camera", "guard", "cleaner", "noise"]),
  id: z.string().optional(),
});
export type Detector = z.infer<typeof Detector>;

/** How a run ended: out with the objective, caught, or still inside at the turn cap. */
export const BatchOutcome = z.enum(["escaped", "caught", "timeout"]);
export type BatchOutcome = z.infer<typeof BatchOutcome>;

/** One attempt: one strategy on one seed. */
export const BatchRun = z.object({
  strategyId: Id,
  seed: z.int(),
  outcome: BatchOutcome,
  reachedObjective: z.boolean(),
  escaped: z.boolean(),
  turns: z.int().nonnegative(),
  /** The nodes the player stood on, from the entry, with repeats (waits) folded. Browser only. */
  route: z.array(Id).min(1),
  /** The turn the player was first noticed on; null when never. */
  firstDetectionTurn: z.int().nonnegative().nullable(),
  detectedBy: Detector.nullable(),
});
export type BatchRun = z.infer<typeof BatchRun>;

/** A strategy's attempts, summed. */
export const StrategyTally = z.object({
  strategyId: Id,
  runs: z.int().nonnegative(),
  escaped: z.int().nonnegative(),
  reachedObjective: z.int().nonnegative(),
  caught: z.int().nonnegative(),
  timeout: z.int().nonnegative(),
});
export type StrategyTally = z.infer<typeof StrategyTally>;

/** How often each element noticed the player first, most often first. */
export const DetectorTally = Detector.extend({ count: z.int().positive() });
export type DetectorTally = z.infer<typeof DetectorTally>;

export const BatchResult = z.object({
  buildingId: Id,
  seeds: z.array(z.int()).min(1),
  strategies: z.array(Strategy),
  /** Strategies the board could not play (an entry or zone not on this floor). */
  dropped: z.array(DroppedStrategy),
  /** Strategy-major: every seed of the first strategy, then the next. */
  runs: z.array(BatchRun),
  summary: z.object({
    runs: z.int().nonnegative(),
    escaped: z.int().nonnegative(),
    reachedObjective: z.int().nonnegative(),
    caught: z.int().nonnegative(),
    timeout: z.int().nonnegative(),
    byStrategy: z.array(StrategyTally),
    byDetector: z.array(DetectorTally),
  }),
});
export type BatchResult = z.infer<typeof BatchResult>;
