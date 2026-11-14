// Coverage and unwatched routes (issue 120): the night's length, small
// hand-made floors, F1's generated security and the prepared demo pair. The
// demo pair's numbers are pinned as they come out, not as the story wants.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefFix, LevelManifest, type FloorGraph } from "@/domain";
import { compileBoard, type Level } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { demoSetups } from "./demo-setups";
import fixRecording from "../../../fixtures/llm/fix-F1.json";
import { toEngineFix } from "./chief-fix";
import { ownerZones } from "./owner-batch";
import { boardOf, setupFromPlaced, setupWithFix, updateCamera } from "./owner-edit";
import { coverageLine, CYCLE_CAP, cycleLength, measureChange, measureSetup, routesLine } from "./setup-measure";

/** Nodes n0…n(k-1) in a line along x, one room, every node in sight of every other. */
function lineFloor(k: number): FloorGraph {
  const ids = Array.from({ length: k }, (_, i) => `n${i}`);
  return {
    nodes: ids.map((id, i) => ({ id, x: i, y: 0, roomId: "hall", tags: [] })),
    edges: ids.slice(1).map((id, i) => ({ a: ids[i], b: id })),
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: k, h: 1 } }],
    sightlines: Object.fromEntries(ids.map((id) => [id, ids.filter((o) => o !== id)])),
    source: "fixture",
  };
}

/**
 * Two ways in, `a` and `e`, and the objective `d`: a reaches d through b or
 * through c, e only through c. The door between a and b is locked. No
 * sightlines, so a guard sees only its own node.
 */
const diamond: FloorGraph = {
  nodes: [
    { id: "a", x: 0, y: 1, roomId: "r", tags: [] },
    { id: "b", x: 1, y: 0, roomId: "r", tags: [] },
    { id: "c", x: 1, y: 2, roomId: "r", tags: [] },
    { id: "d", x: 2, y: 1, roomId: "r", tags: [] },
    { id: "e", x: 1, y: 3, roomId: "r", tags: [] },
  ],
  edges: [
    { a: "a", b: "b", door: { id: "d-ab", lockable: true } },
    { a: "b", b: "d" },
    { a: "a", b: "c" },
    { a: "c", b: "d" },
    { a: "e", b: "c" },
  ],
  rooms: [{ id: "r", label: "Room", rect: { x: 0, y: 0, w: 3, h: 4 } }],
  sightlines: {},
  source: "fixture",
};

function level(floor: FloorGraph, overrides: Partial<Level> = {}): Level {
  return {
    buildingId: "T",
    missionId: "t",
    seed: 1,
    floor,
    start: floor.nodes[0].id,
    objective: floor.nodes[floor.nodes.length - 1].id,
    exits: [floor.nodes[0].id],
    lockedDoors: [],
    pickTurns: 2,
    patrolTempo: 1,
    guards: [],
    ...overrides,
  };
}

const diamondLevel = (overrides: Partial<Level> = {}) => level(diamond, { start: "a", objective: "d", exits: ["a"], ...overrides });
const ways = [{ nodeId: "a" }, { nodeId: "e" }];

describe("the night's length", () => {
  it("is the least common multiple of each guard's round times its tempo and each camera's sweep", () => {
    // G1's round n0 → n1 → n2 → n1 is 4 hops; a PTZ camera cycles in 3.
    const ptz = [{ id: "C1", kind: "ptz" as const, cover: ["n0", "n1", "n2"] }];
    expect(cycleLength(compileBoard(level(lineFloor(4), { guards: [{ id: "G1", patrol: ["n0", "n2"] }], cameras: ptz })))).toBe(12);
    expect(
      cycleLength(compileBoard(level(lineFloor(4), { guards: [{ id: "G1", patrol: ["n0", "n2"] }], cameras: ptz, patrolTempo: 2 }))),
    ).toBe(24);
    // Nothing moves: one turn is the whole night.
    expect(cycleLength(compileBoard(level(lineFloor(4))))).toBe(1);
  });

  it("stops at the cap", () => {
    const board = compileBoard(
      level(lineFloor(4), {
        guards: [
          { id: "G1", patrol: ["n0", "n2"] },
          { id: "G2", patrol: ["n0", "n1"] },
        ],
        guardTempo: { G1: 7, G2: 11 },
        cameras: [{ id: "C1", kind: "ptz", cover: ["n0", "n1", "n2"] }],
      }),
    );
    expect(cycleLength(board)).toBe(CYCLE_CAP);
  });
});

