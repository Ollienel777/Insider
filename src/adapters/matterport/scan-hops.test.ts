// A scan's board drops long hops (issue 110): a position keeps its nearest
// hops, and the board keeps the spanning tree that holds it together. The
// sweep and room records are made up, in the shape mapping.ts reads (as in
// live.test.ts and scan-board.test.ts): no scan data is kept.
import { describe, expect, it } from "vitest";
import { LevelManifest, type FloorGraph } from "@/domain";
import { createRun } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { hopCutMetres, nearestHops, SCAN_HOP_METRES, SCAN_HOPS_KEPT, SCAN_SPACING_FACTOR, toFloorGraph, toFullFloorGraph } from "./mapping";

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
const room = (id: string, label: string, x0: number, z0: number, x1: number, z1: number) => ({
  id,
  label,
  bounds: { min: v(x0, z0), max: v(x1, z1) },
});

type Spot = [x: number, z: number, room: string | null];
type Link = [string, string];
type Sweeps = Record<string, ReturnType<typeof sweep>>;
type Scan = { sweeps: Sweeps; rooms: Record<string, unknown> };

/** Sweep records for `spots`, each listing the spots it is linked to. */
function sweepsOf(spots: Record<string, Spot>, links: Link[]): Sweeps {
  const listed = (sid: string) => links.flatMap(([a, b]) => (a === sid ? [b] : b === sid ? [a] : []));
  return Object.fromEntries(Object.entries(spots).map(([sid, [x, z, roomId]]) => [sid, sweep(sid, x, z, roomId, listed(sid))]));
}

/** Every pair of `ids`: what a scan lists where each position sees all the others. */
const everyPair = (ids: string[]): Link[] => ids.flatMap((a, i) => ids.slice(i + 1).map((b): Link => [a, b]));

/** The same scan, with its records and each neighbour list in the opposite order. */
function backwards({ sweeps, rooms }: Scan): Scan {
  const reversed = Object.entries(sweeps)
    .reverse()
    .map(([sid, s]) => [sid, { ...s, neighbors: [...s.neighbors].reverse() }]);
  return { sweeps: Object.fromEntries(reversed), rooms };
}

// ---- the made-up scans --------------------------------------------------------

/** An open office: ten positions in two rows of five, 3 m apart, each listing the other nine. */
function openRoom(extra: Record<string, Spot> = {}): Scan {
  const spots: Record<string, Spot> = { ...extra };
  for (let i = 0; i < 5; i++) {
    spots[`a${i}`] = [3 * i, 0, "r-open"];
    spots[`b${i}`] = [3 * i, 3, "r-open"];
  }
  return {
    sweeps: sweepsOf(spots, everyPair(Object.keys(spots))),
    rooms: { "r-open": room("r-open", "Open Office", -1, -1, 21, 4) },
  };
}

/** Two wings of five positions, each wing listing all of its own, joined by a single 9 m hop from w1 to e0. */
function twoWings(): Scan {
  const wing = (p: string, x: number, roomId: string): Record<string, Spot> => ({
    [`${p}0`]: [x, 0, roomId],
    [`${p}1`]: [x + 2, 0, roomId],
    [`${p}2`]: [x, 2, roomId],
    [`${p}3`]: [x + 2, 2, roomId],
    [`${p}4`]: [x + 1, 1, roomId],
  });
  const ids = (p: string) => [0, 1, 2, 3, 4].map((i) => `${p}${i}`);
  return {
    sweeps: sweepsOf({ ...wing("w", 0, "r-west"), ...wing("e", 11, "r-east") }, [...everyPair(ids("w")), ...everyPair(ids("e")), ["w1", "e0"]]),
    rooms: { "r-west": room("r-west", "West Wing", -1, -1, 3, 3), "r-east": room("r-east", "East Wing", 10, -1, 14, 3) },
  };
}

/**
 * A small office floor, built so that dropping hops any earlier would change
 * more than the hops:
 *
 * - A hall of six positions, 3 m apart, each listing the other five.
 * - A stairwell. s1 is by the door and lists the two hall positions next to
 *   it. s2, at the far end, lists three hall positions it sees through the
 *   door, 8 m and more away, and the one position outside every room. Those
 *   make s2 the stairwell's landing (the most hops out of the room).
 * - An unlabelled core with a flight to the floor above, scanned from c1 and
 *   c3. They list each other, 7 m apart, which makes them one landing.
 */
