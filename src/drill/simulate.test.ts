import { describe, expect, it } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import type { Building, FloorGraph } from "@/domain";
import {
  DRILL_FLOOR,
  DrillError,
  headcountFor,
  NODE_CAPACITY,
  SF_PER_PERSON,
  simulateDrill,
  WALK_SPEED_M_S,
  type DrillReport,
} from ".";

const F1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
const F1_FLOOR = FIXTURE_FLOORS.F1;

/** A floor 5 of a building like F1, with no vacancy and `typicalFloorSf` set so the headcount is `people`. */
function buildingWith(people: number, overrides: Partial<Building> = {}): Building {
  return { ...F1, id: "T1", typicalFloorSf: people * SF_PER_PERSON, availableSpace: [], ...overrides };
}

function floorOf(spec: {
  rooms: [id: string, label: string, w?: number][];
  nodes: [id: string, x: number, y: number, roomId: string, stair?: boolean][];
  edges: [a: string, b: string, door?: string][];
}): FloorGraph {
  return {
    rooms: spec.rooms.map(([id, label, w = 10], i) => ({ id, label, rect: { x: i * 10, y: 0, w, h: 10 } })),
    nodes: spec.nodes.map(([id, x, y, roomId, stair]) => ({ id, x, y, roomId, tags: stair ? ["stair"] : [] })),
    edges: spec.edges.map(([a, b, door]) => (door ? { a, b, door: { id: door, lockable: false } } : { a, b })),
    sightlines: {},
    source: "fixture",
  };
}

/** Every occupant either clears into an open stair, or is listed as stranded; nobody is both or neither. */
function expectAccounted(report: DrillReport) {
  const stranded = new Set(report.stranded.map((s) => s.occupantId));
  for (const o of report.occupants) {
    if (stranded.has(o.id)) {
      expect(o.clearedAtS, o.id).toBeNull();
      expect(o.stair, o.id).toBeNull();
    } else {
      expect(o.clearedAtS, o.id).toEqual(expect.any(Number));
      expect(report.openStairs, o.id).toContain(o.stair);
      expect(o.path.at(-1), o.id).toBe(o.stair);
    }
  }
  expect(report.occupants.length + report.stranded.filter((s) => s.roomId === null).length).toBe(report.headcount.count);
  expect(report.allClear).toBe(report.stranded.length === 0);
}

