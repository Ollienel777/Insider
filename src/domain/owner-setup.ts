// The owner's security setup (Owner Mode, SPEC §13, #28): the guards,
// cameras, door locks and staffed desks a building's owner says it really
// has, entered by hand in place of the rules table's generated security. It
// names floor-graph ids (nodes and doors) but holds none of the graph, and it
// stays in the owner's browser: never the server, a model or the repo.
//
// The schema checks the setup's shape only. Everything else, duplicate ids
// included, is the validator's job (src/level/owner-setup.ts), which answers
// with a typed error and a reason for each problem, so a setup being edited
// still parses and the editor can show every problem at once.
import { z } from "zod";
import { Id, Text } from "./common";

/**
 * The setup's format. A stored setup of another version does not parse. The
 * fields added since (cleaners, a camera's cover, the generated list) are
 * optional, so a setup saved before them still parses and plays as it did.
 */
export const OWNER_SETUP_VERSION = 1;

/** How a camera watches (SPEC §4.3): it sweeps two halves, cycles three PTZ presets, or holds one view. */
export const OwnerCameraKind = z.enum(["sweeping", "ptz", "fixed"]);
export type OwnerCameraKind = z.infer<typeof OwnerCameraKind>;

/** The way a camera points, on the floor plan: north is up the plan (towards lower y). */
export const Compass = z.enum(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
export type Compass = z.infer<typeof Compass>;

/** What closes a door: a key lock, a badge reader, or nothing (it stays open). */
export const OwnerDoorLock = z.enum(["key", "badge", "open"]);
export type OwnerDoorLock = z.infer<typeof OwnerDoorLock>;

export const OwnerGuard = z.object({
  id: Id,
  /** Where the guard stands at the start, and all night when it has no round. */
  post: Id,
  /**
   * The round, as an ordered loop of node ids: each node a neighbour of the
   * next, and the last of the first. The post is on it. Empty: the guard
   * stands its post.
   */
  round: z.array(Id),
  /** Turns per hop along the round: 1 is the tightest. */
  tempo: z.int().positive(),
  /**
   * Turns later than it would otherwise walk its round (negative: earlier),
   * as the Security Chief's retime says it: the guard starts that many nodes
   * further back along the round on every night, from wherever it starts that
   * night. Absent or 0: on time. A guard with no round ignores it.
   */
  retime: z.int().optional(),
});
export type OwnerGuard = z.infer<typeof OwnerGuard>;

export const OwnerCamera = z.object({
  id: Id,
  /** The node the camera is mounted over. */
  node: Id,
  kind: OwnerCameraKind,
  facing: Compass,
  /**
   * The nodes it watches, in sweep order. Absent, they are worked out from
   * the node, facing and kind. A camera taken from the generated security
   * keeps the rules table's cover here until it is moved, turned or changed.
   */
  cover: z.array(Id).min(1).optional(),
});
export type OwnerCamera = z.infer<typeof OwnerCamera>;

/**
 * A night cleaner: someone who walks a round all night and watches like a
 * guard, but whose sighting only raises suspicion and who never gives chase.
 * The round is a loop as a guard's is, walked from its first node at the
 * building's tempo; one node, and the cleaner stays there.
 */
export const OwnerCleaner = z.object({
  id: Id,
  round: z.array(Id).min(1),
});
export type OwnerCleaner = z.infer<typeof OwnerCleaner>;

/**
 * The elements still as the rules table placed them, by id. They keep the
 * data's provenance, and each walker on its generated round starts it where
 * the rules table starts it for the seed, so the untouched setup plays the
 * generated level exactly. An edit takes the element off its list.
 */
export const OwnerGenerated = z
  .object({
    guards: z.array(Id).optional(),
    cameras: z.array(Id).optional(),
    cleaners: z.array(Id).optional(),
    doors: z.array(Id).optional(),
  })
  .strict();
export type OwnerGenerated = z.infer<typeof OwnerGenerated>;

export const OwnerSetup = z
  .object({
    version: z.literal(OWNER_SETUP_VERSION),
    /** The owner's name for it, unique per building: "Night shift, 3 guards". */
    name: Text,
    buildingId: Id,
    guards: z.array(OwnerGuard),
    cameras: z.array(OwnerCamera),
    /** Door id → what closes it. A door left out is open. */
    doors: z.record(Id, OwnerDoorLock),
    /**
     * Nodes with a staffed desk: someone sits there all night. In the engine it is a cleaner that never
     * moves, so it never turns away and sees every node in its node's sightlines; seeing the player
     * raises the alarm to Suspicious, and it never catches anyone.
     */
    desks: z.array(Id),
    /** Night cleaners walking rounds. Absent: none. */
    cleaners: z.array(OwnerCleaner).optional(),
    generated: OwnerGenerated.optional(),
  })
  .strict();
export type OwnerSetup = z.infer<typeof OwnerSetup>;

/**
 * One line of a Why card for an element the owner placed. It names no data
 * layer: the owner's setup is not CoStar's, Vexcel's or Matterport's data, so
 * nothing it places may read as data-derived. `field` is where in the setup
 * the element is (`guards.G1`), `value` the setup's name.
 */
export const OwnerProvenance = z.object({
  elementRole: Id,
  layer: z.literal("owner"),
  field: Id,
  value: z.union([z.string(), z.number(), z.boolean()]),
  rule: Text,
});
export type OwnerProvenance = z.infer<typeof OwnerProvenance>;
