// What the Security Chief's one model call sees (SPEC §4.4, §4.5): the
// mission and security profile from the cached manifest, and the request's
// transition, zones and guard roster. The request carries no node,
// coordinate or adjacency (request.ts refuses one), so none can reach the
// prompt.
import type { LevelManifest } from "@/domain";
import { CHIEF_RATIONALE_MAX } from "@/domain";
import type { ChiefRequest } from "./request";

export const CHIEF_PROMPT_HEAD = "You are the night Security Chief in a Hobbs level.";

export function chiefSystemPrompt(manifest: LevelManifest, request: ChiefRequest): string {
  const p = manifest.securityProfile;
  return `${CHIEF_PROMPT_HEAD}

The alarm just changed. Re-plan your guards. Give each guard you move one
order: hold, sweep, converge or block, and one zone id from the list below.
Converge on the last-known zone sends a guard onto the spot the intruder was
last seen. List the zone ids to lock in lockZones: lock what the intruder is
after, not the zones your own guards must pass through. Use only these guard
and zone ids; never invent one.

The rationale is what you say on the radio to your guards: clipped, plain
words, short sentences, no filler. Call zones by their names, never their
ids. Name each guard you moved. At most 160 characters, never more than
${CHIEF_RATIONALE_MAX}. Example of the voice: "Lost them by the freight
lift. G3 holds the dock. G1 and G2 sweep east to west. Lock the records room."

Building: ${manifest.buildingId}. Mission: ${manifest.mission.title}.
Security: ${p.era} era, ${p.guardCount} guards, ${p.cameraKind} cameras, ${p.lockKind} locks.
Zones (id: name):
${request.zones.map((z) => `- ${z.id}: ${z.name}`).join("\n")}`;
}

/** The earlier runs, as lines for the user prompt; empty without history. */
function historyLines(request: ChiefRequest): string {
  const h = request.history;
  if (!h) return "";
  const list = (items: { zoneId: string; count: number }[]) =>
    items.length ? items.map((i) => `${i.zoneId} x${i.count}`).join(", ") : "none";
  const posted = h.posted
    ? `\n${h.posted.guardId} started this run posted ${h.posted.startZone ? `in ${h.posted.startZone}, ` : ""}near ${h.posted.zoneId}, because of it. Open your rationale by saying so, in one short sentence, naming where it stands.`
    : "";
  return `\nThe intruder's earlier runs here: ${h.runs}. Came in by: ${list(h.entries)}. Left by: ${list(h.exits)}. Seen in: ${list(h.detectedZones)}. Noisy turns per run: ${h.averageNoise}.${posted}`;
}

export function chiefUserPrompt(request: ChiefRequest): string {
  const t = request.transition;
  const cause = t.cause.id ? `${t.cause.kind} ${t.cause.id}` : t.cause.kind;
  return `Turn ${t.turn}: alarm ${t.from} -> ${t.to} (${cause}).
Last known zone: ${request.lastKnownZone ?? "none"}.
Guards: ${request.guards.map((g) => `${g.id} in ${g.zoneId} (${g.intent})`).join("; ")}.${historyLines(request)}`;
}

export function chiefMessages(manifest: LevelManifest, request: ChiefRequest) {
  return [
    { role: "system", content: chiefSystemPrompt(manifest, request) },
    { role: "user", content: chiefUserPrompt(request) },
  ];
}
