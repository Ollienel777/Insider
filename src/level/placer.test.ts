// The placer on the cached F1 manifest (data/levels/F1.json) and the F1 floor
// (fixtures/floors/F1.json), plus small hand-made floors for the general rules.
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { type FloorGraph, LevelManifest } from "@/domain";
import { act, type Action, compileBoard, createRun, DEFAULT_HEARING, type RunState, watched } from "@/engine";
import cached from "../../data/levels/F1.json";
import { ANCHORS, ENTRY_CLEARANCE, placeLevel, PlacementError, type PlacedLevel } from "./placer";
import { quietRoute } from "./quiet-route";

const manifest = (): LevelManifest => LevelManifest.parse(structuredClone(cached));
const floor = (): FloorGraph => structuredClone(FIXTURE_FLOORS.F1);
const SEED = 7;
const placeF1 = (seed = SEED): PlacedLevel => placeLevel(manifest(), floor(), seed);
const SEEDS = Array.from({ length: 24 }, (_, i) => i);

/** Plays the actions in order; a refused action fails the test with its reason. */
function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action, i) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`action ${i} (${JSON.stringify(action)}) refused: ${result.reason}`);
    return result.run;
  }, run);
}

/**
 * The quiet route on F1, as `quietRoute` computes it from the placement and
 * the crew's advice reads it: wait one turn at the freight lift, so C2 is on its
 * other half when the player enters the corridor; pick the records door from
 * dc-east, out of C2's cover; and on the way out wait once at dc-east so the
 * corridor is on the safe half again.
 */
const QUIET_ROUTE: readonly Action[] = [
  { kind: "move", to: F1_DEMO.freightLiftWait }, // turn 0
  { kind: "wait" }, // 1: C2 watches dc-west
  { kind: "move", to: "dc-west" }, // 2: C2 watches dc-mid
  { kind: "move", to: "dc-mid" }, // 3: C2 watches dc-west
  { kind: "move", to: "dc-east" }, // 4
  { kind: "pick", doorId: F1_DEMO.recordsDoor }, // 5
  { kind: "pick", doorId: F1_DEMO.recordsDoor }, // 6: open
  { kind: "move", to: "rr-door" }, // 7
  { kind: "move", to: F1_DEMO.objective }, // 8
  { kind: "take" }, // 9
  { kind: "move", to: "rr-door" }, // 10
  { kind: "move", to: "dc-east" }, // 11
  { kind: "wait" }, // 12: C2 watches dc-mid
  { kind: "move", to: "dc-mid" }, // 13: C2 watches dc-west
  { kind: "move", to: "dc-west" }, // 14: C2 watches dc-mid
  { kind: "move", to: F1_DEMO.freightLiftWait }, // 15
  { kind: "move", to: F1_DEMO.dockEntry }, // 16: out with the files
];