function officeFloor(): Scan {
  const hall = ["h0", "h1", "h2", "h3", "h4", "h5"];
  const spots: Record<string, Spot> = {
    h0: [0, 0, "r-hall"],
    h1: [3, 0, "r-hall"],
    h2: [6, 0, "r-hall"],
    h3: [0, 3, "r-hall"],
    h4: [3, 3, "r-hall"],
    h5: [6, 3, "r-hall"],
    s1: [8.5, 1.5, "r-stair"],
    s2: [11, 1.5, "r-stair"],
    c1: [0, 6, "r-core"],
    c2: [0, 9.5, "r-core"],
    c3: [0, 13, "r-core"],
    out: [14, 1.5, null],
  };
  const sweeps = sweepsOf(spots, [
    ...everyPair(hall),
    ["h2", "s1"],
    ["h5", "s1"],
    ["s1", "s2"],
    ["h0", "s2"],
    ["h1", "s2"],
    ["h4", "s2"],
    ["s2", "out"],
    ["h3", "c1"],
    ["c1", "c2"],
    ["c2", "c3"],
    ["c1", "c3"],
  ]);
  // The flight: both ends of it list a position on the floor above.
  sweeps.up = sweep("up", 0, 9.5, "r-above", ["c1", "c3"], { floorInfo: { id: "floor-b", sequence: 1 } });
  sweeps.c1.neighbors.push("up");
  sweeps.c3.neighbors.push("up");
  return {
    sweeps,
    rooms: {
      "r-hall": room("r-hall", "Hall", -1, -1, 7, 4),
      "r-stair": room("r-stair", "Stairwell", 8, 0, 12, 3),
      "r-core": room("r-core", "", -1, 5, 1, 14),
    },
  };
}

/** Four positions on a square of 7 m sides, each listing the other three: every side ties. */
function square(): Scan {
  const spots: Record<string, Spot> = { a: [0, 0, "r-yard"], b: [7, 0, "r-yard"], c: [7, 7, "r-yard"], d: [0, 7, "r-yard"] };
  return { sweeps: sweepsOf(spots, everyPair(Object.keys(spots))), rooms: { "r-yard": room("r-yard", "Yard", -1, -1, 8, 8) } };
}

/**
 * The same square, each corner with a companion 1 m outside it, every position
 * listing every other: each corner's own spacing is 1 m, so the cut stays at
 * 6 m and the square's 7 m sides are kept only as the tree needs them.
 */
function squareWithCompanions(): Scan {
  const spots: Record<string, Spot> = { a: [0, 0, "r-yard"], b: [7, 0, "r-yard"], c: [7, 7, "r-yard"], d: [0, 7, "r-yard"] };
  Object.assign(spots, { a1: [-0.6, -0.8, "r-yard"], b1: [7.6, -0.8, "r-yard"], c1: [7.6, 7.8, "r-yard"], d1: [-0.6, 7.8, "r-yard"] });
  return { sweeps: sweepsOf(spots, everyPair(Object.keys(spots))), rooms: { "r-yard": room("r-yard", "Yard", -1, -1, 9, 9) } };
}

/**
 * Six positions that each list the other five. t1 and t2 are both exactly 5 m
 * from h, its fourth and fifth shortest hops, and h is the fifth at each of
 * them, behind four nearer positions.
 */
function tiedForFourth(): Scan {
  const spots: Record<string, Spot> = {
    h: [0, 0, "r-lab"],
    m1: [2, 2, "r-lab"],
    m2: [3, 1, "r-lab"],
    m3: [1, 3, "r-lab"],
    t1: [3, 4, "r-lab"],
    t2: [4, 3, "r-lab"],
  };
  return { sweeps: sweepsOf(spots, everyPair(Object.keys(spots))), rooms: { "r-lab": room("r-lab", "Lab", -1, -1, 5, 5) } };
}

// ---- reading a board ------------------------------------------------------------

type Hop = { a: string; b: string };
const boards = ({ sweeps, rooms }: Scan) => ({ full: toFullFloorGraph(sweeps, rooms), floor: toFloorGraph(sweeps, rooms) });
const name = ({ a, b }: Hop) => (a < b ? `${a} ${b}` : `${b} ${a}`);
const hops = (floor: FloorGraph) => floor.edges.map(name).sort();
const hopsAt = (floor: FloorGraph, id: string) => floor.edges.filter((e) => e.a === id || e.b === id);

function metres(floor: FloorGraph, { a, b }: Hop): number {
  const at = (id: string) => floor.nodes.find((n) => n.id === id)!;
  return Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
}

