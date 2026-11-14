// What the crew's one model call sees (SPEC §4.4, §4.5). Under the Matterport
// terms the crew gets zone ids and the fiction names the manifest gave them,
// the guard roster, the security profile and the alarm state: never a node, a coordinate, a room
// of the scan or its adjacency. Everything here is built from the cached
// manifest, which holds no Matterport data, so nothing from the floor can
// reach the prompt.
import type { LevelManifest } from "@/domain";

/** The crew's view of the level. */
export interface CrewContext {
  buildingId: string;
  mission: string;
  objective: string;
  /** Zones and entries, by id and fiction name only. */
  zones: { id: string; name: string }[];
  guards: string[];
  alarm: "calm";
  /** The level's security profile, set from CoStar's facts in the manifest: nothing of the floor. */
  security: Pick<LevelManifest["securityProfile"], "era" | "cameraKind" | "cameraCount" | "lockKind">;
}

export const CREW_PROMPT_HEAD = "You are the crew for a Heist Anywhere job.";

/** The longest order the crew reads. */
export const ORDER_MAX = 400;

export function crewContext(manifest: LevelManifest): CrewContext {
  const zones = [
    ...manifest.entries.map((e) => ({ id: e.id, name: e.label })),
    ...manifest.zones.map((z) => ({ id: z.id, name: z.name })),
  ];
  return {
    buildingId: manifest.buildingId,
    mission: manifest.mission.title,
    objective: manifest.mission.objective,
    zones,
    guards: Array.from({ length: manifest.securityProfile.guardCount }, (_, i) => `G${i + 1}`),
    alarm: "calm",
    security: {
      era: manifest.securityProfile.era,
      cameraKind: manifest.securityProfile.cameraKind,
      cameraCount: manifest.securityProfile.cameraCount,
      lockKind: manifest.securityProfile.lockKind,
    },
  };
}

export function crewSystemPrompt(context: CrewContext): string {
  const s = context.security;
  return `${CREW_PROMPT_HEAD}

You talk on the crew's radio: clipped, plain words, no filler, no
pleasantries. The player gives you one plain-English order. Answer with:

- steps: three or four, in order. Each names one zone id from the list below
  and says what to do there in under 10 words, second person, present tense,
  calling the zone by its name, never its id. Example: "Wait one turn at the
  freight lift for the round to pass."
- pushback: the order's one real weakness, in one or two short sentences
  (under 30 words), naming the guard or zone behind it and what to do about
  it. Example: "A round may pass the dock. Wait one turn at the freight
  lift." Empty when the order is sound.
- confidence: from 0 to 1.

Use only these zone ids; never invent one. You know only what is listed
here: do not invent guards, cameras or rooms. You know how many cameras
there are, not where they are or what they cover, so never say which camera
watches a zone; the board marks camera cover itself.

Mission: ${context.mission}. Objective: ${context.objective}.
Security: ${s.era} era, ${s.cameraCount} ${s.cameraKind} cameras (C1 to C${s.cameraCount}), ${s.lockKind} locks.
Alarm: ${context.alarm}. Guards on the floor: ${context.guards.join(", ")}.
Zones (id: name):
${context.zones.map((z) => `- ${z.id}: ${z.name}`).join("\n")}`;
}

export function crewMessages(context: CrewContext, order: string) {
  return [
    { role: "system", content: crewSystemPrompt(context) },
    { role: "user", content: order },
  ];
}
