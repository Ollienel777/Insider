// Issue 176: on a scan floor the placer keeps cameras and guard rounds off the
// way through (the shortest way from the start to the objective, and the cut
// nodes every way must cross), and the fixture floors place exactly as before.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { type FloorGraph, LevelManifest } from "@/domain";
import { act, type Action, compileBoard, createRun, type RunState, shortestPath, watched } from "@/engine";
import f1 from "../../data/levels/F1.romaine-1974.json";
import f2 from "../../data/levels/F2.sunset-1986.json";
import f3 from "../../data/levels/F3.night-desk.json";
import { type PlacedLevel, placeLevel } from "./placer";

/**
 * A scan-like floor: a straight corridor c0–c8 that is the only way from the
 * stair (the start) to the records room, side pockets off it (pa, pb, pc),
 * and two offices hanging off it. Sightlines are each node's neighbours.
 * With `loop`, a pocket q1–q10 also leaves the corridor at c4 and comes back
 * onto it at c5: its ends are 9 moves apart inside it, 3 by the corridor.
 */
function scanFloor({ loop = false } = {}): FloorGraph {
  const nodes: FloorGraph["nodes"] = [];
  const edges: FloorGraph["edges"] = [];
  const node = (id: string, x: number, y: number, roomId: string, tags: FloorGraph["nodes"][number]["tags"] = []) =>
    nodes.push({ id, x, y, roomId, tags });
  node("s0", -3, 0, "stair", ["stair"]);
  for (let i = 0; i <= 8; i++) node(`c${i}`, i * 3, 0, "hall");
  edges.push({ a: "s0", b: "c0" });
  for (let i = 0; i < 8; i++) edges.push({ a: `c${i}`, b: `c${i + 1}` });
  // Side pockets of the corridor: dead ends off it.
  for (const [p, at, x] of [["pa", "c2", 6], ["pb", "c4", 12], ["pc", "c5", 15]] as const) {
    node(`${p}1`, x, 3, "hall");
    node(`${p}2`, x, 6, "hall");
    node(`${p}3`, x, 9, "hall");
    edges.push({ a: at, b: `${p}1` }, { a: `${p}1`, b: `${p}2` }, { a: `${p}2`, b: `${p}3` });
  }
  // Offices off the corridor, on the other side.
  for (const [o, at, x] of [["o1", "c3", 9], ["o2", "c6", 18]] as const) {
    node(`${o}a`, x, -3, o);
    node(`${o}b`, x, -6, o);
    node(`${o}c`, x, -9, o);
    edges.push({ a: at, b: `${o}a` }, { a: `${o}a`, b: `${o}b` }, { a: `${o}b`, b: `${o}c` });
  }
  if (loop) {
    for (let i = 1; i <= 10; i++) node(`q${i}`, i <= 5 ? 12 : 15, -3 * (i <= 5 ? i : 11 - i), "hall");
    edges.push({ a: "c4", b: "q1" }, { a: "q10", b: "c5" });
    for (let i = 1; i < 10; i++) edges.push({ a: `q${i}`, b: `q${i + 1}` });
  }
  node("r0", 27, 0, "records");
  edges.push({ a: "c8", b: "r0", door: { id: "d-records", lockable: false } });
  const sightlines: Record<string, string[]> = Object.fromEntries(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    sightlines[e.a].push(e.b);
    sightlines[e.b].push(e.a);
  }
  const rect = { x: 0, y: 0, w: 1, h: 1 };
  return {
    nodes,
    edges,
    rooms: [
      { id: "stair", label: "Stair", rect },
      { id: "hall", label: "Corridor", rect },
      { id: "o1", label: "Office 1", rect },
      { id: "o2", label: "Office 2", rect },
      { id: "records", label: "Records room", rect },
    ],
    sightlines,
    source: "matterport",
  };
}

/** F1's manifest cut down to a scan's: one way in, two cameras, three guards, no suites. */
function scanManifest(): LevelManifest {
  const m = LevelManifest.parse(structuredClone(f1));
  return LevelManifest.parse({
    ...m,
    buildingId: "SCAN",
    securityProfile: { ...m.securityProfile, guardCount: 3, cameraCount: 2 },
    zones: m.zones.filter((z) => z.role === "objective"),
    entries: m.entries.filter((e) => e.kind === "roof"),
  });
}

const CORRIDOR = Array.from({ length: 9 }, (_, i) => `c${i}`);

/** Every node each guard steps on over its round, walked leg by leg as the engine walks it. */
function roundSteps(placed: PlacedLevel): [string, string[]][] {
  const board = compileBoard(placed.level);
  return placed.level.guards.map((g) => [
    g.id,
    g.patrol.flatMap((id, i) => shortestPath(board, id, [g.patrol[(i + 1) % g.patrol.length]]) ?? []),
  ]);
}