/** Whether `p` comes before `q`, shortest first, a tie in length going to the lower ids. */
function comesBefore(floor: FloorGraph, p: Hop, q: Hop): boolean {
  const [m, n] = [metres(floor, p), metres(floor, q)];
  return m < n || (m === n && name(p) < name(q));
}

/** The ids reached from `from` along `edges`. */
function reached(from: string, edges: Hop[]): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of edges) {
      const next = e.a === id ? e.b : e.b === id ? e.a : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** The `SCAN_HOPS_KEPT` shortest of the hops the scan lists at `id`. */
function shortestAt(full: FloorGraph, id: string): string[] {
  return hopsAt(full, id)
    .sort((p, q) => (comesBefore(full, p, q) ? -1 : 1))
    .slice(0, SCAN_HOPS_KEPT)
    .map(name);
}

/**
 * Whether `hop` is on the spanning tree of the scan's full graph. It is,
 * unless the hops that come before it already join its two ends. This is not
 * how mapping.ts finds the tree, so it checks it.
 */
function onTree(full: FloorGraph, hop: Hop): boolean {
  return !reached(hop.a, full.edges.filter((e) => comesBefore(full, e, hop))).has(hop.b);
}

/** Issue 110's rule, hop by hop: the hops of the full graph that the board must keep, and no others. */
function ruled(full: FloorGraph): string[] {
  const nearest = (e: Hop) => shortestAt(full, e.a).includes(name(e)) || shortestAt(full, e.b).includes(name(e));
  return full.edges
    .filter((e) => onTree(full, e) || (metres(full, e) <= hopCutMetres(nearestHops(full), e.a, e.b) && nearest(e)))
    .map(name)
    .sort();
}

// ---- the tests ------------------------------------------------------------------

describe("the two numbers of the rule (issue 110)", () => {
  it("are 6 m and 4 hops", () => {
    expect(SCAN_HOP_METRES).toBe(6);
    expect(SCAN_HOPS_KEPT).toBe(4);
  });
});

describe("an open room where each of 10 positions lists the other 9", () => {
  const { full, floor } = boards(openRoom());

  it("keeps 25 of the scan's 45 hops", () => {
    expect(full.nodes).toHaveLength(10);
    expect(full.edges).toHaveLength(45);
    expect(floor.edges).toHaveLength(25);
    // Kept: the 13 hops of 3 m, the 8 diagonals, and the four 6 m hops that are a corner's fourth shortest.
    const length = (e: Hop) => Math.round(metres(floor, e) * 10) / 10;
    expect(floor.edges.filter((e) => length(e) === 3)).toHaveLength(13);
    expect(floor.edges.filter((e) => length(e) === 4.2)).toHaveLength(8);
    expect(floor.edges.filter((e) => length(e) === 6).map(name).sort()).toEqual(["a0 a2", "a2 a4", "b0 b2", "b2 b4"]);
    // a1–a3 and b1–b3 are 6 m too, but each is fifth or later at both of its ends.
    expect(hops(full)).toEqual(expect.arrayContaining(["a1 a3", "b1 b3"]));
    expect(hops(floor)).not.toContain("a1 a3");
    expect(hops(floor)).not.toContain("b1 b3");
  });

  it("every position keeps its 4 shortest hops", () => {
    for (const { id } of full.nodes) {
      const nearest = shortestAt(full, id);
      expect(nearest, id).toHaveLength(4);
      expect(hopsAt(floor, id).map(name), id).toEqual(expect.arrayContaining(nearest));
    }
    // A corner's fourth is exactly 6 m: "no longer than" includes 6.
    expect(shortestAt(full, "a0")).toEqual(["a0 a1", "a0 b0", "a0 b1", "a0 a2"]);
    expect(metres(full, { a: "a0", b: "a2" })).toBe(6);
  });

  it("keeps no hop longer than 6 m unless it is on the spanning tree", () => {
    for (const e of floor.edges) {
      if (metres(floor, e) > SCAN_HOP_METRES) expect(onTree(full, e), name(e)).toBe(true);
    }
    // Here the tree needs none: every position has another 3 m away.
    expect(Math.max(...floor.edges.map((e) => metres(floor, e)))).toBe(6);
  });

  it("gives a position more than 6 m from every other one hop, its shortest, which the tree needs", () => {
    const withFar = boards(openRoom({ z: [20, 0, "r-open"] }));
    expect(hopsAt(withFar.full, "z")).toHaveLength(10);
    expect(hopsAt(withFar.floor, "z").map(name)).toEqual(["a4 z"]);
    expect(metres(withFar.floor, { a: "a4", b: "z" })).toBe(8);
    expect(onTree(withFar.full, { a: "a4", b: "z" })).toBe(true);
    // The rest of the room is as it was without it.
    expect(hops(withFar.floor).filter((h) => !h.endsWith(" z"))).toEqual(hops(floor));
  });
});

describe("a sparse scan keeps its loops (PR 116 review)", () => {
  /** A 5 × 4 grid, 6.5 m apart, each position listing every other within 15 m: sparser than the 6 m cut. */
  function sparseGrid(): Scan {
    const spots: Record<string, Spot> = {};
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) spots[`g${r}${c}`] = [6.5 * c, 6.5 * r, "r-hall"];
    const ids = Object.keys(spots);
    const near = everyPair(ids).filter(([a, b]) => Math.hypot(spots[a][0] - spots[b][0], spots[a][1] - spots[b][1]) <= 15);
    return { sweeps: sweepsOf(spots, near), rooms: { "r-hall": room("r-hall", "Open Floor", -1, -1, 28, 21) } };
  }

  it("raises the cut to the spacing where the hop is", () => {
    const grid = nearestHops(boards(sparseGrid()).full);
    expect(hopCutMetres(grid, "g00", "g01")).toBeCloseTo(SCAN_SPACING_FACTOR * 6.5);
    expect(hopCutMetres(nearestHops(boards(openRoom()).full), "a0", "a1")).toBe(SCAN_HOP_METRES);
  });

  it("keeps only a square grid's sides, not its diagonals", () => {
    const { floor } = boards(sparseGrid());
    expect(hops(floor)).not.toContain("g00 g11");
    expect(hops(floor)).not.toContain("g01 g10");
  });

  it("keeps the loops of a sparse part of an otherwise dense floor", () => {
    // The sparse grid beside a dense room: most positions are 3 m apart, but the grid's own spacing sets its hops' cut.
    const grid = sparseGrid();
    const dense = openRoom();
    const shifted = Object.fromEntries(
      Object.entries(dense.sweeps).map(([sid, sw]) => [sid, { ...sw, position: { ...sw.position, x: sw.position.x + 60 } }]),
    );
    const bridge = { ...grid.sweeps.g04, neighbors: [...grid.sweeps.g04.neighbors, "a0"] };
    const a0 = { ...shifted.a0, neighbors: [...shifted.a0.neighbors, "g04"] };
    const both: Scan = { sweeps: { ...grid.sweeps, ...shifted, g04: bridge, a0 }, rooms: { ...grid.rooms, ...dense.rooms } };
    const { floor } = boards(both);
    for (let c = 0; c < 4; c++) expect(hops(floor), `g0${c} g0${c + 1}`).toContain(`g0${c} g0${c + 1}`);
    expect(hops(floor)).toContain("g00 g10");
  });

  it("keeps every grid side, so the board has loops round any one position", () => {
    const { floor } = boards(sparseGrid());
    // 31 grid sides on a 5 × 4 grid; a tree on 20 positions would have 19 edges.
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 5; c++) {
        if (c < 4) expect(hops(floor), `g${r}${c} g${r}${c + 1}`).toContain(`g${r}${c} g${r}${c + 1}`);
        if (r < 3) expect(hops(floor), `g${r}${c} g${r + 1}${c}`).toContain(`g${r}${c} g${r + 1}${c}`);
      }
    expect(floor.edges.length).toBeGreaterThan(floor.nodes.length);
  });

  it("keeps a lone square's four 7 m sides: a loop, not a tree", () => {
    const kept = hops(boards(square()).floor);
    for (const side of ["a b", "a d", "b c", "c d"]) expect(kept, side).toContain(side);
  });
});

