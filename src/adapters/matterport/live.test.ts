// The live adapter on a stubbed SDK connection. The sweep and room records are
// hand-written in the shape mapping.ts assumes (Q2 is unanswered, there is no
// key), not recorded from Matterport.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createLiveMatterport, MatterportNotConfiguredError, type ShowcaseConnect } from "./live";
import { SHOWCASE, toFloorGraph, UNASSIGNED_ROOM, type ObservableCollection } from "./mapping";

const here = path.dirname(fileURLToPath(import.meta.url));

const v = (x: number, z: number) => ({ x, y: 1.5, z });
const sweep = (sid: string, x: number, z: number, room: string | null, neighbors: string[], extra = {}) => ({
  sid,
  uuid: `uuid-${sid}`,
  enabled: true,
  neighbors,
  position: v(x, z),
  floorInfo: { id: "floor-a", sequence: 0 },
  roomInfo: { id: room },
  ...extra,
});

// A small scanned floor: a lobby, a corridor, a stair, one unassigned sweep,
// one disabled sweep, one island the walk graph cannot reach, and one sweep
// on another floor.
const SWEEPS = {
  s1: sweep("s1", 0, 0, "r-lobby", ["s2", "s9"]),
  s2: sweep("s2", 2, 0, "r-lobby", ["s1", "s3"]),
  s3: sweep("s3", 5, 0, "r-corridor", ["s2", "s4", "s5"]),
  s4: sweep("s4", 5, 3, "r-stair", ["s3"]),
  s5: sweep("s5", 8, 0, null, ["s3", "s6"]),
  s6: sweep("s6", 9, 0, "r-corridor", ["s5"], { enabled: false }),
  s7: sweep("s7", 20, 20, "r-lobby", ["s8"]),
  s8: sweep("s8", 21, 20, "r-lobby", ["s7"]),
  s9: sweep("s9", 0, 0, "r-lobby", ["s1"], { floorInfo: { id: "floor-b", sequence: 1 } }),
};

const ROOMS = {
  "r-lobby": { id: "r-lobby", label: "Main Lobby", bounds: { min: v(-1, -1), max: v(3, 1) } },
  "r-corridor": { id: "r-corridor", label: "", bounds: { min: v(4, -1), max: v(10, 1) } },
  "r-stair": { id: "r-stair", label: "Stairwell 2", bounds: { min: v(4, 2), max: v(6, 4) } },
};

/** An SDK whose collections answer once, synchronously, as the SDK may. */
function stubSdk(sweeps: Record<string, unknown> = SWEEPS, rooms: Record<string, unknown> = ROOMS) {
  const cancelled: string[] = [];
  const collection = <T,>(name: string, items: Record<string, T>): ObservableCollection<T> => ({
    subscribe(observer) {
      observer.onCollectionUpdated(items);
      return { cancel: () => cancelled.push(name) };
    },
  });
  const disconnect = vi.fn();
  const connect = vi.fn<ShowcaseConnect>(async () => ({
    sdk: { Sweep: { data: collection("sweeps", sweeps) }, Room: { data: collection("rooms", rooms) } },
    disconnect,
  }));
  return { connect, disconnect, cancelled };
}