describe("the drill on F1 (Halvorsen Tower), its real floor and occupancy", () => {
  const report = simulateDrill(F1, F1_FLOOR);
  const baseline = simulateDrill(F1, F1_FLOOR, { blockedStair: null });

  it("drills the staged floor by default, as the spec does", () => {
    expect(DRILL_FLOOR).toBe("staged");
    expect(report.headcount.floor).toBe(22);
    expect(report.headcount.choice).toBe("staged");
  });

  it("counts floor 22's occupied area ÷ 250 sf, and says so", () => {
    const available = F1.availableSpace.filter((s) => s.floor === 22).reduce((sum, s) => sum + s.sf, 0);
    const occupied = F1.typicalFloorSf - available;
    expect(occupied).toBe(1509);
    expect(report.headcount).toMatchObject({
      typicalFloorSf: 24850,
      availableSf: available,
      occupiedSf: occupied,
      sfPerPerson: 250,
      count: Math.round(occupied / 250),
    });
    expect(report.occupants).toHaveLength(6);
    expect(report.headcount.rule).toBe(
      "Floor 22: a 24,850 sf floor with 23,341 sf available leaves 1,509 sf occupied ÷ 250 sf per person = 6 occupants",
    );
    expect(report.provenance.map((p) => [p.layer, p.field])).toEqual([
      ["costar", "typicalFloorSf"],
      ["costar", "availableSpace"],
    ]);
  });

  it("puts nobody in a vacant suite: every suite on 22 is available, so the occupants are in the other rooms", () => {
    expect(report.placement).toBe("other rooms");
    const rooms = new Set(report.occupants.map((o) => o.roomId));
    expect([...rooms].sort()).toEqual(["records-room", "server-closet"]);
  });

  it("blocks Stair B, which ties with Stair A at 3 of 6, and says it won the tie on time", () => {
    expect(report.scenario.blockedStair).toEqual({ nodeId: "ws-landing", label: "West Stair (Stair B)" });
    expect(baseline.occupants.filter((o) => o.stair === "ws-landing")).toHaveLength(3);
    expect(baseline.occupants.filter((o) => o.stair === "es-landing")).toHaveLength(3);
    expect(report.scenario.wouldUse).toBe(3);
    expect(report.scenario.rule).toBe(
      "East Stair (Stair A) and West Stair (Stair B) would each be used by 3 of 6 occupants, a tie. " +
        "A tie goes to the stair whose loss costs the most time: without West Stair (Stair B) the floor clears in 54 s, " +
        "against 47 s without East Stair (Stair A), so the scenario blocks West Stair (Stair B)",
    );
    expect(simulateDrill(F1, F1_FLOOR, { blockedStair: "es-landing" }).timeToClearS).toBe(47);
    expect(report.openStairs).toEqual(["es-landing"]);
    expect(report.occupants.every((o) => !o.path.includes("ws-landing"))).toBe(true);
  });

  it("takes longer to clear with the stair blocked than with none blocked", () => {
    expect(baseline.scenario.blockedStair).toBeNull();
    expect(report.timeToClearS).toBe(54);
    expect(baseline.timeToClearS).toBe(46);
  });

  it("gets every occupant to a stair", () => {
    expectAccounted(report);
    expect(report.allClear).toBe(true);
    expect(report.stranded).toEqual([]);
  });

  it("reports per-zone clear times, the bottleneck and a warden post per crowded zone at its exit door", () => {
    expect(report.zones.map((z) => [z.roomId, z.occupants])).toEqual([
      ["server-closet", 3],
      ["records-room", 3],
    ]);
    for (const z of report.zones) {
      const times = report.occupants.filter((o) => o.roomId === z.roomId).map((o) => o.clearedAtS!);
      expect(z.clearedAtS).toBe(Math.max(...times));
    }
    expect(report.timeToClearS).toBe(Math.max(...report.zones.map((z) => z.clearedAtS!)));
    expect(report.wardenPosts.map((p) => [p.roomId, p.doorId])).toEqual([
      ["server-closet", "d-server-closet"],
      ["records-room", "d-records-room"],
    ]);
    expect(report.bottleneck).not.toBeNull();
    const waits = report.occupants.reduce((s, o) => s + o.waitedS, 0);
    expect(report.bottleneck!.personSeconds).toBeGreaterThan(0);
    expect(report.bottleneck!.personSeconds).toBeLessThanOrEqual(waits);
  });

  it("drills a busy floor with a one-word switch", () => {
    const busy = simulateDrill(F1, F1_FLOOR, { floor: "busiest" });
    // Floors 21 and 23 have nothing available; 21 is the nearer one below the staged floor.
    expect(busy.headcount).toMatchObject({ floor: 21, availableSf: 0, occupiedSf: 24850, count: 99 });
    expect(busy.occupants).toHaveLength(99);
    expect(busy.placement).toBe("occupied suites");
    expectAccounted(busy);
    expect(busy.timeToClearS).toBeGreaterThan(simulateDrill(F1, F1_FLOOR, { floor: "busiest", blockedStair: null }).timeToClearS);
  });

  it("takes a floor number, and leaves that floor's available suites empty", () => {
    // Floor 8 lists suite 810 available: unit 10 is the board's Open Office 2210.
    const eight = simulateDrill(F1, F1_FLOOR, { floor: 8 });
    expect(eight.headcount).toMatchObject({ floor: 8, availableSf: 2618, occupiedSf: 22232, count: 89 });
    expect(eight.occupants.some((o) => o.roomId === "office-2210")).toBe(false);
    expect(eight.occupants).toHaveLength(89);
  });

  it("refuses a floor the building does not have", () => {
    expect(() => headcountFor(F1, 43)).toThrow(DrillError);
    expect(() => headcountFor(F1, 0)).toThrow(DrillError);
    expect(() => simulateDrill(F1, F1_FLOOR, { blockedStair: "mc-1" })).toThrow(DrillError);
    expect(() => simulateDrill(F1, F1_FLOOR, { seed: 1.5 })).toThrow(DrillError);
  });
});