describe("the board is exactly as connected as before", () => {
  const { full, floor } = boards(twoWings());
  const bridge = { a: "e0", b: "w1" };

  it("keeps the single 9 m hop that joins two clusters of positions", () => {
    expect(metres(full, bridge)).toBe(9);
    // Nothing but the tree keeps it: it is too long, and fifth at both of its ends.
    expect(shortestAt(full, "w1")).not.toContain(name(bridge));
    expect(shortestAt(full, "e0")).not.toContain(name(bridge));
    expect(hops(floor)).toContain(name(bridge));
    expect(floor.edges).toContainEqual({ ...bridge, door: { id: "door:e0:w1", lockable: false } });
  });

  it("reaches every position the full graph reaches", () => {
    expect(reached("w0", full.edges).size).toBe(10);
    expect(reached("w0", floor.edges)).toEqual(reached("w0", full.edges));
    expect(floor.nodes.map((n) => n.id)).toEqual(full.nodes.map((n) => n.id));
  });

  it("holds on every scan here, the ones where hops are dropped included", () => {
    for (const scan of [openRoom(), openRoom({ z: [20, 0, "r-open"] }), officeFloor(), square(), tiedForFourth()]) {
      const each = boards(scan);
      const start = each.full.nodes[0].id;
      expect(reached(start, each.floor.edges).size).toBe(each.full.nodes.length);
    }
  });
});

