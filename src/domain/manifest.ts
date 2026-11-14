// The level the Level Builder writes, cached server side (SPEC §4.1), and the
// mission library it picks from (SPEC §4.6). The manifest holds CoStar- and
// Vexcel-derived values and fiction only, never Matterport data: provenance
// has no `matterport` layer, and the manifest is strict, so a stray key such
// as a floor graph fails to parse.
import { z } from "zod";
import { AerialEntry } from "./aerial";
import { Casting } from "./casting";
import { checkUnique, City, Id, Text } from "./common";

/** Where a level element came from. `fiction` is game invention (the mission). */
export const ProvenanceLayer = z.enum(["costar", "vexcel", "fiction"]);
export type ProvenanceLayer = z.infer<typeof ProvenanceLayer>;

/**
 * One line of a Why card: the element it explains (for example `guard:G4`,
 * `zone:quiet-2202`, `entry:dock`), the layer and field it read, the value
 * there, and the rule that turned it into the element.
 */
export const Provenance = z.object({
  elementRole: Id,
  layer: ProvenanceLayer,
  field: Id,
  value: z.union([z.string(), z.number(), z.boolean()]),
  rule: Text,
});
export type Provenance = z.infer<typeof Provenance>;

/** The four security eras of the rules table (SPEC §4.3). */
export const Era = z.enum(["analog", "card", "networked", "smart"]);
export type Era = z.infer<typeof Era>;

export const CameraKind = z.enum(["analog-sweep", "ptz", "fixed-ip", "ip-analytics"]);
export type CameraKind = z.infer<typeof CameraKind>;

export const LockKind = z.enum(["key", "magstripe", "prox", "badge-pin"]);
export type LockKind = z.infer<typeof LockKind>;

export const SecurityProfile = z.object({
  era: Era,
  guardCount: z.int().positive(),
  /** Turns per guard hop: 1 is the tightest round. */
  patrolTempo: z.int().positive(),
  cameraKind: CameraKind,
  /** How many cameras the placer posts on the staged floor (SPEC §4.3, #13). */
  cameraCount: z.int().positive(),
  lockKind: LockKind,
});
export type SecurityProfile = z.infer<typeof SecurityProfile>;

export const ZoneRole = z.enum(["quiet", "crowded", "secure", "objective", "entry"]);
export type ZoneRole = z.infer<typeof ZoneRole>;

/**
 * A zone of the level. `id` and the game-fiction `name` are all the Crew and
 * the Chief ever see of the board (SPEC §4.5).
 */
export const Zone = z.object({
  id: Id,
  name: Text,
  role: ZoneRole,
  rule: Text,
  provenance: z.array(Provenance).min(1),
});
export type Zone = z.infer<typeof Zone>;

export const MissionType = z.enum(["heist", "prevent"]);
export type MissionType = z.infer<typeof MissionType>;

/** The documented event a mission is drawn from. */
export const InspiredBy = z.object({
  event: Text,
  /** As the mission card prints it: "June 5, 1974", "Oct 23 – Nov 9, 2001". */
  date: Text,
  sourceUrl: z.url(),
});
export type InspiredBy = z.infer<typeof InspiredBy>;

/**
 * A mission in the library (`fixtures/missions.json`). `inspiredBy` is null
 * for a fictional mission, which the card labels as fiction. `casting` is
 * what its stand-in building must have (SPEC §4.6).
 */
export const Mission = z.object({
  id: Id,
  city: City,
  type: MissionType,
  title: Text,
  inspiredBy: InspiredBy.nullable(),
  objective: Text,
  exitCondition: Text,
  casting: Casting,
});
export type Mission = z.infer<typeof Mission>;

/**
 * A library mission with the briefing the Game Master wrote for one building.
 * The manifest carries no casting: the building is already chosen.
 */
export const BriefedMission = Mission.omit({ casting: true }).extend({ briefing: Text });
export type BriefedMission = z.infer<typeof BriefedMission>;

/** An entry the level offers, chosen from the aerial's tags. */
export const LevelEntry = AerialEntry.pick({ id: true, kind: true, label: true });
export type LevelEntry = z.infer<typeof LevelEntry>;

/** The briefing's length limit, in words (the Game Master's rule, #119). */
export const BRIEFING_MAX_WORDS = 120;

/** The line every briefing carries (SPEC §1, taste rules): its security is game fiction. */
const GAME_FICTION = /\bgame[- ]fiction\b/i;

/** Words as a reader counts them: runs of non-space holding a letter or a digit, so a dash is not one. */
export const briefingWords = (briefing: string): number =>
  briefing.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * What is wrong with a briefing, in words the agent can act on; empty when
 * nothing is. Checked in code, so the length is counted, never self-reported.
 * Enforced where a level is written (`write_manifest`, `writeCachedLevel`),
 * not in the schema: a cached level is still read whatever its briefing.
 */
export function briefingProblems(briefing: string): string[] {
  const problems: string[] = [];
  const words = briefingWords(briefing);
  if (words > BRIEFING_MAX_WORDS) problems.push(`the briefing is ${words} words; the limit is ${BRIEFING_MAX_WORDS}`);
  if (!GAME_FICTION.test(briefing)) problems.push('the briefing must say its security is game fiction (the words "game fiction")');
  return problems;
}

/**
 * A level, keyed by building and mission (SPEC §4.1): `missionId` is the
 * mission it was built for, the same as `mission.id`.
 */
export const LevelManifest = z
  .strictObject({
    buildingId: Id,
    missionId: Id,
    securityProfile: SecurityProfile,
    zones: z.array(Zone).min(1),
    entries: z.array(LevelEntry).min(1),
    mission: BriefedMission,
    provenance: z.array(Provenance).min(1),
  })
  .superRefine((manifest, ctx) => {
    checkUnique(manifest.zones.map((zone) => zone.id), "zone", ["zones"], ctx);
    checkUnique(manifest.entries.map((e) => e.id), "entry", ["entries"], ctx);
    if (manifest.missionId !== manifest.mission.id) {
      ctx.addIssue({ code: "custom", path: ["missionId"], message: `missionId ${manifest.missionId} is not the mission's id ${manifest.mission.id}` });
    }
  });
export type LevelManifest = z.infer<typeof LevelManifest>;
