// What the crew's one model call sees (SPEC §4.4, §4.5). Under the Matterport
// terms the crew gets zone ids and the fiction names the manifest gave them,
// the guard roster and the alarm state: never a node, a coordinate, a room
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
  };
}

export function crewSystemPrompt(context: CrewContext): string {
  return `${CREW_PROMPT_HEAD}

The player gives you one plain-English order. Answer with a short numbered
plan as steps, each naming one zone id from the list below and what to do
there in under 15 words, second person, present tense. Use only these zone
ids; never invent one. Then push back in one or two sentences if the order
has a weakness, and give your confidence from 0 to 1.

Mission: ${context.mission}. Objective: ${context.objective}.
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