describe("only the hops change: nodes, tags, rooms and sightlines are the full graph's", () => {
  const { full, floor } = boards(officeFloor());
  const stairs = (graph: FloorGraph) => graph.nodes.filter((n) => n.tags.includes("stair")).map((n) => n.id);
  const doors = (graph: FloorGraph) => graph.edges.flatMap((e) => (e.door ? [e.door.id] : [])).sort();

  it("drops the long hops of this floor", () => {
    expect(full.edges).toHaveLength(26);
    expect(hops(full).filter((h) => !hops(floor).includes(h))).toEqual(["c1 c3", "h0 h5", "h0 s2", "h1 s2", "h2 h3", "h3 h5", "h4 s2"]);
  });

  it("leaves the nodes, their tags, the rooms and the sightlines identical", () => {
    expect(floor.nodes).toEqual(full.nodes);
    expect(floor.rooms).toEqual(full.rooms);
    expect(floor.sightlines).toEqual(full.sightlines);
    expect({ ...floor, edges: [] }).toEqual({ ...full, edges: [] });
  });

  it("tags the stairs from the hops the scan lists, not from the ones kept", () => {
    // s2 is the stairwell's landing for the hall positions it lists: without those hops it would be s1.
    // c1 and c3 are one flight because they list each other: without that hop they would be two stairs.
    expect(stairs(full)).toEqual(["s2", "c1"]);
    expect(stairs(floor)).toEqual(["s2", "c1"]);
    expect(hops(floor)).not.toContain("c1 c3");
  });

  it("still sees along a hop that was dropped: sightlines do not come from edges", () => {
    expect(floor.sightlines.c1).toContain("c3");
    expect(floor.sightlines.h0).toContain("h5");
  });

  it("keeps a room-crossing hop's door, with the id it has today", () => {
    expect(doors(full)).toEqual(["door:c1:h3", "door:h0:s2", "door:h1:s2", "door:h2:s1", "door:h4:s2", "door:h5:s1", "door:out:s2"]);
    expect(doors(floor)).toEqual(["door:c1:h3", "door:h2:s1", "door:h5:s1", "door:out:s2"]);
    expect(floor.edges).toContainEqual({ a: "h2", b: "s1", door: { id: "door:h2:s1", lockable: false } });
    // Every kept edge is the full graph's own, in the same order: a door where it crosses rooms, none inside one.
    expect(floor.edges).toEqual(full.edges.filter((e) => hops(floor).includes(name(e))));
    const roomOf = new Map(floor.nodes.map((n) => [n.id, n.roomId]));
    for (const e of floor.edges) expect(Boolean(e.door), name(e)).toBe(roomOf.get(e.a) !== roomOf.get(e.b));
  });
});

describe("the same scan always gives the same board: a tie in length breaks by id", () => {
  it("picks the tree's hops by id when every side of a square is the same length", () => {
    const scan = squareWithCompanions();
    const sides = (floor: FloorGraph) => hops(floor).filter((h) => /^[a-d] [a-d]$/.test(h));
    // The cut is 6 m here, so the four 7 m sides are too long to keep for being near; the tree needs three, in id order.
    expect(hopCutMetres(nearestHops(boards(scan).full), "a", "b")).toBe(SCAN_HOP_METRES);
    expect(sides(boards(scan).floor)).toEqual(["a b", "a d", "b c"]);
    expect(sides(boards(backwards(scan)).floor)).toEqual(["a b", "a d", "b c"]);
  });

  it("picks a position's fourth hop by id when its fourth and fifth are the same length", () => {
    const scan = tiedForFourth();
    const { full, floor } = boards(scan);
    expect(metres(full, { a: "h", b: "t1" })).toBe(5);
    expect(metres(full, { a: "h", b: "t2" })).toBe(5);
    expect(shortestAt(full, "t1")).not.toContain("h t1");
    expect(shortestAt(full, "t2")).not.toContain("h t2");
    // So one of the two is kept, as h's fourth, and it is the one with the lower id.
    expect(hops(full).filter((h) => !hops(floor).includes(h))).toEqual(["h t2"]);
    expect(hops(boards(backwards(scan)).floor)).toEqual(hops(floor));
  });

  it("does not depend on the order the scan lists its positions or their neighbours in", () => {
    for (const scan of [openRoom(), twoWings(), officeFloor()]) {
      expect(hops(boards(backwards(scan)).floor)).toEqual(hops(boards(scan).floor));
    }
  });
});

