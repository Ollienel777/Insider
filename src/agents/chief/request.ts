// What the browser sends POST /api/chief on an alarm transition (SPEC §4.4,
// §4.5). Under the Matterport terms the Chief gets zone ids and their names,
// the guard roster with each guard's zone, and the transition: never a node,
// a coordinate or adjacency. Every object is strict, so a body that carries
// anything more is refused, not quietly passed on to a model. Shared by the
// route and the browser, so it imports nothing server-only.
import { z } from "zod";
import { AlarmState, ChiefOrders, GuardIntent } from "@/domain";

const ShortId = z.string().min(1).max(64);
const ShortName = z.string().min(1).max(80);

export const ChiefTransition = z.strictObject({
  turn: z.int().nonnegative(),
  from: AlarmState,
  to: AlarmState,
  cause: z.strictObject({
    kind: z.enum(["camera", "guard", "cleaner", "noise", "decay", "set"]),
    id: ShortId.optional(),
  }),
});
export type ChiefTransition = z.infer<typeof ChiefTransition>;

const ZoneCount = z.strictObject({ zoneId: ShortId, count: z.int().positive().max(99) });

/**
 * What the player did on their earlier runs of this building (#35), summed in
 * the browser from the run history it keeps: zone ids from `zones` and counts,
 * nothing else, so no node or coordinate can ride along. `posted` is the guard
 * the board already stood near the way in they used most, for the Chief to
 * account for on the radio.
 */
export const ChiefHistory = z.strictObject({
  runs: z.int().positive().max(99),
  /** The ways in they started from, most used first. */
  entries: z.array(ZoneCount).max(16),
  /** The ways out they left by, most used first. */
  exits: z.array(ZoneCount).max(16),
  /** The zones where they were seen, most often first. */
  detectedZones: z.array(ZoneCount).max(16),
  /** Noisy turns (sprints and picks) per run, to one decimal. */
  averageNoise: z.number().nonnegative().max(999),
  posted: z.strictObject({ guardId: ShortId, zoneId: ShortId }).optional(),
});
export type ChiefHistory = z.infer<typeof ChiefHistory>;

export const ChiefRequest = z.strictObject({
  buildingId: ShortId,
  transition: ChiefTransition,
  /** A zone id from `zones`; null when the player has never been detected. */
  lastKnownZone: ShortId.nullable(),
  guards: z
    .array(z.strictObject({ id: ShortId, zoneId: ShortId, intent: z.union([GuardIntent, z.literal("patrol")]) }))
    .min(1)
    .max(12),
  /** The zones the Chief may name: the manifest's, the entries, and the floor's other areas. */
  zones: z.array(z.strictObject({ id: ShortId, name: ShortName })).min(1).max(64),
  /** The player's earlier runs here; sent only with a run's first transition, and only when there were any. */
  history: ChiefHistory.optional(),
});
export type ChiefRequest = z.infer<typeof ChiefRequest>;

/** Where the Chief's orders came from. */
export type ChiefSource = "model" | "recorded" | "template";

/** What POST /api/chief answers. */
export interface ChiefAnswer {
  orders: ChiefOrders;
  /** True when no live model answered: fake mode, a timeout or a failure. */
  recorded: boolean;
  reason?: "fake mode" | "timeout" | "error";
  /** `recorded`: a recorded turn answered; `template`: the deterministic rules did, for a moment with no recording. */
  source: ChiefSource;
  /** The recorded turn's id, when one answered. */
  recording?: string;
}
