// The live adapter on a stubbed SDK connection. The sweep and room records are
// hand-written in the shape mapping.ts assumes (checked once against a real
// model on localhost), not recorded from Matterport: no scan data is kept.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  connectInsideView,
  connectWithin,
  createLiveMatterport,
  FLOOR_POINTS_MS,
  FLY,
  LOOK_SPEED,
  MatterportNotConfiguredError,
  SWEEPS_QUIET_MS,
  type InsideConnect,
  type InsidePlayer,
  type InsidePose,
  type InsideSdk,
  type InsideView,
  type ScanPoint,
  type ShowcaseConnect,
} from "./live";
import {
  fictionLabel,
  SHOWCASE,
  SIGHT_M,
  toFloorGraph,
  UNASSIGNED_LABEL,
  UNASSIGNED_ROOM,
  withFictionLabels,
  type ObservableCollection,
} from "./mapping";

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

// A small scanned floor: a lobby, a corridor, a stair, one sweep outside every
// room, one disabled sweep, one island the walk graph cannot reach, and one
// sweep on another floor (whose own neighbour list names s1).
const SWEEPS = {
  s1: sweep("s1", 0, 0, "r-lobby", ["s2"]),
  s2: sweep("s2", 2, 0, "r-lobby", ["s1", "s3"]),
  s3: sweep("s3", 5, 0, "r-corridor", ["s2", "s4", "s5"]),
  s4: sweep("s4", 5, 3, "r-stair", ["s3"]),
  s5: sweep("s5", 12, 0, null, ["s3", "s6"]),
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

  it("labels rooms from the scan, names a blank one by its size, and boxes unassigned sweeps", () => {
    expect(graph.rooms).toEqual([
      { id: "r-lobby", label: "Main Lobby", rect: { x: -1, y: -1, w: 4, h: 2 } },
      // 6 m by 2 m: 12 m², a meeting room.
      { id: "r-corridor", label: "Meeting Room", rect: { x: 4, y: -1, w: 6, h: 2 } },
      { id: "r-stair", label: "Stairwell 2", rect: { x: 4, y: 2, w: 2, h: 2 } },
      { id: UNASSIGNED_ROOM, label: UNASSIGNED_LABEL, rect: { x: 12, y: 0, w: 0.5, h: 0.5 } },
    ]);
  });

  it("puts a sweep with no room id in the smallest room on its floor whose bounds hold it", () => {
    const sweeps = {
      a: sweep("a", 5, 0, "", ["b"]),
      b: sweep("b", 8, 0, null, ["a"]),
    };
    const rooms = {
      ...ROOMS,
      // Holds `a` too, but it is larger than the corridor.
      "r-hall": { id: "r-hall", label: "Hall", bounds: { min: v(-10, -10), max: v(20, 10) } },
      // Smaller, and holds `a`, but on another floor.
      "r-above": { id: "r-above", label: "Above", bounds: { min: v(4.5, -0.5), max: v(5.5, 0.5) }, floorInfo: { id: "floor-b" } },
    };
    expect(toFloorGraph(sweeps, rooms).nodes.map((n) => [n.id, n.roomId])).toEqual([
      ["a", "r-corridor"],
      ["b", "r-corridor"],
    ]);
  });

  it("tags one landing per stair room, the sweep by its door, so one stairwell is one stair", () => {
    // A stairwell scanned from three spots: only s4, the one that opens onto the corridor, is the stair.
    const sweeps = {
      ...SWEEPS,
      s4: sweep("s4", 5, 3, "r-stair", ["s3", "s4b"]),
      s4b: sweep("s4b", 5, 3.5, "r-stair", ["s4", "s4c"]),
      s4c: sweep("s4c", 5.5, 3.8, "r-stair", ["s4b"]),
    };
    const floor = toFloorGraph(sweeps, ROOMS);
    expect(floor.nodes.filter((n) => n.tags.includes("stair")).map((n) => n.id)).toEqual(["s4"]);
    expect(floor.nodes.filter((n) => n.roomId === "r-stair").map((n) => n.id).sort()).toEqual(["s4", "s4b", "s4c"]);
  });

  it("tags the lower id when no sweep of a lift room leads out of it", () => {
    const sweeps = {
      a2: sweep("a2", 0, 0, "r-lift", ["a1"]),
      a1: sweep("a1", 1, 0, "r-lift", ["a2"]),
    };
    const rooms = { "r-lift": { id: "r-lift", label: "Freight Elevator", bounds: { min: v(-1, -1), max: v(2, 1) } } };
    expect(toFloorGraph(sweeps, rooms).nodes.map((n) => [n.id, n.tags])).toEqual([
      ["a2", []],
      ["a1", ["lift"]],
    ]);
  });

  it("derives same-room sightlines only", () => {
    expect(graph.sightlines).toEqual({ s1: ["s2"], s2: ["s1"], s3: [], s4: [], s5: [] });
  });

  it("sees no farther than SIGHT_M (10 m) across a room: a scan shows no walls inside one", () => {
    expect(SIGHT_M).toBe(10);
    const sweeps = {
      a: sweep("a", 0, 0, "r-hall", ["b"]),
      b: sweep("b", 6, 0, "r-hall", ["a", "c"]),
      c: sweep("c", 16, 0, "r-hall", ["b", "d"]),
      d: sweep("d", 16, 10, "r-hall", ["c"]),
    };
    const rooms = { "r-hall": { id: "r-hall", label: "Open Floor", bounds: { min: v(-1, -1), max: v(20, 12) } } };
    expect(toFloorGraph(sweeps, rooms).sightlines).toEqual({
      a: ["b"],
      b: ["a", "c"],
      c: ["b", "d"],
      d: ["c"],
    });
  });

  it("refuses a model with no enabled sweeps", () => {
    expect(() => toFloorGraph({}, ROOMS)).toThrow("no enabled sweeps");
  });
});