describe("coverage and unwatched routes on a small floor", () => {
  it("with no cameras and no guards, nothing is watched and every way in reaches the objective", () => {
    const m = measureSetup({ level: diamondLevel(), entries: ways });
    expect(m).toMatchObject({ positions: 5, watched: 0, coverage: 0, entries: 2, unwatched: 2 });
    expect(coverageLine(m)).toBe("Coverage: 0% of the floor is watched at some point in a night.");
    expect(routesLine(m)).toBe("Unwatched routes: 2 of 2 ways in reach the files unseen.");
  });

  it("counts a locked door as passable: the crew picks it", () => {
    const m = measureSetup({
      level: diamondLevel({ lockedDoors: ["d-ab"], cameras: [{ id: "C1", kind: "fixed-ip", cover: ["c"] }] }),
      entries: ways,
    });
    // a still reaches d through the locked door to b; e has only the watched c.
    expect(m).toMatchObject({ watched: 1, coverage: 20, unwatched: 1 });
  });

  it("with every route watched, no way in reaches the objective unseen", () => {
    const m = measureSetup({
      level: diamondLevel({
        cameras: [{ id: "C1", kind: "fixed-ip", cover: ["c"] }],
        guards: [{ id: "G1", patrol: ["b"] }],
      }),
      entries: ways,
    });
    expect(m).toMatchObject({ watched: 2, coverage: 40, unwatched: 0 });
    expect(routesLine(m)).toBe("Unwatched routes: 0 of 2 ways in reach the files unseen.");
  });

  it("counts a sweeping camera's whole cover, and every node a guard's round passes", () => {
    const m = measureSetup({
      level: level(lineFloor(6), {
        floor: { ...lineFloor(6), sightlines: {} },
        cameras: [{ id: "C1", kind: "analog-sweep", cover: ["n4", "n5"] }],
        guards: [{ id: "G1", patrol: ["n0", "n2"] }],
      }),
      entries: [{ nodeId: "n0" }],
    });
    expect(m).toMatchObject({ watched: 5, coverage: 83, unwatched: 0, cycle: 4 });
  });

  it("gives the same answer every time", () => {
    const l = diamondLevel({ cameras: [{ id: "C1", kind: "ptz", cover: ["b", "c", "e"] }] });
    expect(measureSetup({ level: l, entries: ways })).toEqual(measureSetup({ level: l, entries: ways }));
  });
});

describe("on F1", () => {
  const manifest = LevelManifest.parse(structuredClone(cached));
  const floor = FIXTURE_FLOORS.F1;
  const generated = placeLevel(manifest, floor, 1);
  const recordedFix = ChiefFix.parse(fixRecording.fix);

  it("measures the generated security, and its setup measures the same", () => {
    const m = measureSetup(generated);
    expect(m).toMatchObject({ positions: 30, watched: 16, coverage: 53, entries: 2, unwatched: 0 });
    expect(measureSetup(boardOf(manifest, floor, setupFromPlaced(generated), 1)!)).toEqual(m);
  });

  it("measures the prepared pair: moving C2 adds two watched positions and closes no route", () => {
    const [night, moved] = demoSetups("F1").map((d) => measureSetup(boardOf(manifest, floor, d.setup, 1)!));
    expect(night).toMatchObject({ watched: 15, coverage: 50, entries: 2, unwatched: 0 });
    expect(moved).toMatchObject({ watched: 17, coverage: 57, entries: 2, unwatched: 0 });
    expect(measureChange(night, moved)).toBe("Coverage 50% → 57%, unwatched routes 0 → 0");
  });

  it("measures the Chief's recorded fix on the generated setup", () => {
    const fixed = setupWithFix(setupFromPlaced(generated), toEngineFix(recordedFix, ownerZones(manifest, floor)), generated.level, "After the fix");
    const after = measureSetup(boardOf(manifest, floor, fixed, 1)!);
    expect(measureChange(measureSetup(generated), after)).toBe("Coverage 53% → 57%, unwatched routes 0 → 0");
  });

  it("changes when a camera moves, with no batch played", () => {
    const [{ setup }] = demoSetups("F1");
    const before = measureSetup(boardOf(manifest, floor, setup, 1)!);
    const after = measureSetup(boardOf(manifest, floor, updateCamera(setup, "C2", { node: "dc-west" }), 1)!);
    expect(after.coverage).not.toBe(before.coverage);
  });
});
