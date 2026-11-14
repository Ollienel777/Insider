// The browser's side of POST /api/chief (SPEC §4.4, §4.5). The board stays
// here: the request names zones, never nodes, and carries no coordinate or
// adjacency. The Chief's zone ids are the manifest's zones and entries as
// they are, and the floor's other rooms: by their room id on a hand-authored
// fixture floor, and by an opaque `area-N` on a scanned (Matterport) floor,
// so no scan id or label leaves the browser. Orders come back in those ids
// and are mapped to the engine's before the engine clamps them.
import { ChiefRequest, type ChiefAnswer, type ChiefHistory } from "@/agents/chief/request";
import { ChiefOrders } from "@/domain";
import { compileBoard, zoneOf, type AlarmEvent, type RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { noteResponse } from "@/lib/demo-status";
import { zoneName } from "./board";

export type { ChiefAnswer };

export interface ChiefZones {
  zones: { id: string; name: string }[];
  /** Chief zone id → engine zone id. */
  toEngine: ReadonlyMap<string, string>;
  /** Engine zone id → Chief zone id. */
  toChief: ReadonlyMap<string, string>;
}

/** The zones the Chief may name on this placed level. */
export function chiefZones(placed: PlacedLevel): ChiefZones {
  const { level } = placed;
  const scanned = level.floor.source !== "fixture";
  const zones: { id: string; name: string }[] = [];
  const toEngine = new Map<string, string>();
  const toChief = new Map<string, string>();
  const add = (engineId: string, id: string, name: string) => {
    if (toChief.has(engineId)) return;
    zones.push({ id, name });
    toEngine.set(id, engineId);
    toChief.set(engineId, id);
  };
  for (const id of Object.keys(level.zones ?? {})) add(id, id, zoneName(placed, id));
  // The rooms no zone holds: where a guard or the player can be outside every zone.
  const board = compileBoard(level);
  let area = 0;
  for (const node of level.floor.nodes) {
    const zone = zoneOf(board, node.id).zoneId;
    if (toChief.has(zone)) continue;
    area += 1;
    if (scanned) add(zone, `area-${area}`, `Area ${area}`);
    else add(zone, zone, level.floor.rooms.find((r) => r.id === zone)?.label ?? zone);
  }
  return { zones, toEngine, toChief };
}

/**
 * The request for one alarm event: exactly the `ChiefRequest` fields, parsed so nothing more can ride along.
 * `history` is the summary of earlier runs (run-history.ts), for the run's first event only.
 */
export function chiefRequest(
  buildingId: string,
  placed: PlacedLevel,
  zones: ChiefZones,
  run: RunState,
  event: AlarmEvent,
  history: ChiefHistory | null = null,
): ChiefRequest {
  const chiefId = (engineId: string) => zones.toChief.get(engineId) ?? engineId;
  return ChiefRequest.parse({
    buildingId,
    transition: {
      turn: event.turn,
      from: event.from,
      to: event.to,
      cause: { kind: event.cause.kind, ...(event.cause.id && { id: event.cause.id }) },
    },
    lastKnownZone: event.lastKnownZone === null ? null : chiefId(event.lastKnownZone),
    guards: run.guards.map((g) => ({
      id: g.id,
      zoneId: chiefId(zoneOf(run.board, g.nodeId).zoneId),
      intent: g.target?.intent ?? "patrol",
    })),
    zones: zones.zones,
    ...(history && { history }),
  });
}

/** The Chief's orders in the engine's zone ids. An id the Chief made up stays as it is, and the engine drops it. */
export function toEngineOrders(orders: ChiefOrders, zones: ChiefZones): ChiefOrders {
  const engineId = (id: string) => zones.toEngine.get(id) ?? id;
  return {
    orders: orders.orders.map((o) => ({ ...o, zoneId: engineId(o.zoneId) })),
    lockZones: orders.lockZones.map(engineId),
    rationale: orders.rationale,
  };
}

/** Asks the Chief; throws with the server's message on a failure. */
export async function askChief(
  request: ChiefRequest,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<ChiefAnswer> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch("/api/chief", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal,
  });
  const body = (await response.json().catch(() => null)) as (Partial<ChiefAnswer> & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `the Chief didn't answer (HTTP ${response.status})`);
  noteResponse(body);
  // Only an answer that says the model wrote it reads as live. A missing or unknown source reads as recorded:
  // a wrong "Recorded" note is less harmful than a wrong "Live orders" one.
  const source = body.source === "model" || body.source === "template" ? body.source : "recorded";
  return {
    orders: ChiefOrders.parse(body.orders),
    recorded: body.recorded === true || source !== "model",
    source,
    ...(body.reason && { reason: body.reason }),
    ...(body.recording && { recording: body.recording }),
  };
}
