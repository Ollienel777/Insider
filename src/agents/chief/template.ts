// The Chief's deterministic template (SPEC §4.4, §4.5): orders built from
// the request alone, for a transition with no recorded turn. Same request,
// same orders. It knows zones, not the floor, so it plans by role: close on
// the last-known zone, cover the objective and the way out.
import { CHIEF_RATIONALE_MAX, type ChiefOrders, type GuardOrder, type LevelManifest } from "@/domain";
import type { ChiefRequest } from "./request";

/** The guard ids as a phrase: "G1", "G1 and G2", "G1, G2 and G3". */
function together(ids: readonly string[]): string {
  return ids.length <= 1 ? (ids[0] ?? "") : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
}

/** What raised the alarm, in the Chief's words. */
function contact(request: ChiefRequest, where: string): string {
  const { kind, id } = request.transition.cause;
  switch (kind) {
    case "camera":
      return `${id ?? "A camera"} has them in the ${where}`;
    case "guard":
      return `${id ?? "A guard"} has eyes on them in the ${where}`;
    case "cleaner":
      return `A cleaner saw someone in the ${where}`;
    case "noise":
      return `${id ?? "A guard"} heard something in the ${where}`;
    default:
      return `Contact in the ${where}`;
  }
}

export function chiefTemplate(manifest: LevelManifest, request: ChiefRequest): ChiefOrders {
  const zones = new Map(request.zones.map((z) => [z.id, z.name]));
  const name = (id: string) => zones.get(id) ?? id;
  const objective = manifest.zones.find((z) => z.role === "objective" && zones.has(z.id))?.id ?? null;
  const exit = manifest.entries.find((e) => zones.has(e.id))?.id ?? null;
  const lastKnown = request.lastKnownZone && zones.has(request.lastKnownZone) ? request.lastKnownZone : null;
  const roster = request.guards.map((g) => g.id);
  const { from, to } = request.transition;

  let orders: GuardOrder[] = [];
  let lockZones: string[] = [];
  const lines: string[] = [];

  if (to === "calm") {
    lines.push("All quiet. Everyone back on rounds.");
  } else if (!lastKnown) {
    lines.push("No contact to work from. Hold your rounds and report.");
  } else if (to === "alert" || to === "lockdown") {
    const where = name(lastKnown);
    const chasers = roster.slice(0, Math.max(1, Math.ceil(roster.length / 2)));
    const rest = roster.slice(chasers.length);
    orders = chasers.map((guardId) => ({ guardId, intent: "converge", zoneId: lastKnown }));
    lines.push(`${contact(request, where)}.`, `${together(chasers)} converge on it.`);
    const [blocker, holder] = rest;
    if (blocker && exit && exit !== lastKnown) {
      orders.push({ guardId: blocker, intent: "block", zoneId: exit });
      lines.push(`${blocker} blocks the ${name(exit)}.`);
    }
    if (holder && objective && objective !== lastKnown) {
      orders.push({ guardId: holder, intent: "hold", zoneId: objective });
      lines.push(`${holder} holds the ${name(objective)}.`);
    }
    if (objective && objective !== lastKnown) {
      lockZones = [objective];
      lines.push(`Lock the ${name(objective)}.`);
    }
    if (from === to) lines.unshift("Still in lockdown.");
  } else {
    // Suspicious: on the way up, one guard checks; on the way down, two sweep where they were lost.
    const where = name(lastKnown);
    const sweepers = roster.slice(0, from === "calm" ? 1 : 2);
    orders = sweepers.map((guardId) => ({ guardId, intent: "sweep", zoneId: lastKnown }));
    lines.push(
      from === "calm" ? `${contact(request, where)}.` : `Lost them in the ${where}.`,
      `${together(sweepers)} sweep${sweepers.length === 1 ? "s" : ""} it. The rest stay on rounds.`,
    );
  }

  // Between runs (#35): the first answer says what the board already changed, ahead of the rest.
  const posted = request.history?.posted;
  if (posted && zones.has(posted.zoneId)) {
    const times = request.history!.entries.find((e) => e.zoneId === posted.zoneId)?.count ?? 1;
    const often = times === 1 ? "last time" : times === 2 ? "twice" : `${times} times`;
    lines.unshift(`They came in by the ${name(posted.zoneId)} ${often}. ${posted.guardId} starts there tonight.`);
  }

  let rationale = "";
  for (const line of lines) {
    const next = rationale ? `${rationale} ${line}` : line;
    if (next.length > CHIEF_RATIONALE_MAX) break;
    rationale = next;
  }
  return { orders, lockZones, rationale };
}