describe("the rule, hop by hop, on every scan here", () => {
  const scans: [string, Scan][] = [
    ["the open room", openRoom()],
    ["the open room with a far position", openRoom({ z: [20, 0, "r-open"] })],
    ["the two wings", twoWings()],
    ["the office floor", officeFloor()],
    ["the square", square()],
    ["the tie for fourth", tiedForFourth()],
  ];

  it.each(scans)("%s keeps a hop when it is on the tree, or at most 6 m and one of an end's 4 shortest, and no other", (_, scan) => {
    const { full, floor } = boards(scan);
    expect(hops(floor)).toEqual(ruled(full));
  });
});

describe("a level placed and played on a pruned dense scan (PR 116 review)", () => {
  /**
   * An office floor scanned densely: a corridor of 8 positions, a freight lift
   * and a stair at its ends, and six rooms of 5 positions off it. Each position
   * lists every other one within 12 m, as a scan's "can see" lists do, across
   * rooms included: hundreds of hops, most of them between rooms.
   */
  function denseOffice(): Scan {
    const spots: Record<string, Spot> = { lift: [-3, 0, "r-lift"], stair: [24, 0, "r-stair"] };
    for (let i = 0; i < 8; i++) spots[`c${i}`] = [3 * i, 0, "r-corridor"];
    const rooms: Record<string, unknown> = {
      "r-lift": room("r-lift", "Freight Elevator", -4, -1, -2, 1),
      "r-stair": room("r-stair", "Stairwell", 23, -1, 25, 1),
      "r-corridor": room("r-corridor", "", -1, -1, 22, 1),
    };
    for (let k = 0; k < 6; k++) {
      const north = k < 3;
      const x0 = (k % 3) * 7;
      const z0 = north ? 2.5 : -8.5;
      for (let j = 0; j < 5; j++) spots[`r${k}p${j}`] = [x0 + 1 + (j % 3) * 2, z0 + 1 + Math.floor(j / 3) * 3, `r-room${k}`];
      rooms[`r-room${k}`] = room(`r-room${k}`, "", x0, z0, x0 + 6, z0 + 6);
    }
    const ids = Object.keys(spots);
    const links = everyPair(ids).filter(([a, b]) => Math.hypot(spots[a][0] - spots[b][0], spots[a][1] - spots[b][1]) <= 12);
    return { sweeps: sweepsOf(spots, links), rooms };
  }

  const scan = denseOffice();
  const { full, floor } = boards(scan);
  const manifest = LevelManifest.parse(structuredClone(cached));
  const placed = placeLevel(manifest, structuredClone(floor), 7);
  const { level } = placed;

  it("drops most of the scan's hops, and leaves the board as connected as it was", () => {
    expect(full.edges.length).toBeGreaterThan(300);
    expect(floor.edges.length).toBeLessThan(full.edges.length / 2);
    expect(reached("lift", floor.edges)).toEqual(reached("lift", full.edges));
  });

  it("places the level on it, with guards, a way in and a lock on the objective's room", () => {
    expect(placed.entries.length).toBeGreaterThan(0);
    expect(level.guards.length).toBeGreaterThan(0);
    expect(level.lockedDoors.length).toBeGreaterThan(0);
    const run = createRun(level);
    expect(run.status).toBe("playing");
  });

  it("keeps the files behind the lock, and reachable once it is picked", () => {
    const shut = new Set(level.lockedDoors);
    const open = level.floor.edges.filter((e) => !e.door || !shut.has(e.door.id));
    expect(reached(level.start, open).has(level.objective)).toBe(false);
    expect(reached(level.start, level.floor.edges).has(level.objective)).toBe(true);
  });
});