describe("the drill is pure and deterministic", () => {
  it("gives the same report for the same inputs and seed", () => {
    for (const options of [{}, { seed: 7 }, { floor: "busiest" as const, seed: 3 }]) {
      expect(simulateDrill(F1, F1_FLOOR, options)).toEqual(simulateDrill(F1, F1_FLOOR, options));
    }
  });

  it("never changes its inputs", () => {
    const building = structuredClone(F1);
    const floor = structuredClone(F1_FLOOR);
    simulateDrill(building, floor, { floor: "busiest", seed: 11 });
    expect(building).toEqual(F1);
    expect(floor).toEqual(F1_FLOOR);
  });

  it("lets the seed move where people start, but not how many there are", () => {
    const starts = new Set<string>();
    for (let seed = 0; seed < 8; seed++) {
      const r = simulateDrill(F1, F1_FLOOR, { floor: "busiest", seed });
      expect(r.headcount.count).toBe(99);
      starts.add(r.occupants.map((o) => o.startNode).join());
    }
    expect(starts.size).toBeGreaterThan(1);
  });
});

describe("the walk", () => {
  it("walks at 1.2 m/s over node distances", () => {
    const floor = floorOf({
      rooms: [["s", "Suite 501"], ["st", "Stair A"]],
      nodes: [["a", 0, 0, "s"], ["b", 6, 8, "s"], ["x", 18, 8, "st", true]],
      edges: [["a", "b"], ["b", "x", "d-a"]],
    });
    // One person, on whichever node the seed picks: 10 m + 12 m, or 12 m.
    const r = simulateDrill(buildingWith(1), floor, { floor: 5 });
    const o = r.occupants[0];
    expect(WALK_SPEED_M_S).toBe(1.2);
    expect(o.distanceM).toBe(o.startNode === "a" ? 22 : 12);
    // 22 m ÷ 1.2 m/s = 18.3 s, so the 19th tick; 12 m ÷ 1.2 m/s = 10 s exactly.
    expect(o.clearedAtS).toBe(o.startNode === "a" ? 19 : 10);
    expect(o.track).toHaveLength(o.clearedAtS! + 1);
    expect(o.track.at(-1)).toEqual({ x: 18, y: 8 });
  });

  it("admits NODE_CAPACITY people into a node per tick, so a shared door queues", () => {
    expect(NODE_CAPACITY).toBe(1);
    const floor = floorOf({
      rooms: [["s", "Suite 501"], ["st", "Stair A"]],
      nodes: [["a", 0, 0, "s"], ["x", 1.2, 0, "st", true]],
      edges: [["a", "x", "d-a"]],
    });
    const r = simulateDrill(buildingWith(4), floor, { floor: 5 });
    expect(r.occupants.map((o) => o.clearedAtS)).toEqual([1, 2, 3, 4]);
    expect(r.occupants.map((o) => o.waitedS)).toEqual([0, 1, 2, 3]);
    expect(r.bottleneck).toMatchObject({ nodeId: "x", label: "Stair A", personSeconds: 6, peakQueue: 3, throughput: 4 });
    // Three of the four wait, for 1, 2 and 3 s: the total is person-seconds; the most one person waited is 3 s.
    expect(r.bottleneck).toMatchObject({ waiters: 3, mostWaitedS: 3 });
    expect(r.scenario.blockedStair).toBeNull();
    expect(r.scenario.rule).toBe("The floor has one stair, so none is blocked");
  });

  it("gives the most one person waited for a room as their waits added together, not one unbroken wait (R5-C1)", () => {
    // Suite 501's people walk the corridor (c1, then c2) to a far stair; Suite 502's join it at c2. Suite 501's
    // third person is held at c1 behind the others, walks on, and is held again at c2 as Suite 502's people go in.
    const floor = floorOf({
      rooms: [["s", "Suite 501"], ["t", "Suite 502"], ["c", "Corridor"], ["st", "Stair A"]],
      nodes: [["a", 0, 0, "s"], ["c1", 1.8, 0, "c"], ["c2", 6, 0, "c"], ["b", 6, 3, "t"], ["x", 30, 0, "st", true]],
      edges: [["a", "c1", "d-a"], ["c1", "c2"], ["b", "c2", "d-b"], ["c2", "x", "d-x"]],
    });
    const r = simulateDrill(buildingWith(6), floor, { floor: 5 });
    expect(r.bottleneck).toMatchObject({ roomId: "c", mostWaitedS: 2 });
    // Metres walked in each tick. Held for 0.5 s, then a whole second, at c1: one stretch of 1.5 s. Then three
    // full steps, and held 0.5 s at c2. The corridor's 2 s is those two waits added together, which is what the
    // panel and the recordings say it is; the longest single stretch was 1.5 s.
    const walked = (o: (typeof r.occupants)[number]) =>
      o.track.slice(1, 8).map((p, i) => Math.round(Math.hypot(p.x - o.track[i].x, p.y - o.track[i].y) * 100) / 100);
    const most = r.occupants.filter((o) => o.roomId === "s" && walked(o).join() === [1.2, 0.6, 0, 1.2, 1.2, 1.2, 0.6].join());
    expect(most).toHaveLength(1);
  });

  it("posts a warden at every door a room leaves by, with how many leave by each (R5-M2)", () => {
    // A suite with a door at each end and a stair beyond each, every stair open: both doors carry people.
    const floor = floorOf({
      rooms: [["w", "West Stair"], ["s", "Suite 501"], ["e", "East Stair"]],
      nodes: [["ws", 0, 0, "w", true], ["s1", 5, 0, "s"], ["s2", 15, 0, "s"], ["es", 20, 0, "e", true]],
      edges: [["ws", "s1", "d-w"], ["s1", "s2"], ["s2", "es", "d-e"]],
    });
    const r = simulateDrill(buildingWith(4), floor, { floor: 5, blockedStair: null });
    const west = r.occupants.filter((o) => o.stair === "ws").length;
    expect(west).toBeGreaterThan(0);
    expect(west).toBeLessThan(4);
    expect(r.wardenPosts.map((p) => [p.doorId, p.people, p.occupants]).sort()).toEqual([
      ["d-e", 4 - west, 4],
      ["d-w", west, 4],
    ]);
  });

  it("blocks the stair most occupants would use, and that costs time", () => {
    // A suite beside the west stair, with the east stair across the floor.
    const floor = floorOf({
      rooms: [["w", "West Stair"], ["s", "Suite 501"], ["c", "Corridor"], ["e", "East Stair"]],
      nodes: [["ws", 0, 0, "w", true], ["s1", 5, 0, "s"], ["c1", 30, 0, "c"], ["es", 60, 0, "e", true]],
      edges: [["ws", "s1", "d-w"], ["s1", "c1", "d-s"], ["c1", "es", "d-e"]],
    });
    const blocked = simulateDrill(buildingWith(5), floor, { floor: 5 });
    const open = simulateDrill(buildingWith(5), floor, { floor: 5, blockedStair: null });
    expect(open.occupants.every((o) => o.stair === "ws")).toBe(true);
    expect(blocked.scenario.blockedStair?.nodeId).toBe("ws");
    expect(blocked.occupants.every((o) => o.stair === "es")).toBe(true);
    expect(blocked.timeToClearS).toBeGreaterThan(open.timeToClearS);
    expect(blocked.wardenPosts).toEqual([
      { roomId: "s", label: "Suite 501", doorId: "d-s", nodeId: "s1", people: 5, occupants: 5 },
    ]);
    expect(blocked.scenario.rule).toBe("West Stair is the stair most occupants would use (5 of 5), so the scenario blocks it");
  });

  it("on a tie, says so and blocks the stair whose loss costs more time, not the lower id", () => {
    // One person in each suite, each beside their own stair: 1 of 2 use each.
    const floor = floorOf({
      rooms: [["w", "West Stair"], ["a", "Suite 501"], ["b", "Suite 502"], ["e", "East Stair"]],
      nodes: [["ws", 0, 0, "w", true], ["a1", 10, 0, "a"], ["b1", 30, 0, "b"], ["es", 45, 0, "e", true]],
      edges: [["ws", "a1", "d-w"], ["a1", "b1", "d-a"], ["b1", "es", "d-e"]],
    });
    const r = simulateDrill(buildingWith(2), floor, { floor: 5 });
    const open = simulateDrill(buildingWith(2), floor, { floor: 5, blockedStair: null });
    expect(open.occupants.map((o) => o.stair).sort()).toEqual(["es", "ws"]);
    // Without West Stair, Suite 501 walks 35 m (30 s); without East Stair, Suite 502 walks 30 m (25 s).
    expect(simulateDrill(buildingWith(2), floor, { floor: 5, blockedStair: "es" }).timeToClearS).toBe(25);
    expect(r.timeToClearS).toBe(30);
    expect(r.scenario.blockedStair?.nodeId).toBe("ws");
    expect(r.scenario.wouldUse).toBe(1);
    expect(r.scenario.rule).toBe(
      "East Stair and West Stair would each be used by 1 of 2 occupants, a tie. A tie goes to the stair whose loss " +
        "costs the most time: without West Stair the floor clears in 30 s, against 25 s without East Stair, " +
        "so the scenario blocks West Stair",
    );
  });

  it("blocks no stair when no occupant can reach one", () => {
    const floor = floorOf({
      rooms: [["a", "Suite 501"], ["w", "West Stair"], ["e", "East Stair"]],
      nodes: [["a1", 0, 0, "a"], ["ws", 20, 0, "w", true], ["es", 40, 0, "e", true]],
      edges: [["ws", "es"]],
    });
    const r = simulateDrill(buildingWith(2), floor, { floor: 5 });
    expect(r.scenario).toEqual({ blockedStair: null, wouldUse: 0, rule: "No occupant can reach a stair, so none is blocked" });
    expect(r.openStairs).toEqual(["es", "ws"]);
    expectAccounted(r);
  });

  it("names no bottleneck when nobody queued", () => {
    // Two people, each in their own suite beside their own stair: nobody waits.
    const floor = floorOf({
      rooms: [["w", "West Stair"], ["a", "Suite 501"], ["b", "Suite 502"], ["e", "East Stair"]],
      nodes: [["ws", 0, 0, "w", true], ["a1", 10, 0, "a"], ["b1", 30, 0, "b"], ["es", 40, 0, "e", true]],
      edges: [["ws", "a1", "d-w"], ["a1", "b1", "d-a"], ["b1", "es", "d-e"]],
    });
    const r = simulateDrill(buildingWith(2), floor, { floor: 5, blockedStair: null });
    expect(r.occupants.map((o) => o.stair).sort()).toEqual(["es", "ws"]);
    expect(r.occupants.every((o) => o.waitedS === 0)).toBe(true);
    expect(r.bottleneck).toBeNull();
  });
});