describe("toFloorGraph (mapping.ts)", () => {
  const graph = toFloorGraph(SWEEPS, ROOMS);

  it("keeps the enabled sweeps of the busiest floor that the walk graph connects", () => {
    expect(graph.source).toBe("matterport");
    expect(graph.nodes.map((n) => n.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });

  it("maps positions onto the board's plane (x and z; y is up)", () => {
    expect(graph.nodes.find((n) => n.id === "s4")).toMatchObject({ x: 5, y: 3, roomId: "r-stair", tags: ["stair"] });
  });

  it("puts doors, never lockable, on edges that cross rooms, and dedupes neighbour pairs", () => {
    expect(graph.edges).toEqual([
      { a: "s1", b: "s2" },
      { a: "s2", b: "s3", door: { id: "door:s2:s3", lockable: false } },
      { a: "s3", b: "s4", door: { id: "door:s3:s4", lockable: false } },
      { a: "s3", b: "s5", door: { id: `door:s3:s5`, lockable: false } },
    ]);
  });

  it("labels rooms from the scan, falls back for a blank label, and boxes unassigned sweeps", () => {
    expect(graph.rooms).toEqual([
      { id: "r-lobby", label: "Main Lobby", rect: { x: -1, y: -1, w: 4, h: 2 } },
      { id: "r-corridor", label: "Unlabelled area", rect: { x: 4, y: -1, w: 6, h: 2 } },
      { id: "r-stair", label: "Stairwell 2", rect: { x: 4, y: 2, w: 2, h: 2 } },
      { id: UNASSIGNED_ROOM, label: "Unlabelled area", rect: { x: 8, y: 0, w: 0.5, h: 0.5 } },
    ]);
  });

  it("derives same-room sightlines only", () => {
    expect(graph.sightlines).toEqual({ s1: ["s2"], s2: ["s1"], s3: [], s4: [], s5: [] });
  });

  it("refuses a model with no enabled sweeps", () => {
    expect(() => toFloorGraph({}, ROOMS)).toThrow("no enabled sweeps");
  });
});

describe("the live Matterport adapter (stubbed SDK, no key)", () => {
  it("refuses to start without an SDK key", () => {
    expect(() => createLiveMatterport({})).toThrow(MatterportNotConfiguredError);
  });

  it("connects to the building's model, maps the floor, and disconnects", async () => {
    const stub = stubSdk();
    const matterport = createLiveMatterport({ sdkKey: "test-key", connect: stub.connect });
    const floor = await matterport.loadFloor({ id: "48213", matterportModelId: "abcDEF123" });
    expect(floor?.nodes).toHaveLength(5);
    expect(stub.connect).toHaveBeenCalledWith("abcDEF123", "test-key");
    expect(stub.disconnect).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(stub.cancelled.sort()).toEqual(["rooms", "sweeps"]);
  });

  it("returns null, without connecting, for a building with no model", async () => {
    const stub = stubSdk();
    const matterport = createLiveMatterport({ sdkKey: "test-key", connect: stub.connect });
    expect(await matterport.loadFloor({ id: "F1" })).toBeNull();
    expect(stub.connect).not.toHaveBeenCalled();
  });

  it("builds the graph afresh on every load (no cache, SPEC §4.5)", async () => {
    const stub = stubSdk();
    const matterport = createLiveMatterport({ sdkKey: "test-key", connect: stub.connect });
    const building = { id: "48213", matterportModelId: "abcDEF123" };
    const first = await matterport.loadFloor(building);
    const second = await matterport.loadFloor(building);
    expect(stub.connect).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("disconnects and rejects when a collection never arrives", async () => {
    const disconnect = vi.fn();
    const silent: ObservableCollection<unknown> = { subscribe: () => ({ cancel() {} }) };
    const connect: ShowcaseConnect = async () => ({ sdk: { Sweep: { data: silent }, Room: { data: silent } }, disconnect });
    const matterport = createLiveMatterport({ sdkKey: "test-key", connect, timeoutMs: 10 });
    await expect(matterport.loadFloor({ id: "x", matterportModelId: "m" })).rejects.toThrow("did not arrive within 10 ms");
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("puts the model id and the key into the embed URL, escaped", () => {
    const url = new URL(SHOWCASE.embedUrl("a b&c", "k/1"));
    expect(url.origin).toBe("https://my.matterport.com");
    expect(url.searchParams.get("m")).toBe("a b&c");
    expect(url.searchParams.get("applicationKey")).toBe("k/1");
  });

  it("never sends, stores or caches scan data: no network or storage API in live.ts or mapping.ts", () => {
    const FORBIDDEN = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|caches)\b/;
    for (const file of ["live.ts", "mapping.ts"]) {
      const code = readFileSync(path.join(here, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code.match(FORBIDDEN)?.[0], file).toBeUndefined();
    }
  });
});