/** Moves from the nearest of `from` to every node of the floor. */
function hopsFrom(graph: FloorGraph, from: readonly string[]): Map<string, number> {
  const dist = new Map(from.map((id) => [id, 0]));
  const queue = [...from];
  for (let i = 0; i < queue.length; i++) {
    for (const e of graph.edges) {
      const next = e.a === queue[i] ? e.b : e.b === queue[i] ? e.a : null;
      if (next && !dist.has(next)) {
        dist.set(next, dist.get(queue[i])! + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

const entryNodes = (graph: FloorGraph) => graph.nodes.filter((n) => n.tags.includes("entry")).map((n) => n.id);

describe("placeLevel on F1 from the cached manifest", () => {
  const placed = placeF1();
  const { level } = placed;

  it("posts 4 guards, the profile's camera count, the dock and roof entries and a locked records door", () => {
    const m = manifest();
    expect(m.securityProfile).toMatchObject({ guardCount: 4, cameraCount: 2 });
    expect(placed.guards.map((g) => g.id)).toEqual(["G1", "G2", "G3", "G4"]);
    expect(level.guards).toHaveLength(4);
    expect(placed.cameras.map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(level.cameras).toHaveLength(m.securityProfile.cameraCount);
    expect(placed.entries.map((e) => [e.entryId, e.kind, e.nodeId])).toEqual([
      ["dock-N", "dock", F1_DEMO.dockEntry],
      ["roof", "roof", F1_DEMO.roofEntry],
    ]);
    expect(level.start).toBe(F1_DEMO.dockEntry);
    expect(level.exits).toEqual([F1_DEMO.dockEntry, F1_DEMO.roofEntry]);
    expect(level.lockedDoors).toContain(F1_DEMO.recordsDoor);
    expect(placed.locks.find((l) => l.doorId === F1_DEMO.recordsDoor)?.zoneId).toBe("objective");
    expect(level.objective).toBe(F1_DEMO.objective);
    expect(level.pickTurns).toBe(2);
    expect(level.patrolTempo).toBe(1);
  });

  it("reads the camera count from the security profile", () => {
    for (const cameraCount of [1, 3, 4]) {
      const m = manifest();
      m.securityProfile.cameraCount = cameraCount;
      const p = placeLevel(m, floor(), SEED);
      expect(p.cameras).toHaveLength(cameraCount);
      expect(p.level.cameras).toHaveLength(cameraCount);
      expect(new Set(p.cameras.flatMap((c) => c.cover)).size).toBe(p.cameras.reduce((n, c) => n + c.cover.length, 0));
    }
  });

  it("posts C2 on the F1_DEMO dock corridor, its nearest node 2–3 moves from the dock entry and seen from it", () => {
    const c2 = placed.cameras.find((c) => c.id === "C2")!;
    // The dock corridor short of the records door, where the lock is picked (see the quiet-route test).
    expect(c2.cover).toEqual(["dc-west", "dc-mid"]);
    expect(c2.cover).toEqual(F1_DEMO.c2Cover);
    expect(c2.kind).toBe("analog-sweep");
    expect(c2.approach.nodeId).toBe("dc-west");
    expect(c2.approach.hops).toBeGreaterThanOrEqual(2);
    expect(c2.approach.hops).toBeLessThanOrEqual(3);
    expect(hopsFrom(level.floor, [F1_DEMO.dockEntry]).get(c2.approach.nodeId)).toBe(c2.approach.hops);
    expect(c2.approach.visibleFromStart).toBe(true);
    expect(level.floor.sightlines[level.start]).toContain(c2.approach.nodeId);
    expect(level.cameras?.find((c) => c.id === "C2")).toEqual({ id: "C2", kind: "analog-sweep", cover: c2.cover, phase: 1 });
  });

  it("times C2 so walking straight in meets it, and waiting one turn at the freight lift does not", () => {
    const c2 = compileBoard(level).cameras.find((c) => c.id === "C2")!;
    // Straight in: fl-lobby on turn 0, dc-west on turn 1.
    expect(watched(c2, 1)).toContain("dc-west");
    // Wait one turn at the freight lift: dc-west on turn 2.
    expect(watched(c2, 2)).not.toContain("dc-west");
  });

  it("puts no camera on the node the records door is picked from, and no round within earshot of it", () => {
    const pickFrom = "dc-east";
    expect(level.floor.edges.find((e) => e.door?.id === F1_DEMO.recordsDoor)).toMatchObject({ a: pickFrom });
    for (const camera of level.cameras ?? []) expect(camera.cover).not.toContain(pickFrom);
    const earshot = hopsFrom(level.floor, [pickFrom]);
    for (const guard of level.guards) {
      for (const id of guard.patrol) expect(earshot.get(id)!, `${guard.id} at ${id}`).toBeGreaterThan(DEFAULT_HEARING);
    }
  });

  it("trips the alarm when the player steps straight into C2's view (beat 5)", () => {
    for (const seed of SEEDS) {
      const run = play(createRun(placeF1(seed).level), [
        { kind: "move", to: F1_DEMO.freightLiftWait },
        { kind: "move", to: "dc-west" },
      ]);
      expect(run.turns.map((t) => t.alarm), `seed ${seed}`).toEqual(["calm", "alert"]);
      expect(run.alarmEvents[0]?.cause, `seed ${seed}`).toEqual({ kind: "camera", id: "C2" });
    }
  });

  it("has a quiet route from the dock to the files and back out, the crew's advice (beat 4)", () => {
    for (const seed of SEEDS) {
      const p = placeF1(seed);
      const route = quietRoute(p);
      expect(route, `seed ${seed}`).toEqual(QUIET_ROUTE);
      const run = play(createRun(p.level), route!);
      expect(run.alarmEvents, `seed ${seed}`).toEqual([]);
      expect(new Set(run.turns.map((t) => t.alarm)), `seed ${seed}`).toEqual(new Set(["calm"]));
      expect(run.status, `seed ${seed}`).toBe("won");
    }
  });

  it("has no quiet route when there is no time for one, or every node of the corridor is watched", () => {
    expect(quietRoute(placed, 10)).toBeNull();
    const m = manifest();
    m.securityProfile.cameraKind = "fixed-ip";
    expect(quietRoute(placeLevel(m, floor(), SEED))).toBeNull();
  });

  it("posts G4 for the dock: the Vexcel dock entry's provenance first, then its own from Class A (#21)", () => {
    const m = manifest();
    const p = placeLevel(m, floor(), SEED);
    const g4 = p.guards.find((g) => g.id === "G4")!;
    expect(g4.post?.entryId).toBe("dock-N");
    expect(g4.patrol).toEqual(["el-south"]);
    expect(g4.roomId).toBe("elevator-lobby");
    // The same objects the manifest holds, in this order: the dock tag, then the guard force.
    const dockEntry = m.provenance.find((e) => e.elementRole === "entry:dock-N")!;
    const fourth = m.provenance.find((e) => e.elementRole === "guard:G4")!;
    expect(g4.provenance).toEqual([dockEntry, fourth]);
    expect(g4.provenance[0]).toBe(dockEntry);
    expect(g4.provenance[1]).toBe(fourth);
    expect(dockEntry).toMatchObject({ layer: "vexcel", field: "entries.kind", value: "dock" });
    expect(fourth).toMatchObject({ layer: "costar", field: "buildingClass", value: "A" });
    // Only the post carries the dock entry; the other three walk rounds.
    for (const guard of p.guards.filter((g) => g.id !== "G4")) {
      expect(guard.post).toBeUndefined();
      expect(guard.provenance.map((e) => e.elementRole)).not.toContain("entry:dock-N");
    }
    expect(p.level.guards.find((g) => g.id === "G4")?.patrol).toEqual(["el-south"]);
  });

  it("holds the dock post whatever the seed, out of sight of the way in and out of earshot of the records door", () => {
    const nearStart = [...hopsFrom(floor(), [F1_DEMO.dockEntry])].filter(([, d]) => d <= ENTRY_CLEARANCE).map(([id]) => id);
    for (const seed of SEEDS) {
      const g4 = placeF1(seed).guards.find((g) => g.id === "G4")!;
      expect(g4.patrol, `seed ${seed}`).toEqual(["el-south"]);
    }
    const sees = floor().sightlines["el-south"];
    for (const id of nearStart) expect(sees, id).not.toContain(id);
    expect(hopsFrom(floor(), ["dc-east"]).get("el-south")!).toBeGreaterThan(DEFAULT_HEARING);
  });

  it("moves the dock post off a node that sees the way in (R3-M2: the sightline rule)", () => {
    // Give el-south, the post on F1, a line of sight to the dock entry itself.
    const f = floor();
    f.sightlines["el-south"] = [...(f.sightlines["el-south"] ?? []), F1_DEMO.dockEntry];
    const nearStart = new Set([...hopsFrom(f, [F1_DEMO.dockEntry])].filter(([, d]) => d <= ENTRY_CLEARANCE).map(([id]) => id));
    const g4 = placeLevel(manifest(), f, SEED).guards.find((g) => g.id === "G4")!;
    expect(g4.post?.entryId).toBe("dock-N");
    expect(g4.patrol).toHaveLength(1);
    expect(g4.patrol[0]).not.toBe("el-south");
    for (const id of f.sightlines[g4.patrol[0]] ?? []) expect(nearStart.has(id), `${g4.patrol[0]} sees ${id}`).toBe(false);
  });

  it("moves the dock post off a camera's cover (R3-M2: the camera-cover rule)", () => {
    // Anchor C1 on el-south, the post on F1.
    const anchors = { ...ANCHORS.F1, cameras: { ...ANCHORS.F1.cameras, C1: ["el-south"] } };
    const p = placeLevel(manifest(), floor(), SEED, anchors);
    expect(p.cameras.find((c) => c.id === "C1")?.cover).toEqual(["el-south"]);
    const g4 = p.guards.find((g) => g.id === "G4")!;
    expect(g4.post?.entryId).toBe("dock-N");
    expect(g4.patrol).toHaveLength(1);
    expect(g4.patrol[0]).not.toBe("el-south");
    const covered = new Set(p.cameras.flatMap((c) => c.cover));
    expect(covered.has(g4.patrol[0])).toBe(false);
  });

  it("posts no guard without a dock entry, and every guard walks a round", () => {
    const m = manifest();
    m.entries = m.entries.filter((e) => e.kind !== "dock");
    const p = placeLevel(m, floor(), SEED);
    expect(p.guards.map((g) => g.id)).toEqual(["G1", "G2", "G3", "G4"]);
    expect(p.guards.every((g) => g.post === undefined)).toBe(true);
    for (const guard of p.guards) expect(guard.provenance.map((e) => e.elementRole)).toContain("profile:patrolTempo");
  });

  it("starts no guard's round within two moves of an entry node", () => {
    const fromEntries = hopsFrom(level.floor, entryNodes(level.floor));
    for (const guard of level.guards) {
      expect(fromEntries.get(guard.patrol[0]), guard.id).toBeGreaterThan(ENTRY_CLEARANCE);
    }
  });

  it("keeps rounds out of quiet zones, the locked rooms and the way in", () => {
    const quiet = new Set(placed.zones.filter((z) => z.role === "quiet").flatMap((z) => z.nodes));
    const locked = new Set(placed.zones.filter((z) => z.role === "objective" || z.role === "secure").flatMap((z) => z.nodes));
    for (const guard of level.guards) {
      for (const id of guard.patrol) {
        expect(quiet.has(id), `${guard.id} at ${id}`).toBe(false);
        expect(locked.has(id), `${guard.id} at ${id}`).toBe(false);
        expect(F1_DEMO.c2Cover as readonly string[]).not.toContain(id);
      }
    }
  });

  it("maps the zones onto rooms", () => {
    const zone = (id: string) => placed.zones.find((z) => z.zoneId === id);
    expect(zone("quiet-2202")?.roomIds).toEqual(["suites-2202-2205"]);
    expect(zone("quiet-2209")?.roomIds).toEqual(["suites-2206-2209"]);
    expect(zone("quiet-2210")?.roomIds).toEqual(["office-2210"]);
    expect(zone("objective")?.roomIds).toEqual(["records-room"]);
    expect(zone("secure")?.roomIds).toEqual(["server-closet"]);
    expect(level.lockedDoors).toContain("d-server-closet");
    expect(level.zones?.["dock-N"]).toEqual([F1_DEMO.dockEntry]);
    // F1's floor 22 has no occupied suite left, and only two entry nodes.
    expect(placed.unplaced.map((u) => u.elementRole)).toEqual([
      "entry:garage-E",
      "entry:lobby-S",
      "entry:exit-W",
      "zone:crowded-22",
    ]);
  });

  it("gives every placed element its manifest provenance entries, the same objects", () => {
    const m = manifest();
    const p = placeLevel(m, floor(), SEED);
    const elements = [...p.entries, ...p.zones, p.objective, ...p.locks, ...p.cameras, ...p.guards];
    expect(elements.length).toBeGreaterThan(0);
    for (const element of elements) {
      expect(element.provenance.length).toBeGreaterThan(0);
      for (const entry of element.provenance) expect(m.provenance.includes(entry) || m.zones.some((z) => z.provenance.includes(entry))).toBe(true);
    }
    const role = (el: { provenance: readonly { elementRole: string }[] }) => el.provenance.map((e) => e.elementRole);
    expect(role(p.guards[3])).toContain("guard:G4");
    expect(role(p.cameras.find((c) => c.id === "C2")!)).toContain("camera:C2");
    expect(role(p.entries[0])).toEqual(["entry:dock-N"]);
    expect(role(p.locks.find((l) => l.doorId === F1_DEMO.recordsDoor)!)).toEqual(["profile:lockKind", "zone:objective"]);
  });

  it("gives an engine run that starts calm on the dock, and plays", () => {
    const run = createRun(level);
    expect(run.alarm).toBe("calm");
    expect(run.status).toBe("playing");
    expect(run.playerNode).toBe(F1_DEMO.dockEntry);
    expect(run.locked).toContain(F1_DEMO.recordsDoor);
    expect(run.guards.map((g) => g.nodeId)).toEqual(level.guards.map((g) => g.patrol[0]));
    expect(level.quietZones).toContain("quiet-2202");
    expect(play(run, [{ kind: "move", to: F1_DEMO.freightLiftWait }]).alarm).toBe("calm");
  });
});

describe("placeLevel is deterministic", () => {
  it("gives the same placement for the same inputs and seed", () => {
    expect(placeF1(42)).toEqual(placeF1(42));
    expect(JSON.stringify(placeF1(42))).toBe(JSON.stringify(placeF1(42)));
  });

  it("does not depend on the order of the floor's nodes, edges and rooms", () => {
    const shuffled = floor();
    shuffled.nodes.reverse();
    shuffled.edges.reverse();
    shuffled.rooms.reverse();
    const a = placeF1(42);
    const b = placeLevel(manifest(), shuffled, 42);
    expect(b.guards.map((g) => g.patrol)).toEqual(a.guards.map((g) => g.patrol));
    expect(b.cameras.map((c) => c.cover)).toEqual(a.cameras.map((c) => c.cover));
    expect(b.level.lockedDoors).toEqual(a.level.lockedDoors);
  });

  it("lets the seed move where guards start, inside the same rules", () => {
    const starts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => JSON.stringify(placeF1(seed).level.guards)));
    expect(starts.size).toBeGreaterThan(1);
    // C2's post and timing are the demo's, whatever the seed.
    for (const seed of [1, 2, 3]) expect(placeF1(seed).level.cameras).toEqual(placeF1(SEED).level.cameras);
  });

  it("leaves its inputs untouched", () => {
    const m = manifest();
    const f = floor();
    const before = JSON.stringify([m, f]);
    placeLevel(m, f, SEED);
    expect(JSON.stringify([m, f])).toBe(before);
  });
});

describe("placeLevel without the F1 anchors", () => {
  it("still finds the dock, roof, objective and records door from the floor itself", () => {
    const p = placeLevel(manifest(), floor(), SEED, {});
    expect(p.entries.map((e) => e.nodeId)).toEqual([F1_DEMO.dockEntry, F1_DEMO.roofEntry]);
    expect(p.level.objective).toBe(F1_DEMO.objective);
    expect(p.level.lockedDoors).toContain(F1_DEMO.recordsDoor);
    expect(p.cameras).toHaveLength(2);
  });

  it("ignores anchors whose ids are not on the floor", () => {
    const p = placeLevel(manifest(), floor(), SEED, { cameras: { C2: ["nowhere"] }, entries: { dock: "nowhere" } });
    expect(p.entries[0].nodeId).toBe(F1_DEMO.dockEntry);
    expect(p.cameras.flatMap((c) => c.cover)).not.toContain("nowhere");
  });
});

describe("placeLevel refuses what it cannot run", () => {
  it("throws on a fractional seed", () => {
    expect(() => placeLevel(manifest(), floor(), 1.5)).toThrow(PlacementError);
  });

  it("throws on a floor with no room left for the objective", () => {
    const f: FloorGraph = {
      nodes: [
        { id: "a", x: 0, y: 0, roomId: "only", tags: ["entry"] },
        { id: "b", x: 1, y: 0, roomId: "only", tags: [] },
      ],
      edges: [{ a: "a", b: "b" }],
      rooms: [{ id: "only", label: "Hall", rect: { x: 0, y: 0, w: 2, h: 1 } }],
      sightlines: { a: ["b"], b: ["a"] },
      source: "matterport",
    };
    expect(() => placeLevel(manifest(), f, SEED, {})).toThrow(/objective/);
  });
});

describe("placeLevel on a floor from a live scan (no entry tags, no named records room)", () => {
  it("offers the floor's lifts and stairs as entries when no node is tagged entry: the dock by a lift, the roof by a stair", () => {
    const f = floor();
    for (const n of f.nodes) n.tags = n.tags.filter((t) => t !== "entry");
    const p = placeLevel(manifest(), f, SEED, {});
    const kinds = new Map(p.entries.map((e) => [e.kind, e.nodeId]));
    expect(f.nodes.find((n) => n.id === kinds.get("dock"))?.tags).toContain("lift");
    expect(f.nodes.find((n) => n.id === kinds.get("roof"))?.tags).toContain("stair");
    // Only the stairs and lifts count as ways in, so guards still find rounds clear of them; on a
    // scan no two start on one node, so a round with one start takes one guard.
    expect(p.guards.length).toBeGreaterThan(0);
    expect(new Set(p.guards.map((g) => g.patrol[0])).size).toBe(p.guards.length);
    expect(p.unplaced.filter((u) => u.elementRole.startsWith("guard:") && !/start on its round/.test(u.reason))).toEqual([]);
  });

  it("offers the edge of the plate when there are no stairs or lifts either, farthest from the centre first", () => {
    const f = floor();
    for (const n of f.nodes) n.tags = [];
    const p = placeLevel(manifest(), f, SEED, {});
    const cx = f.nodes.reduce((s, n) => s + n.x, 0) / f.nodes.length;
    const cy = f.nodes.reduce((s, n) => s + n.y, 0) / f.nodes.length;
    const far = (id: string) => {
      const n = f.nodes.find((m) => m.id === id)!;
      return (n.x - cx) ** 2 + (n.y - cy) ** 2;
    };
    const farthest = Math.max(...f.nodes.map((n) => far(n.id)));
    expect(far(p.entries[0].nodeId)).toBe(farthest);
    expect(new Set(p.entries.map((e) => e.nodeId)).size).toBe(p.entries.length);
    // Only the nodes the entries took count as ways in: the guards still get rounds clear of them.
    expect(p.guards).toHaveLength(placeF1().guards.length);
    expect(p.unplaced.filter((u) => u.elementRole.startsWith("guard:"))).toEqual([]);
    const exits = new Set(p.entries.map((e) => e.nodeId));
    for (const g of p.guards) expect(g.patrol.some((id) => exits.has(id)), g.id).toBe(false);
    expect(p.cameras.flatMap((c) => c.cover).some((id) => exits.has(id))).toBe(false);
  });

  it("keeps guard rounds and camera covers off the nodes the entries took, wherever they land", () => {
    const f = floor();
    for (const n of f.nodes) n.tags = [];
    for (const node of f.nodes) {
      const p = placeLevel(manifest(), structuredClone(f), SEED, { entries: { roof: node.id } });
      const exits = new Set(p.entries.map((e) => e.nodeId));
      for (const g of p.guards) {
        if (g.post) continue;
        expect(g.patrol.filter((id) => exits.has(id)), `${node.id}: ${g.id}`).toEqual([]);
      }
      expect(p.cameras.flatMap((c) => c.cover).filter((id) => exits.has(id)), node.id).toEqual([]);
    }
  });

  it("puts the objective in the free room farthest from the start when no room's name fits it", () => {
    const f = floor();
    for (const r of f.rooms) if (r.id === "records-room") r.label = "Storage";
    const p = placeLevel(manifest(), f, SEED, {});
    const objectiveRoom = f.nodes.find((n) => n.id === p.level.objective)!.roomId;
    for (const e of p.entries) expect(objectiveRoom).not.toBe(f.nodes.find((n) => n.id === e.nodeId)!.roomId);
    expect(placeLevel(manifest(), f, SEED, {}).level.objective).toBe(p.level.objective);
  });

  it("posts guards on a small scanned floor, where no node is two moves clear of the start and the entries", () => {
    // Ten sweeps in a ring over three rooms, no tags: the shape of a small live scan, where every
    // node is within two moves of the start or an entry.
    const N = 10;
    const ids = Array.from({ length: N }, (_, i) => `s${String(i).padStart(2, "0")}`);
    const at = (i: number) => ({ x: 10 * Math.cos((i / N) * 2 * Math.PI), y: 10 * Math.sin((i / N) * 2 * Math.PI) });
    const roomOf = (i: number) => ["north", "south", "west"][Math.floor(i / 4)];
    const small: FloorGraph = {
      nodes: ids.map((id, i) => ({ id, ...at(i), roomId: roomOf(i), tags: [] })),
      edges: ids.map((id, i) => {
        const next = ids[(i + 1) % N];
        return roomOf(i) === roomOf((i + 1) % N) ? { a: id, b: next } : { a: id, b: next, door: { id: `door:${id}`, lockable: false } };
      }),
      rooms: ["north", "south", "west"].map((id, k) => ({ id, label: `Open Floor ${k + 1}`, rect: { x: -10, y: -10, w: 20, h: 20 } })),
      sightlines: Object.fromEntries(ids.map((id, i) => [id, ids.filter((o, j) => o !== id && roomOf(j) === roomOf(i))])),
      source: "matterport",
    };
    const p = placeLevel(manifest(), small, SEED, {});
    expect(p.guards.length).toBeGreaterThan(0);
    const exits = new Set(p.entries.map((e) => e.nodeId));
    for (const g of p.guards) {
      expect(g.patrol.some((id) => exits.has(id)), g.id).toBe(false);
      expect(g.patrol.includes(p.entries[0].nodeId), g.id).toBe(false);
    }
    const run = createRun(p.level);
    expect(run.status).toBe("playing");
  });

  it("leaves F1's own placement as it was", () => {
    const p = placeF1();
    expect(p.entries.map((e) => e.nodeId)).toEqual([F1_DEMO.dockEntry, F1_DEMO.roofEntry]);
    expect(p.level.objective).toBe(F1_DEMO.objective);
  });
});

describe("placeLevel on an open-plan scan (second review)", () => {
  // An n×n open floor, an office off its east side and a meeting room off its south side, no tags.
  // Sightlines are the whole room, as a scan's are.
  function openPlan(n = 4): FloorGraph {
    const nodes: FloorGraph["nodes"] = [];
    const edges: FloorGraph["edges"] = [];
    const add = (id: string, x: number, y: number, roomId: string) => nodes.push({ id, x, y, roomId, tags: [] });
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) add(`n${r}${c}`, c * 3, r * 3, "open");
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (c < n - 1) edges.push({ a: `n${r}${c}`, b: `n${r}${c + 1}` });
        if (r < n - 1) edges.push({ a: `n${r}${c}`, b: `n${r + 1}${c}` });
      }
    add("o1", n * 3, 3, "office");
    add("o2", n * 3 + 3, 3, "office");
    edges.push({ a: `n1${n - 1}`, b: "o1", door: { id: "door:o", lockable: false } }, { a: "o1", b: "o2" });
    add("m1", 3, n * 3, "meeting");
    add("m2", 6, n * 3, "meeting");
    add("m3", 9, n * 3, "meeting");
    edges.push({ a: `n${n - 1}1`, b: "m1", door: { id: "door:m", lockable: false } }, { a: "m1", b: "m2" }, { a: "m2", b: "m3" });
    const room = new Map(nodes.map((n) => [n.id, n.roomId]));
    return {
      nodes,
      edges,
      rooms: [
        { id: "open", label: "Open Floor", rect: { x: 0, y: 0, w: (n - 1) * 3, h: (n - 1) * 3 } },
        { id: "office", label: "Office", rect: { x: n * 3, y: 3, w: 3, h: 1 } },
        { id: "meeting", label: "Meeting Room", rect: { x: 3, y: n * 3, w: 6, h: 1 } },
      ],
      sightlines: Object.fromEntries(nodes.map((n) => [n.id, nodes.filter((m) => m.id !== n.id && room.get(m.id) === n.roomId).map((m) => m.id)])),
      source: "matterport",
    };
  }

  it("lets the player take a first step without being seen, even starting in the open room", () => {
    const f = openPlan(6);
    for (const seed of [0, 1, 2, 7, 11]) {
      // The dock in the open room's corner: every node of that room sees the start.
      const p = placeLevel(manifest(), structuredClone(f), seed, { entries: { dock: "n00" } });
      expect(p.entries[0].nodeId).toBe("n00");
      const run = createRun(p.level);
      const start = run.playerNode;
      const steps = f.edges.flatMap((e) => (e.a === start ? [e.b] : e.b === start ? [e.a] : []));
      expect(steps.length).toBeGreaterThan(0);
      for (const to of steps) {
        const result = act(run, { kind: "move", to });
        expect(result.ok, `${seed}: ${to}`).toBe(true);
        if (result.ok) expect(result.run.alarm, `seed ${seed}, first step to ${to}`).toBe(run.alarm);
      }
    }
  });

  it("starts no two guards on the same node", () => {
    const f = openPlan();
    for (const seed of [0, 1, 2, 7, 11]) {
      const p = placeLevel(manifest(), structuredClone(f), seed, {});
      const starts = p.guards.map((g) => g.patrol[0]);
      expect(new Set(starts).size, `seed ${seed}: ${starts.join(" ")}`).toBe(starts.length);
    }
  });

  it("never puts the objective on a way in", () => {
    const f = openPlan();
    for (const seed of [0, 1, 2, 7, 11]) {
      const p = placeLevel(manifest(), structuredClone(f), seed, {});
      expect(p.entries.map((e) => e.nodeId)).not.toContain(p.level.objective);
    }
  });
});