describe("who cannot reach a stair", () => {
  it("lists the occupants of a room with no way to an open stair", () => {
    const floor = floorOf({
      rooms: [["a", "Suite 501"], ["b", "Suite 502"], ["st", "Stair A"]],
      nodes: [["a1", 0, 0, "a"], ["b1", 20, 0, "b"], ["x", 5, 0, "st", true]],
      edges: [["a1", "x", "d-a"]],
    });
    const r = simulateDrill(buildingWith(4), floor, { floor: 5 });
    expectAccounted(r);
    expect(r.allClear).toBe(false);
    const cut = r.occupants.filter((o) => o.roomId === "b").map((o) => o.id);
    expect(cut).toHaveLength(2);
    expect(r.stranded).toEqual(
      cut.map((id) => ({ occupantId: id, roomId: "b", reason: "no open stair is reachable from their room" })),
    );
    expect(r.zones.find((z) => z.roomId === "b")?.clearedAtS).toBeNull();
    expect(r.timeToClearS).toBe(Math.max(...r.occupants.filter((o) => o.roomId === "a").map((o) => o.clearedAtS!)));
  });

  it("lists everyone when the only stair is blocked", () => {
    const floor = floorOf({
      rooms: [["a", "Suite 501"], ["st", "Stair A"]],
      nodes: [["a1", 0, 0, "a"], ["x", 5, 0, "st", true]],
      edges: [["a1", "x", "d-a"]],
    });
    const r = simulateDrill(buildingWith(3), floor, { floor: 5, blockedStair: "x" });
    expectAccounted(r);
    expect(r.stranded.map((s) => s.occupantId)).toEqual(["P01", "P02", "P03"]);
    expect(r.openStairs).toEqual([]);
    expect(r.timeToClearS).toBe(0);
  });

  it("lists the headcount it cannot place when the board has no occupied room", () => {
    const floor = floorOf({
      rooms: [["c", "Main Corridor"], ["st", "Stair A"]],
      nodes: [["c1", 0, 0, "c"], ["x", 5, 0, "st", true]],
      edges: [["c1", "x"]],
    });
    const r = simulateDrill(buildingWith(2), floor, { floor: 5 });
    expect(r.placement).toBe("none");
    expect(r.occupants).toEqual([]);
    expect(r.stranded).toEqual([
      { occupantId: "P01", roomId: null, reason: "the board has no occupied room to place them in" },
      { occupantId: "P02", roomId: null, reason: "the board has no occupied room to place them in" },
    ]);
    expectAccounted(r);
  });
});

