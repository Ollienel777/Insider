// What the Security Chief's one model call sees (SPEC §4.4, §4.5): the
// mission and security profile from the cached manifest, and the request's
// transition, zones and guard roster. The request carries no node,
// coordinate or adjacency (request.ts refuses one), so none can reach the
// prompt.
import type { LevelManifest } from "@/domain";
import { CHIEF_RATIONALE_MAX } from "@/domain";
import type { ChiefRequest } from "./request";

export const CHIEF_PROMPT_HEAD = "You are the night Security Chief in a Heist Anywhere level.";

export function chiefSystemPrompt(manifest: LevelManifest, request: ChiefRequest): string {
  const p = manifest.securityProfile;
  return `${CHIEF_PROMPT_HEAD}

The alarm just changed. Re-plan your guards. Give each guard you move one
order: hold, sweep, converge or block, and one zone id from the list below.
Converge on the last-known zone sends a guard onto the spot the intruder was
last seen. List zone ids to lock in lockZones. Use only these guard and zone
ids; never invent one. Then give your rationale in clipped radio style, at
most ${CHIEF_RATIONALE_MAX} characters, naming the guards and zones you moved.

Building: ${manifest.buildingId}. Mission: ${manifest.mission.title}.
Security: ${p.era} era, ${p.guardCount} guards, ${p.cameraKind} cameras, ${p.lockKind} locks.
Zones (id: name):
${request.zones.map((z) => `- ${z.id}: ${z.name}`).join("\n")}`;
}

export function chiefUserPrompt(request: ChiefRequest): string {
  const t = request.transition;
  const cause = t.cause.id ? `${t.cause.kind} ${t.cause.id}` : t.cause.kind;
  return `Turn ${t.turn}: alarm ${t.from} -> ${t.to} (${cause}).
Last known zone: ${request.lastKnownZone ?? "none"}.
Guards: ${request.guards.map((g) => `${g.id} in ${g.zoneId} (${g.intent})`).join("; ")}.`;
}

export function chiefMessages(manifest: LevelManifest, request: ChiefRequest) {
  return [
    { role: "system", content: chiefSystemPrompt(manifest, request) },
    { role: "user", content: chiefUserPrompt(request) },
  ];
}