/** A straight walk down the corridor, the pick, and the take: the run after it. */
function walkThrough(placed: PlacedLevel): RunState {
  let run: RunState = createRun(placed.level);
  const actions: Action[] = [
    ...CORRIDOR.map((to): Action => ({ kind: "move", to })),
    { kind: "pick", doorId: "d-records" },
    { kind: "pick", doorId: "d-records" },
    { kind: "move", to: "r0" },
    { kind: "take" },
  ];
  for (const a of actions) {
    const r = act(run, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)} refused: ${r.reason}`);
    run = r.run;
  }
  return run;
}

describe("placeLevel on a scan floor with a single way through (issue 176)", () => {
  const placed = placeLevel(scanManifest(), scanFloor(), 7);

  it("keeps the counts: two cameras and three guards on rounds", () => {
    expect(placed.level.start).toBe("s0");
    expect(placed.level.objective).toBe("r0");
    expect(placed.cameras).toHaveLength(2);
    expect(placed.guards).toHaveLength(3);
    expect(placed.guards.every((g) => !g.post)).toBe(true);
    expect(placed.unplaced.filter((u) => /^(camera|guard):/.test(u.elementRole))).toEqual([]);
  });

  it("puts no camera's watched nodes on the corridor", () => {
    const board = compileBoard(placed.level);
    for (const camera of board.cameras) {
      for (let t = 0; t < 6; t++) for (const id of watched(camera, t)) expect(CORRIDOR, `${camera.id} t${t}`).not.toContain(id);
    }
  });

  it("walks no guard's round over the corridor", () => {
    for (const [id, steps] of roundSteps(placed)) for (const step of steps) expect(CORRIDOR, id).not.toContain(step);
  });

  it("leaves a careful walk through unseen", () => {
    const run = walkThrough(placed);
    expect(run.carrying).toBe(true);
    expect(run.alarmEvents.filter((e) => e.to !== "calm")).toEqual([]);
  });

  it("places as before on the same floor marked a fixture: the rule is for scans only", () => {
    const fixture = { ...scanFloor(), source: "fixture" as const };
    const p = placeLevel(scanManifest(), fixture, 7);
    expect(p.cameras.flatMap((c) => c.cover).some((id) => CORRIDOR.includes(id))).toBe(true);
  });
});

describe("placeLevel on a scan floor with a pocket that meets the corridor twice (issue 176)", () => {
  // The far side of the loop, q2–q9, is out of sight of the corridor and the
  // longest round off it. But the engine walks a round's legs the short way
  // over the whole floor, and from q2 to q9 that is across c4 and c5.
  for (const seed of [0, 1, 2, 3, 7]) {
    it(`walks no guard's round over the corridor, and keeps the counts (seed ${seed})`, () => {
      const placed = placeLevel(scanManifest(), scanFloor({ loop: true }), seed);
      expect(placed.cameras).toHaveLength(2);
      expect(placed.guards).toHaveLength(3);
      expect(placed.guards.every((g) => !g.post)).toBe(true);
      for (const [id, steps] of roundSteps(placed)) for (const step of steps) expect(CORRIDOR, id).not.toContain(step);
      for (const camera of placed.cameras) for (const id of camera.cover) expect(CORRIDOR, camera.id).not.toContain(id);
    });
  }

  it("leaves a careful walk through unseen", () => {
    const run = walkThrough(placeLevel(scanManifest(), scanFloor({ loop: true }), 7));
    expect(run.carrying).toBe(true);
    expect(run.alarmEvents.filter((e) => e.to !== "calm")).toEqual([]);
  });
});

describe("the fixture floors place exactly as before issue 176", () => {
  // sha256 over JSON.stringify of every placement: seeds 0–23, each with no
  // posture and with every entry watched. Taken from the placer before the change.
  const BEFORE: Record<string, string> = {
    F1: "2032d7f72ac99eb778bfe8563eba21f97e4c395c0bfa8375c3bdc8259687d5e7",
    F2: "dd074de670d733904dc54849a611df023a1da68df76f0643948f6cbed67d2dd0",
    F3: "f7294b41c4373b7741bd3333989f858e0c79feda62d58a816a300de281c77abc",
  };
  const manifests = { F1: f1, F2: f2, F3: f3 } as const;
  for (const [id, raw] of Object.entries(manifests)) {
    it(`${id} is byte-identical`, () => {
      const m = LevelManifest.parse(structuredClone(raw));
      const h = createHash("sha256");
      for (let seed = 0; seed < 24; seed++) {
        for (const watchEntry of [undefined, ...m.entries.map((e) => e.id)]) {
          h.update(JSON.stringify(placeLevel(m, structuredClone(FIXTURE_FLOORS[id]), seed, undefined, { watchEntry })));
        }
      }
      expect(h.digest("hex")).toBe(BEFORE[id]);
    });
  }
});
