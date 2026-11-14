// The run's log, carried from Run into Debrief (SPEC §4.1: run logs live in
// localStorage). It always describes the run on the Run screen's board: the
// Run screen clears it as it opens, writes a fresh run's empty log the moment
// that run starts (on opening and on Restart), then writes it after every turn,
// and again whenever the Chief's answer lands, mid-run or after the end. Left
// behind, it is the run the player left. The Debrief reads it. Storage can be
// blocked or full, so every read and write may quietly do nothing: even
// reaching `localStorage` throws when site data is blocked.
//
// On a board built from a live Matterport scan the log names the scan's
// sweeps (every node id is a sweep id), and SPEC §4.5 keeps scan data out of
// storage. So for a scanned building (`keepRunLogInMemory`) the log lives in
// this module's memory instead: it reaches the Debrief on a client-side
// navigation, and a full reload forgets it (issue 3).
import { RunLog, type ChiefSource, type LateChief } from "@/domain";
import { toRunLog, type RunState } from "@/engine";

/** Keyed by building and mission (issue 119), so two missions on one building never share a run log. */
export const runLogKey = (buildingId: string, missionId?: string | null) =>
  missionId ? `heist:run-log:${buildingId}:${missionId}` : `heist:run-log:${buildingId}`;

/** The browser's storage, read inside the caller's `try`: the getter itself throws when site data is blocked. */
const browserStorage = (): Storage | undefined => globalThis.localStorage;

/** Buildings played on a live scan, and their logs in memory by storage key (building and mission). */
const scanned = new Set<string>();
const inMemory = new Map<string, RunLog | null>();

/**
 * Marks `buildingId` as played on a live scan (`isScan`), or not. While it
 * is, its logs are held in memory and never written to storage; any copy in
 * storage for `missionId` is removed.
 */
export function keepRunLogInMemory(
  buildingId: string,
  isScan: boolean,
  storage?: Pick<Storage, "removeItem">,
  missionId?: string | null,
): void {
  if (!isScan) {
    scanned.delete(buildingId);
    for (const key of [...inMemory.keys()]) if (key === runLogKey(buildingId) || key.startsWith(`${runLogKey(buildingId)}:`)) inMemory.delete(key);
    return;
  }
  scanned.add(buildingId);
  clearStored(buildingId, storage, missionId);
}

function clearStored(buildingId: string, storage?: Pick<Storage, "removeItem">, missionId?: string | null): void {
  try {
    (storage ?? browserStorage())?.removeItem(runLogKey(buildingId, missionId));
  } catch {
    // As with a save: the Run screen goes on without it.
  }
}

export function saveRunLog(log: RunLog, storage?: Pick<Storage, "setItem">, missionId?: string | null): void {
  if (scanned.has(log.buildingId)) {
    inMemory.set(runLogKey(log.buildingId, missionId), log);
    return;
  }
  try {
    (storage ?? browserStorage())?.setItem(runLogKey(log.buildingId, missionId), JSON.stringify(log));
  } catch {
    // The run itself goes on; only the hand-off to the Debrief is lost.
  }
}

/** Forgets the stored log for `buildingId`: the board has no run on it, so the Debrief has none to show. */
export function clearRunLog(buildingId: string, storage?: Pick<Storage, "removeItem">, missionId?: string | null): void {
  if (scanned.has(buildingId)) inMemory.delete(runLogKey(buildingId, missionId));
  clearStored(buildingId, storage, missionId);
}

/**
 * The stored log for `buildingId`, or null when there is none, it no longer parses, or storage is blocked.
 * `memoryOnly` (a CoStar kit building, #95) reads only the log held in memory and removes a stored one.
 */
export function loadRunLog(
  buildingId: string,
  storage?: Pick<Storage, "getItem"> & Partial<Pick<Storage, "removeItem">>,
  missionId?: string | null,
  memoryOnly = false,
): RunLog | null {
  if (memoryOnly) {
    try {
      (storage ?? browserStorage())?.removeItem?.(runLogKey(buildingId, missionId));
    } catch {
      // As with a save.
    }
  }
  if (memoryOnly || scanned.has(buildingId)) return inMemory.get(runLogKey(buildingId, missionId)) ?? null;
  try {
    const raw = (storage ?? browserStorage())?.getItem(runLogKey(buildingId, missionId));
    if (!raw) return null;
    const log = RunLog.safeParse(JSON.parse(raw));
    return log.success && log.data.buildingId === buildingId ? log.data : null;
  } catch {
    return null;
  }
}

/**
 * The log the Run screen saves for `run`: each turn whose entry carries the
 * Chief's orders gets their source (`sources`, by turn number). Orders applied
 * to a run still being played, that no turn's entry carries yet, ride along as
 * `pendingChief`; a Chief answer that landed after the run ended, as `lateChief`.
 * `watchEntry` is the posture the level was placed with, so the Debrief places the same board.
 */
export function runLogOf(
  run: RunState,
  sources: ReadonlyMap<number, ChiefSource>,
  late: LateChief | null = null,
  watchEntry?: string,
): RunLog {
  const log = toRunLog(run);
  const source = (turn: number) => (sources.has(turn) ? { chiefSource: sources.get(turn) } : {});
  return {
    ...log,
    turns: log.turns.map((t) => (t.chief ? { ...t, ...source(t.turn) } : t)),
    ...(run.status === "playing" && run.chief ? { pendingChief: { turn: run.turn, chief: run.chief, ...source(run.turn) } } : {}),
    ...(late ? { lateChief: late } : {}),
    ...(watchEntry ? { watchEntry } : {}),
  };
}
