// Owner Mode's batch debrief (issue 127, epic issue 131): what a batch comes to,
// and the Security Chief's one suggested change to the setup. The browser
// sums a batch into a `BatchSummary` (node ids and all, it stays there) and
// sends the Chief only a `FixSummary`: counts, zone ids and element ids,
// never a node (SPEC §4.5). Every object the server reads is strict, so a
// body that carries anything more is refused, not passed on to a model.
import { z } from "zod";
import { BatchOutcome, Detector } from "./batch";
import { Id, Text } from "./common";

/** One cell of the outcome strip: one attempt, strategy-major as the batch played it. */
export const OutcomeCell = z.object({ strategyId: Id, seed: z.int(), outcome: BatchOutcome });
export type OutcomeCell = z.infer<typeof OutcomeCell>;

/** An element that noticed the player first, how often, and the turns it did. */
export const DetectorFinding = Detector.extend({
  count: z.int().positive(),
  /** The turns of first detection, ascending, each once. */
  turns: z.array(z.int().nonnegative()),
});
export type DetectorFinding = z.infer<typeof DetectorFinding>;

/** A batch, summed for the debrief. Browser only: `topRoute` holds node ids. */
export const BatchSummary = z.object({
  buildingId: Id,
  total: z.int().nonnegative(),
  escaped: z.int().nonnegative(),
  byStrategy: z.array(z.object({ strategyId: Id, runs: z.int().nonnegative(), escaped: z.int().nonnegative() })),
  /** The route the escapes took most often (node ids, from the entry), and how many took it. Null with no escape. */
  topRoute: z.object({ nodes: z.array(Id).min(1), count: z.int().positive() }).nullable(),
  /** Every element that noticed the player first, most often first. */
  detectors: z.array(DetectorFinding),
  /** One cell per attempt. */
  strip: z.array(OutcomeCell),
});
export type BatchSummary = z.infer<typeof BatchSummary>;

const ShortId = z.string().min(1).max(64);
const ShortName = z.string().min(1).max(80);

/** What the Chief reads about a batch: zone ids and element ids only. */
export const FixSummary = z.strictObject({
  total: z.int().nonnegative().max(400),
  escaped: z.int().nonnegative().max(400),
  byStrategy: z
    .array(z.strictObject({ strategyId: ShortId, runs: z.int().nonnegative().max(400), escaped: z.int().nonnegative().max(400) }))
    .max(8),
  /** The most common successful route as the zones it passed through, in order; null with no escape. */
  topRoute: z.strictObject({ zones: z.array(ShortId).min(1).max(24), count: z.int().positive().max(400) }).nullable(),
  detectors: z
    .array(
      z.strictObject({
        kind: Detector.shape.kind,
        id: ShortId.optional(),
        count: z.int().positive().max(400),
        turns: z.array(z.int().nonnegative().max(1000)).max(24),
      }),
    )
    .max(8),
  /** The zones the Chief may name: the manifest's, the entries, and the floor's other areas. */
  zones: z.array(z.strictObject({ id: ShortId, name: ShortName })).min(1).max(64),
});
export type FixSummary = z.infer<typeof FixSummary>;

/** The body of POST /api/chief/fix. */
export const FixRequest = z.strictObject({ buildingId: ShortId, summary: FixSummary });
export type FixRequest = z.infer<typeof FixRequest>;

/**
 * The one change the Chief suggests:
 * - `move-camera`: camera `elementId` now covers zone `to`;
 * - `retime-guard`: guard `elementId` walks its round `byTurns` turns later (earlier when negative);
 * - `lock-door`: every lockable door into zone `elementId` starts locked;
 * - `add-guard`: a new guard, `elementId`, walks zone `to`.
 */
export const FixKind = z.enum(["move-camera", "retime-guard", "lock-door", "add-guard"]);
export type FixKind = z.infer<typeof FixKind>;

export const FIX_RATIONALE_MAX = 200;
/** How far a retime may shift a round, either way. */
export const FIX_RETIME_MAX = 6;

/** Flat, so a model fills it easily; the clamp checks which fields each kind needs. */
export const FixChange = z.object({
  kind: FixKind,
  elementId: Id.max(64),
  to: Id.max(64).optional(),
  byTurns: z.int().optional(),
});
export type FixChange = z.infer<typeof FixChange>;

export const ChiefFix = z.object({ change: FixChange, rationale: Text.max(FIX_RATIONALE_MAX) });
export type ChiefFix = z.infer<typeof ChiefFix>;
