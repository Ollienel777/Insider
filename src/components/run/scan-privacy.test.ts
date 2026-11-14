// SPEC §4.5 on a board built from a live Matterport scan (issue 28): nothing
// derived from the scan is written to storage or sent in a request body. The
// scanned board here is F1's fixture floor marked as a scan, so every node id
// stands in for a sweep id and every room for a scanned room.
import { afterEach, describe, expect, it, vi } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type FloorGraph } from "@/domain";
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.json";
import { chiefRequest, chiefZones } from "./chief-request";
import { clearRunLog, keepRunLogInMemory, loadRunLog, runLogKey, runLogOf, saveRunLog } from "./run-log-store";
import { boardOn, RUN_SEED } from "./run-screen";

const scannedFloor: FloorGraph = { ...structuredClone(FIXTURE_FLOORS.F1), source: "matterport" };
const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), scannedFloor, RUN_SEED);

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
    removeItem: vi.fn((key: string) => void items.delete(key)),
  };
}

describe("a scanned board's run log stays out of storage", () => {
  it("holds the log in memory for the Debrief, writes none, and removes an old stored one", () => {
    const storage = fakeStorage();
    const id = "scan-building-1";
    storage.items.set(runLogKey(id), "{}");
    keepRunLogInMemory(id, true, storage);
    expect(storage.items.has(runLogKey(id))).toBe(false);

    const run = play(createRun(placed.level), [{ kind: "move", to: F1_DEMO.freightLiftWait }]);
    const log = { ...runLogOf(run, new Map()), buildingId: id };
    saveRunLog(log, storage);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(loadRunLog(id, storage)).toEqual(log);
    expect(storage.getItem).not.toHaveBeenCalled();

    clearRunLog(id, storage);
    expect(loadRunLog(id, storage)).toBeNull();
  });

  it("goes back to storage when the building is next played on fixtures", () => {
    const storage = fakeStorage();
    const id = "scan-building-2";
    keepRunLogInMemory(id, true, storage);
    keepRunLogInMemory(id, false, storage);
    const log = { ...runLogOf(createRun(placed.level), new Map()), buildingId: id };
    saveRunLog(log, storage);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(loadRunLog(id, storage)).toEqual(log);
  });
});

describe("the Run screen keeps a scanned board's log out of storage from its first run", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks the building before the run starts, so the fresh run's log is never written", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const id = "scan-building-3";
    const manifest = LevelManifest.parse(structuredClone(cached));
    // What the Run screen does on a loaded floor: `boardOn`, then `startRun`, which saves the fresh run's log.
    const { placed: board, live } = boardOn(id, manifest, structuredClone(scannedFloor));
    expect(live).toBe(true);
    saveRunLog({ ...runLogOf(createRun(board.level), new Map()), buildingId: id });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(loadRunLog(id)?.buildingId).toBe(id);
  });

  it("still writes the log to storage on a fixture floor", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const id = "fixture-building-1";
    const manifest = LevelManifest.parse(structuredClone(cached));
    const { placed: board, live } = boardOn(id, manifest, structuredClone(FIXTURE_FLOORS.F1));
    expect(live).toBe(false);
    saveRunLog({ ...runLogOf(createRun(board.level), new Map()), buildingId: id });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
});

describe("the Chief's request body on a scanned board", () => {
  it("names no sweep (node id) and no scanned room id or label outside the manifest's zones", () => {
    const zones = chiefZones(placed);
    const run = play(createRun(placed.level), [
      { kind: "move", to: F1_DEMO.freightLiftWait },
      { kind: "move", to: "dc-west" },
    ]);
    const event = run.alarmEvents[run.alarmEvents.length - 1];
    const body = JSON.stringify(chiefRequest("F1", placed, zones, run, event));
    const strings = new Set<string>();
    JSON.parse(body, (_key, value) => {
      if (typeof value === "string") strings.add(value);
      return value;
    });
    const manifestZones = new Set(Object.keys(placed.level.zones ?? {}));
    for (const node of scannedFloor.nodes) {
      if (!manifestZones.has(node.id)) expect(strings.has(node.id), node.id).toBe(false);
    }
    for (const room of scannedFloor.rooms) {
      if (manifestZones.has(room.id)) continue;
      expect(strings.has(room.id), room.id).toBe(false);
      expect(strings.has(room.label), room.label).toBe(false);
    }
    expect(body).not.toMatch(/"(x|y|edges|sightlines|nodes)"/);
  });
});