describe("game-fiction labels for unlabelled rooms (issue 3)", () => {
  it("names a room by its floor area", () => {
    expect([1, 3.99, 4, 11.9, 12, 29.9, 30, 79.9, 80, 400].map(fictionLabel)).toEqual([
      "Closet",
      "Closet",
      "Office",
      "Office",
      "Meeting Room",
      "Meeting Room",
      "Workroom",
      "Workroom",
      "Open Floor",
      "Open Floor",
    ]);
  });

  it("numbers rooms that get the same name, north-west first, and keeps the scan's own labels", () => {
    const room = (id: string, label: string, x: number, y: number, w: number, h: number) => ({ id, label, rect: { x, y, w, h } });
    const named = withFictionLabels([
      room("east", "", 10, 0, 3, 3),
      room("kept", "Server Room", 0, 5, 3, 3),
      room("west", "", 0, 0, 3, 3),
      room("south", "", 0, 9, 3, 3),
      room("hall", "", 0, 20, 20, 10),
    ]);
    expect(named.map((r) => [r.id, r.label])).toEqual([
      ["east", "Office 2"],
      ["kept", "Server Room"],
      ["west", "Office 1"],
      ["south", "Office 3"],
      ["hall", "Open Floor"],
    ]);
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
    expect(stub.connect).toHaveBeenCalledWith("abcDEF123", "test-key", expect.any(AbortSignal));
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

  it("rejects a connection that never opens, with a TimeoutError, and lets go of one that opens late", async () => {
    vi.useFakeTimers();
    try {
      const disconnect = vi.fn();
      let open: (session: { sdk: never; disconnect: () => void }) => void = () => {};
      const connect = vi.fn<ShowcaseConnect>(() => new Promise((resolve) => (open = resolve as typeof open)));
      const matterport = createLiveMatterport({ sdkKey: "test-key", connect, connectTimeoutMs: 50 });
      const load = matterport.loadFloor({ id: "x", matterportModelId: "m" });
      const settled = expect(load).rejects.toMatchObject({ name: "TimeoutError", message: expect.stringContaining("within 50 ms") });
      await vi.advanceTimersByTimeAsync(50);
      await settled;
      open({ sdk: undefined as never, disconnect });
      await Promise.resolve();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a connection's own failure through before the deadline", async () => {
    const connect: ShowcaseConnect = async () => {
      throw new Error("player refused the key");
    };
    await expect(connectWithin(connect, "m", "k", 1000)).rejects.toThrow("player refused the key");
  });

  it("names a collection that never arrives a TimeoutError too", async () => {
    const silent: ObservableCollection<unknown> = { subscribe: () => ({ cancel() {} }) };
    const connect: ShowcaseConnect = async () => ({ sdk: { Sweep: { data: silent }, Room: { data: silent } }, disconnect() {} });
    const matterport = createLiveMatterport({ sdkKey: "test-key", connect, timeoutMs: 10 });
    await expect(matterport.loadFloor({ id: "x", matterportModelId: "m" })).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("puts the model id and the key into the embed URL, escaped", () => {
    const url = new URL(SHOWCASE.embedUrl("a b&c", "k/1"));
    expect(url.origin).toBe("https://my.matterport.com");
    expect(url.searchParams.get("m")).toBe("a b&c");
    expect(url.searchParams.get("applicationKey")).toBe("k/1");
  });

  it("never sends, stores or caches scan data: no network or storage API in live.ts, mapping.ts or the Inside view", () => {
    const FORBIDDEN = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|caches)\b/;
    for (const file of ["live.ts", "mapping.ts", "../../components/run/inside-view.tsx"]) {
      const code = readFileSync(path.join(here, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code.match(FORBIDDEN)?.[0], file).toBeUndefined();
    }
  });
});

/**
 * A stubbed player for a test that only moves the view. Whatever the view
 * could read of the scan fails the test if it is touched: a view that is only
 * moved subscribes to nothing and measures nothing.
 */
function movedOnly(moveTo: InsideSdk["Sweep"]["moveTo"], disconnect: () => void = () => {}): InsidePlayer {
  const untouched = (what: string) => () => {
    throw new Error(`${what} was used by a view that was only moved`);
  };
  return {
    Sweep: { moveTo, data: { subscribe: untouched("Sweep.data") } },
    Camera: { pose: { subscribe: untouched("Camera.pose") }, rotate: untouched("Camera.rotate") },
    Conversion: { worldToScreen: untouched("Conversion.worldToScreen") },
    frameSize: untouched("the frame's size"),
    disconnect,
  };
}

describe("the Inside view (stubbed SDK)", () => {
  function stubInside(moveTo: InsideSdk["Sweep"]["moveTo"] = vi.fn(async () => undefined)) {
    const disconnect = vi.fn();
    const connect = vi.fn(async () => movedOnly(moveTo, disconnect));
    return { connect, disconnect, moveTo };
  }

  it("opens the building's model in the element given, and moves to a sweep", async () => {
    const stub = stubInside();
    const parent = {} as HTMLElement;
    const view = await connectInsideView(parent, "abcDEF123", "test-key", stub.connect);
    expect(stub.connect).toHaveBeenCalledWith(parent, "abcDEF123", "test-key", expect.any(AbortSignal));
    await view.moveTo("s3");
    expect(stub.moveTo).toHaveBeenCalledWith("s3", expect.objectContaining({ transition: FLY }));
    expect(FLY).toBe("transition.fly");
    view.disconnect();
    expect(stub.disconnect).toHaveBeenCalledTimes(1);
  });

  it("shrugs off a move the player refuses: the board, not the view, is the game", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = stubInside(vi.fn(async () => {
      throw new Error("sweep not found");
    }));
    const view = await connectInsideView({} as HTMLElement, "m", "k", stub.connect);
    await expect(view.moveTo("nowhere")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sweep not found"));
    warn.mockRestore();
  });
});

describe("stairs the scan shows by itself: sweeps that reach another floor", () => {
  const up = (id: string) => sweep(id, 0, 0, "r-up", [], { floorInfo: { id: "floor-b", sequence: 1 } });
  const rooms = {
    "r-hall": { id: "r-hall", label: "Hall", bounds: { min: v(-1, -1), max: v(10, 1) } },
    "r-core": { id: "r-core", label: "", bounds: { min: v(-1, 2), max: v(2, 4) } },
    "r-stair": { id: "r-stair", label: "Stair B", bounds: { min: v(8, 2), max: v(10, 4) } },
  };
  const stairs = (sweeps: Record<string, unknown>) =>
    toFloorGraph(sweeps, rooms)
      .nodes.filter((n) => n.tags.includes("stair"))
      .map((n) => n.id);

  it("tags one stair per landing: touching sweeps in one room that reach another floor are one", () => {
    const sweeps = {
      h1: sweep("h1", 0, 0, "r-hall", ["h2", "c1"]),
      h2: sweep("h2", 5, 0, "r-hall", ["h1"]),
      // A flight in an unlabelled core, scanned from three spots that each see the floor above.
      c1: sweep("c1", 0, 2.5, "r-core", ["h1", "c2", "u1"]),
      c2: sweep("c2", 0, 3, "r-core", ["c1", "c3", "u1"]),
      c3: sweep("c3", 0, 3.5, "r-core", ["c2", "u2"]),
      u1: up("u1"),
      u2: up("u2"),
    };
    expect(stairs(sweeps)).toEqual(["c1"]);
  });

  it("tags two stairs for two landings that do not touch", () => {
    const sweeps = {
      a: sweep("a", 0, 0, "r-hall", ["b", "u1"]),
      b: sweep("b", 5, 0, "r-hall", ["a", "c"]),
      c: sweep("c", 9, 0, "r-hall", ["b", "u2"]),
      u1: up("u1"),
      u2: up("u2"),
    };
    expect(stairs(sweeps)).toEqual(["a", "c"]);
  });

  it("adds no stair to a room whose label already makes it one", () => {
    const sweeps = {
      h1: sweep("h1", 9, 0, "r-hall", ["s1"]),
      s1: sweep("s1", 9, 2.5, "r-stair", ["h1", "s2"]),
      s2: sweep("s2", 9, 3, "r-stair", ["s1", "s3"]),
      // Reaches the floor above; without the label rule it would be a second stair.
      s3: sweep("s3", 9, 3.5, "r-stair", ["s2", "u1"]),
      u1: up("u1"),
    };
    expect(stairs(sweeps)).toEqual(["s1"]);
  });
});

describe("room names are unique, whoever gave them", () => {
  it("numbers a scan label and a fiction label that match together, and two matching scan labels", () => {
    const room = (id: string, label: string, x: number, y: number, w: number, h: number) => ({ id, label, rect: { x, y, w, h } });
    const named = withFictionLabels([
      room("scan-office", "Office", 10, 0, 3, 3),
      room("blank", "", 0, 0, 3, 3),
      room("lobby-b", "Lobby", 0, 9, 3, 3),
      room("lobby-a", "Lobby", 0, 5, 3, 3),
    ]);
    expect(named.map((r) => [r.id, r.label])).toEqual([
      ["scan-office", "Office 2"],
      ["blank", "Office 1"],
      ["lobby-b", "Lobby 2"],
      ["lobby-a", "Lobby 1"],
    ]);
    expect(new Set(named.map((r) => r.label)).size).toBe(named.length);
  });
});

describe("waiting for the scan's collections", () => {
  /** A collection whose updates the test sends. */
  function pushed() {
    let observer: { onCollectionUpdated(items: Record<string, unknown>): void } | null = null;
    const cancel = vi.fn();
    const data: ObservableCollection<unknown> = {
      subscribe(o) {
        observer = o;
        return { cancel };
      },
    };
    return { data, cancel, send: (items: Record<string, unknown>) => observer?.onCollectionUpdated(items) };
  }

  it("ignores an empty sweep list sent before the player plays, and waits for the real one", async () => {
    const sweeps = pushed();
    const rooms = pushed();
    const disconnect = vi.fn();
    const connect: ShowcaseConnect = async () => ({ sdk: { Sweep: { data: sweeps.data }, Room: { data: rooms.data } }, disconnect });
    const load = createLiveMatterport({ sdkKey: "k", connect, timeoutMs: 1000 }).loadFloor({ id: "x", matterportModelId: "m" });
    // Let the connection open and the collections be subscribed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    sweeps.send({});
    rooms.send(ROOMS);
    sweeps.send(SWEEPS);
    expect((await load)?.nodes).toHaveLength(5);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("builds the board with no rooms when a model sends none within the grace period", async () => {
    vi.useFakeTimers();
    try {
      const sweeps = pushed();
      const rooms = pushed();
      const connect: ShowcaseConnect = async () => ({
        sdk: { Sweep: { data: sweeps.data }, Room: { data: rooms.data } },
        disconnect() {},
      });
      const load = createLiveMatterport({ sdkKey: "k", connect, timeoutMs: 15_000 }).loadFloor({ id: "x", matterportModelId: "m" });
      await vi.advanceTimersByTimeAsync(0);
      sweeps.send(SWEEPS);
      await vi.advanceTimersByTimeAsync(2_000);
      const floor = await load;
      expect(floor?.rooms.map((r) => r.id)).toEqual([UNASSIGNED_ROOM]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("deadlines let go of what they gave up on", () => {
  it("aborts the connection's signal at the deadline, so the hidden player can leave the page", async () => {
    vi.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const connect: ShowcaseConnect = (_m, _k, signal) => {
        seen = signal;
        return new Promise(() => {});
      };
      const settled = expect(connectWithin(connect, "m", "k", 50)).rejects.toMatchObject({ name: "TimeoutError" });
      expect(seen?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(50);
      await settled;
      expect(seen?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the Inside view's player a deadline, and disconnects one that opens after it", async () => {
    vi.useFakeTimers();
    try {
      const disconnect = vi.fn();
      let open: (sdk: InsidePlayer) => void = () => {};
      let seen: AbortSignal | undefined;
      const connect = vi.fn<InsideConnect>((_p, _m, _k, signal) => {
        seen = signal;
        return new Promise((resolve) => (open = resolve));
      });
      const view = connectInsideView({} as HTMLElement, "m", "k", connect, 100);
      const settled = expect(view).rejects.toMatchObject({ name: "TimeoutError", message: expect.stringContaining("within 100 ms") });
      await vi.advanceTimersByTimeAsync(100);
      await settled;
      expect(seen?.aborted).toBe(true);
      open(movedOnly(vi.fn(), disconnect));
      await Promise.resolve();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the Inside view's moves never overlap", () => {
  it("flies A, holds B and C while A is in flight, then flies only to C", async () => {
    const flights: { to: string; land: () => void }[] = [];
    let inFlight = 0;
    const moveTo = vi.fn((to: string) => {
      inFlight += 1;
      // A player refuses a move made while it is still flying.
      if (inFlight > 1) {
        inFlight -= 1;
        return Promise.reject(new Error("a transition is already active"));
      }
      return new Promise<void>((resolve) => {
        flights.push({
          to,
          land: () => {
            inFlight -= 1;
            resolve();
          },
        });
      });
    });
    const view = await connectInsideView({} as HTMLElement, "m", "k", async () => movedOnly(moveTo));
    const a = view.moveTo("A");
    await Promise.resolve();
    await Promise.resolve();
    void view.moveTo("B");
    const c = view.moveTo("C");
    expect(flights.map((f) => f.to)).toEqual(["A"]);
    flights[0].land();
    await vi.waitFor(() => expect(flights).toHaveLength(2));
    expect(flights[1].to).toBe("C");
    flights[1].land();
    await Promise.all([a, c]);
    expect(moveTo.mock.calls.map(([to]) => to)).toEqual(["A", "C"]);
  });

  it("does not fly again to where it already is, and stops once disconnected", async () => {
    const moveTo = vi.fn(async () => undefined);
    const view = await connectInsideView({} as HTMLElement, "m", "k", async () => movedOnly(moveTo));
    await view.moveTo("A");
    await view.moveTo("A");
    expect(moveTo).toHaveBeenCalledTimes(1);
    view.disconnect();
    await view.moveTo("B");
    expect(moveTo).toHaveBeenCalledTimes(1);
  });
});

describe("one hidden player at a time", () => {
  it("opens a second load's player only once the first has let go of its own", async () => {
    let open = 0;
    let most = 0;
    const connect = vi.fn<ShowcaseConnect>(async () => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const stub = stubSdk();
      const session = await stub.connect("m", "k");
      return { sdk: session.sdk, disconnect: () => void (open -= 1) };
    });
    const matterport = createLiveMatterport({ sdkKey: "k", connect });
    const building = { id: "x", matterportModelId: "m" };
    const [first, second] = await Promise.all([matterport.loadFloor(building), matterport.loadFloor(building)]);
    expect(first?.nodes).toHaveLength(5);
    expect(second?.nodes).toHaveLength(5);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
  });

  it("still runs the next load after one fails", async () => {
    const connect = vi
      .fn<ShowcaseConnect>()
      .mockRejectedValueOnce(new Error("player refused the key"))
      .mockImplementation(stubSdk().connect);
    const matterport = createLiveMatterport({ sdkKey: "k", connect });
    const building = { id: "x", matterportModelId: "m" };
    const failed = matterport.loadFloor(building);
    const next = matterport.loadFloor(building);
    await expect(failed).rejects.toThrow("player refused the key");
    expect((await next)?.nodes).toHaveLength(5);
  });
});

describe("the Inside view waits out a flight it did not start", () => {
  it("tries again when the player is still flying (its opening flight included), and gets there", async () => {
    vi.useFakeTimers();
    try {
      const moveTo = vi
        .fn<InsideSdk["Sweep"]["moveTo"]>()
        .mockRejectedValueOnce(new Error("SweepTransitionActiveException: Tried to start transition while another transition was active"))
        .mockResolvedValue(undefined);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const view = await connectInsideView({} as HTMLElement, "m", "k", async () => movedOnly(moveTo));
      const moved = view.moveTo("A");
      await vi.advanceTimersByTimeAsync(1_000);
      await moved;
      expect(moveTo.mock.calls.map(([id]) => id)).toEqual(["A", "A"]);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after a few tries, and does not retry other refusals", async () => {
    vi.useFakeTimers();
    try {
      const busy = vi.fn<InsideSdk["Sweep"]["moveTo"]>(async () => {
        throw new Error("Tried to start transition while another transition was active");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const view = await connectInsideView({} as HTMLElement, "m", "k", async () => movedOnly(busy));
      const moved = view.moveTo("A");
      await vi.advanceTimersByTimeAsync(10_000);
      await moved;
      expect(busy).toHaveBeenCalledTimes(6);
      expect(warn).toHaveBeenCalledTimes(1);

      const missing = vi.fn<InsideSdk["Sweep"]["moveTo"]>(async () => {
        throw new Error("sweep not found");
      });
      const other = await connectInsideView({} as HTMLElement, "m", "k", async () => movedOnly(missing));
      await other.moveTo("B");
      expect(missing).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("review fixes: the Inside view lets go, and a lost move does not freeze it", () => {
  it("gives up on the player at once when the caller aborts, and disconnects one that opens after", async () => {
    const disconnect = vi.fn();
    let open: (sdk: InsidePlayer) => void = () => {};
    let inner: AbortSignal | undefined;
    const connect = vi.fn<InsideConnect>((_p, _m, _k, signal) => {
      inner = signal;
      return new Promise((resolve) => (open = resolve));
    });
    const stop = new AbortController();
    const view = connectInsideView({} as HTMLElement, "m", "k", connect, 20_000, stop.signal);
    const settled = expect(view).rejects.toThrow("given up on");
    stop.abort();
    await settled;
    expect(inner?.aborted).toBe(true);
    open(movedOnly(vi.fn(), disconnect));
    await Promise.resolve();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("counts a move that never settles as refused, and still flies to the next sweep", async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const moveTo = vi
        .fn<InsideSdk["Sweep"]["moveTo"]>()
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue(undefined);
      const view = await connectInsideView({} as HTMLElement, "m", "k", async () => movedOnly(moveTo));
      void view.moveTo("A");
      await vi.advanceTimersByTimeAsync(10);
      const next = view.moveTo("B");
      await vi.advanceTimersByTimeAsync(6_000);
      await next;
      expect(moveTo.mock.calls.map(([id]) => id)).toEqual(["A", "B"]);
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("review fixes: a number never repeats a name another room already has", () => {
  it("skips a scan's own numbered name when numbering repeats", () => {
    const room = (id: string, label: string, x: number, y: number) => ({ id, label, rect: { x, y, w: 3, h: 3 } });
    const named = withFictionLabels([room("own", "Office 1", 20, 0), room("a", "", 0, 0), room("b", "", 10, 0)]);
    expect(named.map((r) => [r.id, r.label])).toEqual([
      ["own", "Office 1"],
      ["a", "Office 2"],
      ["b", "Office 3"],
    ]);
  });
});

describe("second review: an Inside view that opened is the panel's to close", () => {
  it("does not abort the player once it is open, so close disconnects it once, in order", async () => {
    let inner: AbortSignal | undefined;
    const disconnect = vi.fn();
    const connect = vi.fn<InsideConnect>(async (_p, _m, _k, signal) => {
      inner = signal;
      return movedOnly(vi.fn(async () => undefined), disconnect);
    });
    const stop = new AbortController();
    const view = await connectInsideView({} as HTMLElement, "m", "k", connect, 20_000, stop.signal);
    stop.abort();
    expect(inner?.aborted).toBe(false);
    view.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

// ---- the Inside view steers its camera and reads for its caller -------------
//
// The poses and positions below are hand-written in the shapes a real scan
// sent on localhost (SDK 26.11): nothing here is recorded from Matterport.

/** A pose as `Camera.pose` sends it: the view reads `position` and `rotation` (degrees; `y` is yaw). */
const rawPose = (x: number, z: number, yaw: number) => ({
  position: { x, y: 1.5, z },
  rotation: { x: 0, y: yaw },
  projection: new Float32Array(16),
  sweep: "s1",
  mode: "mode.inside",
});
/** What a listener is handed for `rawPose(x, z, yaw)`. */
const pose = (x: number, z: number, yaw: number): InsidePose => ({ position: { x, y: 1.5, z }, rotation: { x: 0, y: yaw } });

/** A scan position as `Sweep.data` holds it: `position` is the camera, `puckPosition` its floor point. */
const scanPosition = (sid: string, x: number, z: number) => ({
  sid,
  id: sid,
  enabled: true,
  neighbors: [],
  position: { x, y: 1.5, z },
  puckPosition: { x, y: 0.02, z },
});

/**
 * A stand-in for `Conversion.worldToScreen` that behaves as the real one was
 * measured to: at yaw θ the camera looks along (-sin θ, 0, -cos θ); a point
 * straight ahead lands at the centre of the frame with `z` just under 1; a
 * point behind comes back mirrored with `z` just over 1; a point exactly to
 * the side divides by zero.
 */
function worldToScreen(point: ScanPoint, sdkPose: unknown, size: { w: number; h: number }) {
  const { position, rotation } = sdkPose as ReturnType<typeof rawPose>;
  const yaw = (rotation.y * Math.PI) / 180;
  const [dx, dy, dz] = [point.x - position.x, point.y - position.y, point.z - position.z];
  const ahead = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const focal = size.w / 2;
  return { x: size.w / 2 + (focal * right) / ahead, y: size.h / 2 - (focal * dy) / ahead, z: 1 - 0.05 / ahead };
}

/**
 * A stubbed player whose pose, positions and frame a test drives by hand.
 * `poseOnSubscribe` is a pose the SDK sends before `subscribe` returns.
 */
function stubPlayer(poseOnSubscribe?: unknown) {
  const poseObservers: ((pose: unknown) => void)[] = [];
  const sweepObservers = new Set<{ onCollectionUpdated(collection: Record<string, unknown>): void }>();
  let scan: Record<string, unknown> | undefined;
  const frame = { w: 1280, h: 720 };
  const cancelPose = vi.fn();
  const cancelSweeps = vi.fn();
  const player = {
    Sweep: {
      moveTo: vi.fn<InsideSdk["Sweep"]["moveTo"]>(async () => undefined),
      data: {
        subscribe: vi.fn<InsideSdk["Sweep"]["data"]["subscribe"]>((observer) => {
          sweepObservers.add(observer);
          // As the SDK does: a new subscriber is sent the collection as it stands, before `subscribe` returns.
          if (scan) observer.onCollectionUpdated(scan);
          return {
            cancel() {
              cancelSweeps();
              sweepObservers.delete(observer);
            },
          };
        }),
      },
    },
    Camera: {
      pose: {
        subscribe: vi.fn<InsideSdk["Camera"]["pose"]["subscribe"]>((observer) => {
          poseObservers.push(observer);
          if (poseOnSubscribe !== undefined) observer(poseOnSubscribe);
          return { cancel: cancelPose };
        }),
      },
      rotate: vi.fn<InsideSdk["Camera"]["rotate"]>(async () => undefined),
    },
    Conversion: { worldToScreen: vi.fn<InsideSdk["Conversion"]["worldToScreen"]>(worldToScreen) },
    frameSize: vi.fn(() => ({ ...frame })),
    disconnect: vi.fn(),
  } satisfies InsidePlayer;
  return {
    player,
    /** The frame's size: a test changes it to resize the player. */
    frame,
    cancelPose,
    cancelSweeps,
    open: () => connectInsideView({} as HTMLElement, "m", "k", async () => player),
    /** The player sends a pose. A cancelled subscription still gets it, as a callback already on its way would. */
    pose: (raw: unknown) => poseObservers.forEach((observer) => observer(raw)),
    /** The scan's positions arrive, or arrive again with more. */
    sweeps(collection: Record<string, unknown>) {
      scan = collection;
      sweepObservers.forEach((observer) => observer.onCollectionUpdated(collection));
    },
  };
}

/** Lets a listener's first pose, which is told in a microtask, reach it. */
const told = () => Promise.resolve();

describe("the Inside view takes a travel time for one move", () => {
  it("passes a move's travel time to the SDK, and flies in 600 ms when it has none", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    await view.moveTo("A", 350);
    await view.moveTo("B");
    await view.moveTo("C", 0);
    expect(stub.player.Sweep.moveTo.mock.calls).toEqual([
      ["A", { transition: FLY, transitionTime: 350 }],
      ["B", { transition: FLY, transitionTime: 600 }],
      ["C", { transition: FLY, transitionTime: 0 }],
    ]);
  });

  it("flies in 600 ms when the travel time is not a finite number of at least 0", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    const times = [Number.NaN, -1, Number.POSITIVE_INFINITY];
    for (const [i, ms] of times.entries()) await view.moveTo(`s${i}`, ms);
    expect(stub.player.Sweep.moveTo.mock.calls.map(([, options]) => options?.transitionTime)).toEqual([600, 600, 600]);
  });

  it("flies a held move in its own travel time, not in the one before it", async () => {
    const stub = stubPlayer();
    const landings: (() => void)[] = [];
    stub.player.Sweep.moveTo.mockImplementation(() => new Promise<void>((resolve) => landings.push(resolve)));
    const view = await stub.open();
    const a = view.moveTo("A", 900);
    await vi.waitFor(() => expect(landings).toHaveLength(1));
    void view.moveTo("B", 900);
    const c = view.moveTo("C", 350);
    landings[0]();
    await vi.waitFor(() => expect(landings).toHaveLength(2));
    landings[1]();
    await Promise.all([a, c]);
    expect(stub.player.Sweep.moveTo.mock.calls).toEqual([
      ["A", { transition: FLY, transitionTime: 900 }],
      ["C", { transition: FLY, transitionTime: 350 }],
    ]);
  });

  it("gives a slow flight its travel time, and the same wait after it, before it counts as lost", async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const stub = stubPlayer();
      stub.player.Sweep.moveTo.mockImplementationOnce(() => new Promise(() => {}));
      const view = await stub.open();
      void view.moveTo("A", 3_000);
      await vi.advanceTimersByTimeAsync(10);
      const next = view.moveTo("B");
      // A 600 ms flight is given up on 5.6 s in; this one flies for 3 s, so it has until 8 s.
      await vi.advanceTimersByTimeAsync(7_900);
      expect(stub.player.Sweep.moveTo.mock.calls.map(([id]) => id)).toEqual(["A"]);
      expect(warn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      await next;
      expect(stub.player.Sweep.moveTo.mock.calls.map(([id]) => id)).toEqual(["A", "B"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("did not settle within 8000 ms"));
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the Inside view takes a look", () => {
  it("turns the camera by degrees, at a speed that lands the turn at once", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    await expect(view.rotate(12, -3)).resolves.toBeUndefined();
    expect(stub.player.Camera.rotate.mock.calls).toEqual([[12, -3, { speed: 3000 }]]);
    expect(LOOK_SPEED).toBe(3000);
  });

  it("does not hold a turn behind a flight", async () => {
    const stub = stubPlayer();
    stub.player.Sweep.moveTo.mockImplementation(() => new Promise(() => {}));
    const view = await stub.open();
    void view.moveTo("A");
    await vi.waitFor(() => expect(stub.player.Sweep.moveTo).toHaveBeenCalledTimes(1));
    void view.rotate(5, 0);
    expect(stub.player.Camera.rotate).toHaveBeenCalledTimes(1);
  });

  it("drops a turn the player refuses, whether it rejects or throws", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    stub.player.Camera.rotate.mockRejectedValueOnce(new Error("cannot rotate during a transition"));
    await expect(view.rotate(1, 0)).resolves.toBeUndefined();
    stub.player.Camera.rotate.mockImplementationOnce(() => {
      throw new Error("not ready");
    });
    await expect(view.rotate(1, 0)).resolves.toBeUndefined();
  });

  it("turns nothing once disconnected", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    view.disconnect();
    await view.rotate(10, 0);
    expect(stub.player.Camera.rotate).not.toHaveBeenCalled();
  });
});

describe("the Inside view reports its pose", () => {
  it("reads nothing until it is asked: a view that is only steered subscribes to nothing", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    await view.moveTo("A");
    await view.rotate(1, 1);
    view.disconnect();
    expect(stub.player.Camera.pose.subscribe).not.toHaveBeenCalled();
    expect(stub.player.Sweep.data.subscribe).not.toHaveBeenCalled();
    expect(stub.player.frameSize).not.toHaveBeenCalled();
    expect(stub.player.Conversion.worldToScreen).not.toHaveBeenCalled();
  });

  it("hands the listener each pose, as its position and rotation and nothing else of the SDK's", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    const heard: InsidePose[] = [];
    view.onPose((p) => heard.push(p));
    stub.pose(rawPose(1, 2, 90));
    stub.pose(rawPose(1, 3, 45));
    expect(heard).toStrictEqual([
      { position: { x: 1, y: 1.5, z: 2 }, rotation: { x: 0, y: 90 } },
      { position: { x: 1, y: 1.5, z: 3 }, rotation: { x: 0, y: 45 } },
    ]);
  });

  it("keeps one SDK subscription for every listener and for project", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    const a = vi.fn();
    const b = vi.fn();
    view.onPose(a);
    view.project({ x: 0, y: 0, z: 0 });
    view.onPose(b);
    expect(stub.player.Camera.pose.subscribe).toHaveBeenCalledTimes(1);
    stub.pose(rawPose(0, 0, 0));
    expect(a.mock.calls).toEqual([[pose(0, 0, 0)]]);
    expect(b.mock.calls).toEqual([[pose(0, 0, 0)]]);
  });

  it("gives a listener added later the latest pose first: once, and only after onPose has returned", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    const first = vi.fn();
    view.onPose(first);
    stub.pose(rawPose(0, 0, 10));
    const later = vi.fn();
    view.onPose(later);
    expect(later).not.toHaveBeenCalled();
    await told();
    expect(later.mock.calls).toEqual([[pose(0, 0, 10)]]);
    expect(first).toHaveBeenCalledTimes(1);
    stub.pose(rawPose(0, 0, 20));
    expect(later.mock.calls).toEqual([[pose(0, 0, 10)], [pose(0, 0, 20)]]);
    expect(first).toHaveBeenCalledTimes(2);
  });

  it("holds a pose the SDK sends before subscribe returns until onPose has returned", async () => {
    const stub = stubPlayer(rawPose(0, 0, 30));
    const view = await stub.open();
    const listener = vi.fn();
    view.onPose(listener);
    expect(listener).not.toHaveBeenCalled();
    await told();
    expect(listener.mock.calls).toEqual([[pose(0, 0, 30)]]);
  });

  it("tells a listener a pose once, even when one arrives before its first has been told", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    const listener = vi.fn();
    view.onPose(listener);
    stub.pose(rawPose(0, 0, 40));
    await told();
    expect(listener.mock.calls).toEqual([[pose(0, 0, 40)]]);
  });

  it("delivers nothing after its unsubscribe, and goes on telling the other listeners", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    const left = vi.fn();
    const stayed = vi.fn();
    const off = view.onPose(left);
    view.onPose(stayed);
    stub.pose(rawPose(0, 0, 0));
    off();
    stub.pose(rawPose(0, 0, 5));
    off();
    stub.pose(rawPose(0, 0, 9));
    expect(left.mock.calls).toEqual([[pose(0, 0, 0)]]);
    expect(stayed).toHaveBeenCalledTimes(3);
  });

  it("delivers nothing to a listener that unsubscribes before the latest pose has been told to it", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    view.onPose(() => {});
    stub.pose(rawPose(0, 0, 0));
    const listener = vi.fn();
    view.onPose(listener)();
    await told();
    expect(listener).not.toHaveBeenCalled();
  });

  it("delivers nothing after disconnect, and cancels its SDK subscription before it lets the SDK go", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    const listener = vi.fn();
    view.onPose(listener);
    stub.pose(rawPose(0, 0, 0));
    expect(listener).toHaveBeenCalledTimes(1);
    view.disconnect();
    expect(stub.cancelPose).toHaveBeenCalledTimes(1);
    expect(stub.player.disconnect).toHaveBeenCalledTimes(1);
    expect(stub.cancelPose.mock.invocationCallOrder[0]).toBeLessThan(stub.player.disconnect.mock.invocationCallOrder[0]);
    // A callback that was already on its way when the subscription was cancelled.
    stub.pose(rawPose(0, 0, 90));
    await told();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("forgets the pose at disconnect, and keeps none that arrives after it", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    view.onPose(() => {});
    stub.pose(rawPose(0, 0, 0));
    expect(view.project({ x: 0, y: 1.5, z: -5 })).not.toBeNull();
    view.disconnect();
    expect(view.project({ x: 0, y: 1.5, z: -5 })).toBeNull();
    stub.pose(rawPose(0, 0, 0));
    expect(view.project({ x: 0, y: 1.5, z: -5 })).toBeNull();
  });

  it("delivers nothing to a listener added just before disconnect, and takes none after it", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    view.onPose(() => {});
    stub.pose(rawPose(0, 0, 0));
    const before = vi.fn();
    view.onPose(before);
    view.disconnect();
    const after = vi.fn();
    const off = view.onPose(after);
    await told();
    stub.pose(rawPose(0, 0, 5));
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(stub.player.Camera.pose.subscribe).toHaveBeenCalledTimes(1);
    off();
  });

  it("skips a pose it cannot read, and keeps the last one it could", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    const listener = vi.fn();
    view.onPose(listener);
    stub.pose(rawPose(0, 0, 0));
    const unreadable = [
      null,
      {},
      { position: { x: 0, y: 1.5, z: 0 } },
      { position: { x: 0, y: Number.NaN, z: 0 }, rotation: { x: 0, y: 0 } },
      { position: { x: 0, y: 1.5, z: 0 }, rotation: { x: 0, y: Number.POSITIVE_INFINITY } },
    ];
    for (const raw of unreadable) stub.pose(raw);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(view.project({ x: 0, y: 1.5, z: -5 })).toEqual({ x: 640, y: 360 });
  });

  it("still tells the other listeners when one throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = stubPlayer();
    const view = await stub.open();
    view.onPose(() => {
      throw new Error("a bug in a listener");
    });
    const other = vi.fn();
    view.onPose(other);
    stub.pose(rawPose(0, 0, 0));
    expect(other).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("the Inside view projects a point into the player's frame", () => {
  // The camera stands at the origin, 1.5 m up, with yaw 0: it looks along -z.
  const AHEAD = { x: 0, y: 1.5, z: -5 };
  const BEHIND = { x: 0, y: 1.5, z: 5 };
  const BESIDE = { x: 5, y: 1.5, z: 0 };

  async function looking() {
    const stub = stubPlayer();
    const view = await stub.open();
    view.onPose(() => {});
    stub.pose(rawPose(0, 0, 0));
    return { stub, view };
  }

  it("answers null before any pose has arrived, without asking the SDK, and answers once one has", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    expect(view.project(AHEAD)).toBeNull();
    expect(stub.player.Conversion.worldToScreen).not.toHaveBeenCalled();
    // The first call started listening, so no `onPose` is needed for the next to answer.
    stub.pose(rawPose(0, 0, 0));
    expect(view.project(AHEAD)).toEqual({ x: 640, y: 360 });
  });

  it("puts a point in front of the camera at its pixels in the frame", async () => {
    const { view } = await looking();
    expect(view.project(AHEAD)).toStrictEqual({ x: 640, y: 360 });
    // A floor point 5 m ahead shows below the centre.
    expect(view.project({ x: 0, y: 0, z: -5 })).toStrictEqual({ x: 640, y: 552 });
    // In front of the camera but outside the frame: the pixels still come back, for the caller to clip.
    expect(view.project({ x: 10, y: 1.5, z: -1 })).toStrictEqual({ x: 7040, y: 360 });
  });

  it("answers null for a point behind the camera, and for one exactly beside it", async () => {
    const { stub, view } = await looking();
    expect(view.project(BEHIND)).toBeNull();
    // Behind and off to one side, on the floor: the SDK's numbers are finite, mirrored, with z just over 1.
    expect(view.project({ x: -2, y: 0, z: 5 })).toBeNull();
    expect(view.project(BESIDE)).toBeNull();
    // The SDK was asked each time: the answer is read off its z, not guessed.
    expect(stub.player.Conversion.worldToScreen).toHaveBeenCalledTimes(3);
  });

  it("answers null when the SDK's numbers are not finite, whatever z says", async () => {
    const { stub, view } = await looking();
    for (const screen of [
      { x: Number.NaN, y: 360, z: 0.99 },
      { x: 640, y: Number.NEGATIVE_INFINITY, z: 0.99 },
      { x: 640, y: 360, z: Number.NaN },
      { x: 640, y: 360, z: Number.NEGATIVE_INFINITY },
      { x: 640, y: 360, z: 1 },
    ]) {
      stub.player.Conversion.worldToScreen.mockReturnValueOnce(screen);
      expect(view.project(AHEAD), JSON.stringify(screen)).toBeNull();
    }
    expect(view.project(AHEAD)).not.toBeNull();
  });

  it("uses the latest pose, whole, as the SDK sent it", async () => {
    const { stub, view } = await looking();
    // Turned to yaw 90, the camera looks along -x: what was ahead is now beside it.
    const turned = rawPose(0, 0, 90);
    stub.pose(turned);
    const seen = view.project({ x: -5, y: 1.5, z: 0 });
    expect(seen?.x).toBeCloseTo(640);
    expect(seen?.y).toBeCloseTo(360);
    // `worldToScreen` needs the SDK's own pose (its `projection` too), not the one listeners get.
    expect(stub.player.Conversion.worldToScreen.mock.lastCall?.[1]).toBe(turned);
    // And what was beside it at yaw 0 is now behind it.
    expect(view.project(BESIDE)).toBeNull();
  });

  it("uses the frame's size as it is now", async () => {
    const { stub, view } = await looking();
    expect(view.project(AHEAD)).toEqual({ x: 640, y: 360 });
    stub.frame.w = 800;
    stub.frame.h = 600;
    expect(view.project(AHEAD)).toEqual({ x: 400, y: 300 });
    expect(stub.player.Conversion.worldToScreen.mock.lastCall?.[2]).toEqual({ w: 800, h: 600 });
  });

  it("answers null while the frame has no size, without asking the SDK", async () => {
    const { stub, view } = await looking();
    stub.frame.h = 0;
    expect(view.project(AHEAD)).toBeNull();
    expect(stub.player.Conversion.worldToScreen).not.toHaveBeenCalled();
  });
});

describe("the Inside view reads the scan's floor points", () => {
  /** Asks for the floor points and waits out the quiet that says the positions have all arrived. */
  async function ask(view: InsideView) {
    const asked = view.floorPoints();
    await vi.advanceTimersByTimeAsync(SWEEPS_QUIET_MS);
    return asked;
  }

  it("keys each position's floor point by its node id: the puck, not the camera", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubPlayer();
      const view = await stub.open();
      stub.sweeps({ s1: scanPosition("s1", 0, 0), s2: scanPosition("s2", 2, -4) });
      const points = await ask(view);
      expect([...points]).toStrictEqual([
        ["s1", { x: 0, y: 0.02, z: 0 }],
        ["s2", { x: 2, y: 0.02, z: -4 }],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves out a position the scan gives no floor point", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubPlayer();
      const view = await stub.open();
      stub.sweeps({
        s1: scanPosition("s1", 0, 0),
        s2: { sid: "s2", id: "s2", enabled: true, neighbors: [], position: { x: 2, y: 1.5, z: 0 } },
        s3: { ...scanPosition("s3", 4, 0), puckPosition: { x: 4, y: Number.NaN, z: 0 } },
        s4: null,
      });
      expect([...(await ask(view)).keys()]).toEqual(["s1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the positions to stop arriving, and takes the last collection whole", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubPlayer();
      const view = await stub.open();
      let answered = false;
      const asked = view.floorPoints().finally(() => (answered = true));
      // Before the player plays it can send an empty collection: not an answer.
      stub.sweeps({});
      stub.sweeps({ s1: scanPosition("s1", 0, 0) });
      await vi.advanceTimersByTimeAsync(SWEEPS_QUIET_MS - 1);
      stub.sweeps({ s1: scanPosition("s1", 0, 0), s2: scanPosition("s2", 2, 0), s3: scanPosition("s3", 4, 0) });
      await vi.advanceTimersByTimeAsync(SWEEPS_QUIET_MS - 1);
      expect(answered).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect([...(await asked).keys()]).toEqual(["s1", "s2", "s3"]);
      expect(stub.cancelSweeps).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not hang on a scan that sends nothing: it answers empty at the deadline", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubPlayer();
      const view = await stub.open();
      let answered = false;
      const asked = view.floorPoints().finally(() => (answered = true));
      stub.sweeps({});
      await vi.advanceTimersByTimeAsync(FLOOR_POINTS_MS - 1);
      expect(answered).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await asked).size).toBe(0);
      expect(stub.cancelSweeps).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers at the deadline with what has arrived, when the positions never stop arriving", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubPlayer();
      const view = await stub.open();
      let answered = false;
      const asked = view.floorPoints().finally(() => (answered = true));
      const scan: Record<string, unknown> = {};
      const step = SWEEPS_QUIET_MS - 100;
      for (let i = 0; i * step < FLOOR_POINTS_MS; i += 1) {
        expect(answered).toBe(false);
        scan[`s${i}`] = scanPosition(`s${i}`, i, 0);
        stub.sweeps({ ...scan });
        await vi.advanceTimersByTimeAsync(step);
      }
      expect(answered).toBe(true);
      expect((await asked).size).toBe(Object.keys(scan).length);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the scan afresh on every call and keeps nothing: each answer is the caller's own", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubPlayer();
      const view = await stub.open();
      stub.sweeps({ s1: scanPosition("s1", 0, 0) });
      const first = await ask(view);
      expect([...first.keys()]).toEqual(["s1"]);
      (first as Map<string, ScanPoint>).clear();
      // The scan as it stands by the second call, which no subscription was open to hear.
      stub.sweeps({ s1: scanPosition("s1", 0, 0), s2: scanPosition("s2", 2, 0) });
      const second = await ask(view);
      expect([...second.keys()]).toEqual(["s1", "s2"]);
      expect(stub.player.Sweep.data.subscribe).toHaveBeenCalledTimes(2);
      expect(stub.cancelSweeps).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers empty when the view is disconnected while it waits, and lets go of its subscription first", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubPlayer();
      const view = await stub.open();
      stub.sweeps({ s1: scanPosition("s1", 0, 0) });
      const asked = view.floorPoints();
      view.disconnect();
      expect((await asked).size).toBe(0);
      expect(stub.cancelSweeps).toHaveBeenCalledTimes(1);
      expect(stub.cancelSweeps.mock.invocationCallOrder[0]).toBeLessThan(stub.player.disconnect.mock.invocationCallOrder[0]);
      expect(vi.getTimerCount()).toBe(0);
      // A view that is gone is asked nothing.
      expect((await view.floorPoints()).size).toBe(0);
      expect(stub.player.Sweep.data.subscribe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("review fixes: no move or turn is left waiting", () => {
  it("flies a move that asks for more than 10 s in 10 s, and does not give it up early", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const stub = stubPlayer();
      const landings: (() => void)[] = [];
      stub.player.Sweep.moveTo.mockImplementationOnce(() => new Promise<void>((resolve) => landings.push(resolve)));
      const view = await stub.open();
      // Past setTimeout's limit: unclamped, the deadline would fire after about 1 ms.
      const a = view.moveTo("A", 2 ** 31);
      await vi.advanceTimersByTimeAsync(10);
      const next = view.moveTo("B");
      await vi.advanceTimersByTimeAsync(14_000);
      expect(stub.player.Sweep.moveTo.mock.calls).toEqual([["A", { transition: FLY, transitionTime: 10_000 }]]);
      expect(warn).not.toHaveBeenCalled();
      landings[0]();
      await Promise.all([a, next]);
      expect(stub.player.Sweep.moveTo.mock.calls.map(([id]) => id)).toEqual(["A", "B"]);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("resolves a turn the player never finishes within 1 s", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubPlayer();
      stub.player.Camera.rotate.mockImplementationOnce(() => new Promise(() => {}));
      const view = await stub.open();
      const done = vi.fn();
      void view.rotate(5, 0).then(done);
      await vi.advanceTimersByTimeAsync(999);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves a turn still pending when the view disconnects", async () => {
    vi.useFakeTimers();
    try {
      const stub = stubPlayer();
      stub.player.Camera.rotate.mockImplementationOnce(() => new Promise(() => {}));
      const view = await stub.open();
      const done = vi.fn();
      void view.rotate(5, 0).then(done);
      await vi.advanceTimersByTimeAsync(10);
      view.disconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops listening for disconnect once a turn lands or times out", async () => {
    vi.useFakeTimers();
    const add = vi.spyOn(EventTarget.prototype, "addEventListener");
    const remove = vi.spyOn(EventTarget.prototype, "removeEventListener");
    try {
      const stub = stubPlayer();
      const view = await stub.open();
      stub.player.Camera.rotate.mockImplementationOnce(() => new Promise(() => {}));
      add.mockClear();
      remove.mockClear();
      const lost = view.rotate(5, 0);
      await vi.advanceTimersByTimeAsync(1_000);
      await lost;
      await view.rotate(5, 0);
      const added = add.mock.calls.filter(([type]) => type === "abort").map(([, listener]) => listener);
      const removed = remove.mock.calls.filter(([type]) => type === "abort").map(([, listener]) => listener);
      expect(added).toHaveLength(2);
      expect(removed).toEqual(added);
    } finally {
      add.mockRestore();
      remove.mockRestore();
      vi.useRealTimers();
    }
  });

  it("subscribes to the pose again when the first subscribe threw, without the failed listener", async () => {
    const stub = stubPlayer();
    const view = await stub.open();
    stub.player.Camera.pose.subscribe.mockImplementationOnce(() => {
      throw new Error("not ready");
    });
    const ghost = vi.fn();
    expect(() => view.onPose(ghost)).toThrow("not ready");
    const heard: InsidePose[] = [];
    view.onPose((p) => heard.push(p));
    stub.pose(rawPose(1, 2, 90));
    await told();
    expect(stub.player.Camera.pose.subscribe).toHaveBeenCalledTimes(2);
    expect(heard).toStrictEqual([pose(1, 2, 90)]);
    expect(ghost).not.toHaveBeenCalled();
  });
});
