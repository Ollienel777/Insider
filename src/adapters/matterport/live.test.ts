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
  FLY,
  MatterportNotConfiguredError,
  PLAYING,
  type InsideConnect,
  type InsideSdk,
  type InsideView,
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

/** `App.state` of a player that is already playing, so a stubbed Inside view opens at once. */
const playing = (): InsideSdk["App"] => ({
  state: {
    subscribe(observer) {
      observer({ phase: PLAYING });
      return { cancel() {} };
    },
  },
});

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
    for (const file of ["live.ts", "mapping.ts", "../../components/run/inside-view.tsx", "../../components/run/scan-pane.tsx"]) {
      const code = readFileSync(path.join(here, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code.match(FORBIDDEN)?.[0], file).toBeUndefined();
    }
  });
});

describe("the Inside view (stubbed SDK)", () => {
  function stubInside(moveTo: InsideSdk["Sweep"]["moveTo"] = vi.fn(async () => undefined)) {
    const disconnect = vi.fn();
    const connect = vi.fn(async () => ({ App: playing(), Sweep: { moveTo }, disconnect }));
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
      let open: (sdk: InsideSdk) => void = () => {};
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
      open({ App: playing(), Sweep: { moveTo: vi.fn() }, disconnect });
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
    const view = await connectInsideView({} as HTMLElement, "m", "k", async () => ({ App: playing(), Sweep: { moveTo }, disconnect() {} }));
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
    const view = await connectInsideView({} as HTMLElement, "m", "k", async () => ({ App: playing(), Sweep: { moveTo }, disconnect() {} }));
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
      const view = await connectInsideView({} as HTMLElement, "m", "k", async () => ({ App: playing(), Sweep: { moveTo }, disconnect() {} }));
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
      const view = await connectInsideView({} as HTMLElement, "m", "k", async () => ({ App: playing(), Sweep: { moveTo: busy }, disconnect() {} }));
      const moved = view.moveTo("A");
      await vi.advanceTimersByTimeAsync(10_000);
      await moved;
      expect(busy).toHaveBeenCalledTimes(6);
      expect(warn).toHaveBeenCalledTimes(1);

      const missing = vi.fn<InsideSdk["Sweep"]["moveTo"]>(async () => {
        throw new Error("sweep not found");
      });
      const other = await connectInsideView({} as HTMLElement, "m", "k", async () => ({ App: playing(), Sweep: { moveTo: missing }, disconnect() {} }));
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
    let open: (sdk: InsideSdk) => void = () => {};
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
    open({ App: playing(), Sweep: { moveTo: vi.fn() }, disconnect });
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
      const view = await connectInsideView({} as HTMLElement, "m", "k", async () => ({ App: playing(), Sweep: { moveTo }, disconnect() {} }));
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
      return { App: playing(), Sweep: { moveTo: vi.fn(async () => undefined) }, disconnect };
    });
    const stop = new AbortController();
    const view = await connectInsideView({} as HTMLElement, "m", "k", connect, 20_000, stop.signal);
    stop.abort();
    expect(inner?.aborted).toBe(false);
    view.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

/** An `App.state` the test drives: each phase goes to whoever is subscribed, the current one on subscribing, as the SDK sends them. */
function drivenApp(first = "appphase.loading") {
  const observers = new Set<(state: { phase?: string }) => void>();
  const cancel = vi.fn();
  let phase = first;
  const app: InsideSdk["App"] = {
    state: {
      subscribe(observer) {
        observers.add(observer);
        observer({ phase });
        return {
          cancel() {
            cancel();
            observers.delete(observer);
          },
        };
      },
    },
  };
  const send = (next: string) => {
    phase = next;
    observers.forEach((observer) => observer({ phase }));
  };
  return { app, cancel, send, subscribers: () => observers.size };
}

// Issue 117: the SDK connects while the player still loads. A move made then is taken, the
// player's own opening move is refused after it, and the player never leaves its poster.
describe("the Inside view opens only once its player is playing (issue 117)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("does not open while the player loads or starts, opens when playing arrives, and stops listening", async () => {
    const player = drivenApp();
    let opened: InsideView | null = null;
    const opening = connectInsideView({} as HTMLElement, "m", "k", async () => ({
      App: player.app,
      Sweep: { moveTo: vi.fn(async () => undefined) },
      disconnect() {},
    })).then((view) => (opened = view));
    await flush();
    expect(opened).toBeNull();
    expect(player.subscribers()).toBe(1);
    player.send("appphase.starting");
    await flush();
    expect(opened).toBeNull();
    player.send(PLAYING);
    await opening;
    expect(opened).not.toBeNull();
    await flush();
    expect(player.cancel).toHaveBeenCalledTimes(1);
    expect(player.subscribers()).toBe(0);
  });

  it("fails a player that never plays at the connect deadline, the one bound for both, and disconnects it", async () => {
    vi.useFakeTimers();
    try {
      const player = drivenApp();
      const disconnect = vi.fn();
      // The connection itself takes 60 of the 100 ms: the wait for playing gets what is left, not a deadline of its own.
      const connect: InsideConnect = async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { App: player.app, Sweep: { moveTo: vi.fn() }, disconnect };
      };
      const view = connectInsideView({} as HTMLElement, "m", "k", connect, 100);
      const settled = expect(view).rejects.toMatchObject({ name: "TimeoutError", message: expect.stringContaining("within 100 ms") });
      await vi.advanceTimersByTimeAsync(99);
      expect(player.subscribers()).toBe(1);
      expect(disconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await settled;
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(player.cancel).toHaveBeenCalledTimes(1);
      expect(player.subscribers()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets go of a player still loading when the caller stops waiting, and stops listening", async () => {
    const player = drivenApp();
    const disconnect = vi.fn();
    const stop = new AbortController();
    const view = connectInsideView(
      {} as HTMLElement,
      "m",
      "k",
      async () => ({ App: player.app, Sweep: { moveTo: vi.fn() }, disconnect }),
      20_000,
      stop.signal,
    );
    const settled = expect(view).rejects.toThrow("given up on");
    await flush();
    expect(player.subscribers()).toBe(1);
    stop.abort();
    await settled;
    expect(disconnect).toHaveBeenCalledTimes(1);
    await flush();
    expect(player.cancel).toHaveBeenCalledTimes(1);
    expect(player.subscribers()).toBe(0);
  });
});