describe("the report's stated rules (R3-M1, R4-M1, R4-M2, R4-M4)", () => {
  it('says "most occupants" only for a true majority, and "more than any other" for a plurality', () => {
    // Four people, one per node: two beside the west stair, one by the north stair, one by the east stair.
    const floor = floorOf({
      rooms: [["s", "Suite 501", 40], ["w", "West Stair"], ["n", "North Stair"], ["e", "East Stair"]],
      nodes: [
        ["a", 0, 0, "s"], ["b", 2, 0, "s"], ["c", 20, 0, "s"], ["d", 40, 0, "s"],
        ["ws", -5, 0, "w", true], ["ns", 20, 5, "n", true], ["es", 45, 0, "e", true],
      ],
      edges: [["ws", "a", "d-w"], ["a", "b"], ["b", "c"], ["c", "d"], ["c", "ns", "d-n"], ["d", "es", "d-e"]],
    });
    const open = simulateDrill(buildingWith(4), floor, { floor: 5, blockedStair: null });
    expect(open.occupants.map((o) => o.stair).sort()).toEqual(["es", "ns", "ws", "ws"]);
    const r = simulateDrill(buildingWith(4), floor, { floor: 5 });
    expect(r.scenario.blockedStair?.nodeId).toBe("ws");
    // 2 of 4 is half, not a majority.
    expect(r.scenario.rule).toBe(
      "West Stair is the stair more occupants would use than any other (2 of 4), so the scenario blocks it",
    );
    expect(r.scenario.rule).not.toMatch(/most occupants/);
  });

  it("breaks a tie on who is cut off first, before time", () => {
    // The person at a can only reach the west stair; the one at b is beside the east stair, or a long walk round to the west one.
    const floor = floorOf({
      rooms: [["s", "Suite 501", 50], ["c", "Corridor"], ["w", "West Stair"], ["e", "East Stair"]],
      nodes: [
        ["a", 0, 0, "s"], ["b", 50, 0, "s"], ["c1", 25, 30, "c"],
        ["ws", -2, 0, "w", true], ["es", 52, 0, "e", true],
      ],
      edges: [["a", "ws", "d-w"], ["b", "es", "d-e"], ["b", "c1", "d-s"], ["c1", "ws", "d-c"]],
    });
    const r = simulateDrill(buildingWith(2), floor, { floor: 5 });
    const withoutEast = simulateDrill(buildingWith(2), floor, { floor: 5, blockedStair: "es" });
    // Time alone would block the east stair: losing it costs far more.
    expect(withoutEast.timeToClearS).toBeGreaterThan(r.timeToClearS);
    expect(withoutEast.allClear).toBe(true);
    // But losing the west stair cuts someone off, and that ranks first.
    expect(r.scenario.blockedStair?.nodeId).toBe("ws");
    expect(r.allClear).toBe(false);
    expect(r.stranded).toHaveLength(1);
    expect(r.scenario.rule).toBe(
      "East Stair and West Stair would each be used by 1 of 2 occupants, a tie. A tie goes to the stair whose loss " +
        "cuts off the most occupants, then costs the most time: without West Stair 1 cannot reach a stair and the rest " +
        `are in a stair in ${r.timeToClearS} s, against ${withoutEast.timeToClearS} s without East Stair, so the scenario blocks West Stair`,
    );
  });

  it('never says "clears the floor" when anyone is cut off, and names the lower id on a full tie', () => {
    // Two dead-end suites, each with only its own stair, at the same distance.
    const floor = floorOf({
      rooms: [["a", "Suite 501"], ["b", "Suite 502"], ["w", "West Stair"], ["e", "East Stair"]],
      nodes: [["a1", 0, 0, "a"], ["b1", 30, 0, "b"], ["ws", -6, 0, "w", true], ["es", 36, 0, "e", true]],
      edges: [["a1", "ws", "d-w"], ["b1", "es", "d-e"]],
    });
    const r = simulateDrill(buildingWith(2), floor, { floor: 5 });
    expect(r.scenario.blockedStair?.nodeId).toBe("es");
    expect(r.allClear).toBe(false);
    expect(r.scenario.rule).toBe(
      "East Stair and West Stair would each be used by 1 of 2 occupants, a tie. A tie goes to the stair whose loss " +
        "cuts off the most occupants, then costs the most time, but losing any of them gives the same result " +
        "(1 cannot reach a stair and the rest are in a stair in 5 s), so the scenario blocks East Stair, the first by node id",
    );
    expect(r.scenario.rule).not.toMatch(/clears/);
  });

  it("says the floor clears, and names the lower id, when losing either stair costs the same and cuts nobody off", () => {
    // Two suites between two stairs, mirror images of each other.
    const floor = floorOf({
      rooms: [["a", "Suite 501"], ["b", "Suite 502"], ["w", "West Stair"], ["e", "East Stair"]],
      nodes: [["a1", 0, 0, "a"], ["b1", 12, 0, "b"], ["ws", -6, 0, "w", true], ["es", 18, 0, "e", true]],
      edges: [["a1", "ws", "d-w"], ["a1", "b1", "d-ab"], ["b1", "es", "d-e"]],
    });
    const r = simulateDrill(buildingWith(2), floor, { floor: 5 });
    expect(r.scenario.blockedStair?.nodeId).toBe("es");
    expect(r.allClear).toBe(true);
    expect(r.scenario.rule).toBe(
      "East Stair and West Stair would each be used by 1 of 2 occupants, a tie. A tie goes to the stair whose loss " +
        `costs the most time, but losing any of them gives the same result (the floor clears in ${r.timeToClearS} s), ` +
        "so the scenario blocks East Stair, the first by node id",
    );
  });

  it("lets the walker nearest the stair through a full node first, whatever the ids", () => {
    // Both reach the stair in the first tick; one is 0.6 m nearer.
    const floor = floorOf({
      rooms: [["s", "Suite 501"], ["st", "Stair A"]],
      nodes: [["p", 0, 0, "s"], ["q", 0.6, 0, "s"], ["x", 1.2, 0, "st", true]],
      edges: [["p", "q"], ["q", "x", "d-a"]],
    });
    let fartherHadLowerId = false;
    for (let seed = 0; seed < 8; seed++) {
      const r = simulateDrill(buildingWith(2), floor, { floor: 5, seed });
      const near = r.occupants.find((o) => o.startNode === "q")!;
      const far = r.occupants.find((o) => o.startNode === "p")!;
      expect(near.clearedAtS, `seed ${seed}`).toBe(1);
      expect(far.clearedAtS, `seed ${seed}`).toBe(2);
      expect(far.waitedS, `seed ${seed}`).toBe(1);
      if (far.id < near.id) fartherHadLowerId = true;
    }
    // Ordering by id alone would fail on these seeds.
    expect(fartherHadLowerId).toBe(true);
  });

  it("names the bottleneck by queued time, then by people through it, then by the lower id", () => {
    // Two at Suite 501's node queue for the east stair; two at Suite 502's queue for the west stair,
    // and a third, from Suite 503, passes through the west stair later without waiting.
    const rooms: [string, string, number][] = [
      ["a", "Suite 501", 10], ["b", "Suite 502", 10], ["c", "Suite 503", 5], ["w", "West Stair", 10], ["e", "East Stair", 10],
    ];
    const nodes: [string, number, number, string, boolean?][] = [
      ["a1", 0, 0, "a"], ["es", 1.2, 0, "e", true],
      ["b1", 50, 0, "b"], ["ws", 51.2, 0, "w", true], ["c1", 50, 20, "c"],
    ];
    const both = floorOf({ rooms, nodes, edges: [["a1", "es", "d-e"], ["b1", "ws", "d-w"], ["c1", "b1", "d-c"]] });
    const r = simulateDrill(buildingWith(5), both, { floor: 5, blockedStair: null });
    expect(r.occupants.filter((o) => o.roomId === "c")).toHaveLength(1);
    expect(r.occupants.find((o) => o.roomId === "c")!.waitedS).toBe(0);
    // Both stairs held one person back one second; the west one took three people.
    expect(r.bottleneck).toMatchObject({ nodeId: "ws", personSeconds: 1, throughput: 3 });

    const even = floorOf({
      rooms: rooms.filter(([id]) => id !== "c"),
      nodes: nodes.filter(([id]) => id !== "c1"),
      edges: [["a1", "es", "d-e"], ["b1", "ws", "d-w"]],
    });
    const tie = simulateDrill(buildingWith(4), even, { floor: 5, blockedStair: null });
    expect(tie.bottleneck).toMatchObject({ nodeId: "es", personSeconds: 1, throughput: 2 });
  });
});
