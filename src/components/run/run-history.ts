// The player's earlier runs of a building (#35), kept so the Security Chief
// can adapt between runs. Each finished run leaves one record: the way in,
// the way out, the zones where they were seen, and how much noise they made.
// Records hold engine zone ids and counts, never a node; they live only in
// this browser (SPEC §4.1, §4.5). Storage can be blocked or full, so every
// read and write may quietly do nothing.
import { z } from "zod";
import type { ChiefHistory } from "@/agents/chief/request";
import { toRunLog, zoneOf, type RunState } from "@/engine";
import type { Posture } from "@/level/placer";
import type { ChiefZones } from "./chief-request";

/** Keyed by building and mission, as the run log is: a record's zones belong to that pair's level. */
export const runHistoryKey = (buildingId: string, missionId?: string | null) =>
  missionId ? `heist:run-history:${buildingId}:${missionId}` : `heist:run-history:${buildingId}`;

/** How many runs the history keeps: the oldest goes first. */
export const HISTORY_MAX = 20;

const ZoneId = z.string().min(1).max(64);

export const RunRecord = z.strictObject({
  outcome: z.enum(["won", "caught"]),
  /** The zone of the node the run started on (the level's start): on F1, the dock's entry. */
  entryZone: ZoneId,
  /** The zone they left by, on a win. */
  exitZone: ZoneId.optional(),
  /** The last-known zone of each sighting that raised the alarm, in order. */
  detectedZones: z.array(ZoneId).max(64),
  /** Turns spent sprinting or picking. */
  noise: z.int().nonnegative(),
});
export type RunRecord = z.infer<typeof RunRecord>;

const browserStorage = (): Storage | undefined => globalThis.localStorage;

/** The record a finished run leaves; null while it is still being played. */
export function runRecordOf(run: RunState): RunRecord | null {
  if (run.status === "playing") return null;
  const log = toRunLog(run);
  const last = log.turns[log.turns.length - 1];
  if (!last) return null;
  const zone = (nodeId: string) => zoneOf(run.board, nodeId).zoneId;
  return {
    outcome: run.status,
    entryZone: zone(run.board.level.start),
    ...(run.status === "won" && { exitZone: zone(last.player.nodeId) }),
    detectedZones: run.alarmEvents
      .filter((e) => (e.cause.kind === "camera" || e.cause.kind === "guard" || e.cause.kind === "cleaner") && e.lastKnownZone !== null)
      .map((e) => e.lastKnownZone!)
      .slice(0, 64),
    noise: log.turns.filter((t) => t.player.kind === "sprint" || t.player.kind === "pick").length,
  };
}

export function loadRunHistory(buildingId: string, storage?: Pick<Storage, "getItem">, missionId?: string | null): RunRecord[] {
  try {
    const raw = (storage ?? browserStorage())?.getItem(runHistoryKey(buildingId, missionId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Record by record: one bad record costs only itself, not the runs stored beside it.
    return parsed.flatMap((item) => {
      const record = RunRecord.safeParse(item);
      return record.success ? [record.data] : [];
    }).slice(-HISTORY_MAX);
  } catch {
    return [];
  }
}

/** Adds `record` to the building's history, dropping the oldest past HISTORY_MAX. */
export function appendRunHistory(
  buildingId: string,
  record: RunRecord,
  storage?: Pick<Storage, "getItem" | "setItem">,
  missionId?: string | null,
): void {
  try {
    const store = storage ?? browserStorage();
    if (!store) return;
    const next = [...loadRunHistory(buildingId, store, missionId), record].slice(-HISTORY_MAX);
    store.setItem(runHistoryKey(buildingId, missionId), JSON.stringify(next));
  } catch {
    // The Chief just remembers less.
  }
}

export function clearRunHistory(buildingId: string, storage?: Pick<Storage, "removeItem">, missionId?: string | null): void {
  try {
    (storage ?? browserStorage())?.removeItem(runHistoryKey(buildingId, missionId));
  } catch {
    // As with a save.
  }
}

/** Ids by how often they appear, most first; ties by id, so the same records always give the same order. */
function tally(ids: readonly string[]): { zoneId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .map(([zoneId, count]) => ({ zoneId, count: Math.min(count, 99) }))
    .sort((a, b) => b.count - a.count || a.zoneId.localeCompare(b.zoneId));
}

/**
 * The way in to watch on the next run: the entry they started from most, on
 * any earlier run. Engine ids, for the placer. Empty with no history.
 */
export function postureOf(records: readonly RunRecord[]): Posture {
  const [top] = tally(records.map((r) => r.entryZone));
  return top ? { watchEntry: top.zoneId } : {};
}

/**
 * The summary the Chief gets: the history in its own zone ids. A zone the
 * Chief has no id for (a record from a different placement) is left out, so
 * nothing but the request's zone ids can leave the browser. Null with no runs.
 */
export function chiefHistory(
  records: readonly RunRecord[],
  zones: ChiefZones,
  posted?: { guardId: string; zoneId: string },
): ChiefHistory | null {
  if (records.length === 0) return null;
  const known = (ids: readonly string[]) => ids.flatMap((id) => (zones.toChief.has(id) ? [zones.toChief.get(id)!] : []));
  const noise = records.reduce((sum, r) => sum + r.noise, 0) / records.length;
  const postedZone = posted && zones.toChief.get(posted.zoneId);
  return {
    runs: Math.min(records.length, 99),
    entries: tally(known(records.map((r) => r.entryZone))).slice(0, 16),
    exits: tally(known(records.flatMap((r) => (r.exitZone ? [r.exitZone] : [])))).slice(0, 16),
    detectedZones: tally(known(records.flatMap((r) => r.detectedZones))).slice(0, 16),
    averageNoise: Math.min(Math.round(noise * 10) / 10, 999),
    ...(posted && postedZone && { posted: { guardId: posted.guardId, zoneId: postedZone } }),
  };
}
