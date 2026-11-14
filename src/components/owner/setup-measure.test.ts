// Coverage and unwatched routes (issue 120): the night's length, small
// hand-made floors, F1's generated security and the prepared demo pair, each
// measured over the nights the batch plays (issue 132). The demo pair's
// numbers are pinned as they come out, not as the story wants.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefFix, LevelManifest, type FloorGraph } from "@/domain";
import { BATCH_SEEDS, compileBoard, createRun, varyLevel, type Level } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { demoSetups } from "./demo-setups";
import fixRecording from "../../../fixtures/llm/fix-F1.json";
import { toEngineFix } from "./chief-fix";
import { ownerBatchInput, ownerZones } from "./owner-batch";
import { extendRound, setupFromPlaced, setupWithFix, startRound, updateCamera } from "./owner-edit";
import {
  coverageLine,
  CYCLE_CAP,
  cycleLength,
  measureChange,
  measureNights,
  measureSetup,
  routesLine,
  timingLine,
  watchedPositions,
  type MeasureNight,
} from "./setup-measure";

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
/** One night of a hand-made level, as it is. */
const measure = (l: Level, entries: MeasureNight["entries"]) => measureNights([{ level: l, entries }]);

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
    const m = measure(diamondLevel(), ways);
    expect(m).toMatchObject({ positions: 5, watched: 0, coverage: 0, entries: 2, unwatched: 2 });
    expect(coverageLine(m)).toBe("Coverage: 0% of the floor is watched at some point in every night the crew plays.");
    expect(routesLine(m)).toBe("Unwatched routes: 2 of 2 ways in have a route to the files that no camera or guard ever sees.");
  });

  it("counts a locked door as passable: the crew picks it", () => {
    const m = measure(diamondLevel({ lockedDoors: ["d-ab"], cameras: [{ id: "C1", kind: "fixed-ip", cover: ["c"] }] }), ways);
    // a still reaches d through the locked door to b; e has only the watched c.
    expect(m).toMatchObject({ watched: 1, coverage: 20, unwatched: 1 });
    expect(routesLine(m)).toBe("Unwatched routes: 1 of 2 ways in has a route to the files that no camera or guard ever sees.");
  });

  it("with every route watched, no way in reaches the objective unseen", () => {
    const m = measure(
      diamondLevel({
        cameras: [{ id: "C1", kind: "fixed-ip", cover: ["c"] }],
        guards: [{ id: "G1", patrol: ["b"] }],
      }),
      ways,
    );
    expect(m).toMatchObject({ watched: 2, coverage: 40, unwatched: 0 });
    expect(routesLine(m)).toBe("Unwatched routes: 0 of 2 ways in have a route to the files that no camera or guard ever sees.");
  });

  it("counts a sweeping camera's whole cover, and every node a guard's round passes", () => {
    const m = measure(
      level(lineFloor(6), {
        floor: { ...lineFloor(6), sightlines: {} },
        cameras: [{ id: "C1", kind: "analog-sweep", cover: ["n4", "n5"] }],
        guards: [{ id: "G1", patrol: ["n0", "n2"] }],
      }),
      [{ nodeId: "n0" }],
    );
    expect(m).toMatchObject({ watched: 5, coverage: 83, unwatched: 0, cycle: 4 });
  });

  it("a guard standing its post has no facing, so it watches every sightline from its post, on every night", () => {
    const post = level(lineFloor(5), { guards: [{ id: "G1", patrol: ["n2"] }], start: "n0", objective: "n4" });
    // A post never hops, so the engine never turns it: it looks every way, behind it included.
    const [guard] = createRun(post).guards;
    expect(guard.facing).toBeNull();
    expect([...watchedPositions(post).nodes].sort()).toEqual(["n0", "n1", "n2", "n3", "n4"]);
    // The batch's variation moves only rounds and sweeps, so every night has the post the same.
    const nights = BATCH_SEEDS.map((seed) => ({ level: varyLevel(post, seed), entries: [{ nodeId: "n0" }] }));
    expect(measureNights(nights)).toMatchObject({ positions: 5, watched: 5, coverage: 100, unwatched: 0, cycle: 1 });
  });

  it("over several nights: coverage counts what every night watches, a route is unwatched only if no night watches it", () => {
    // The camera is over b one night and over c the next: neither is watched every night, and neither route is never watched.
    const overB = { level: diamondLevel({ cameras: [{ id: "C1", kind: "fixed-ip", cover: ["b"] }] }), entries: ways };
    const overC = { level: diamondLevel({ cameras: [{ id: "C1", kind: "fixed-ip", cover: ["c"] }] }), entries: ways };
    expect(measureNights([overB])).toMatchObject({ watched: 1, unwatched: 2 });
    expect(measureNights([overC])).toMatchObject({ watched: 1, unwatched: 1 });
    expect(measureNights([overB, overC])).toMatchObject({ watched: 0, coverage: 0, unwatched: 0 });
  });

  it("keeps a whole percent honest at the ends: never 100 with a position unwatched, nor 0 with one watched", () => {
    const floor = lineFloor(201);
    const bare = { ...floor, sightlines: {} };
    const ids = floor.nodes.map((n) => n.id);
    const nearly = measure(level(bare, { cameras: [{ id: "C1", kind: "fixed-ip", cover: ids.slice(1) }] }), [{ nodeId: "n0" }]);
    expect(nearly).toMatchObject({ positions: 201, watched: 200, coverage: 99 });
    const barely = measure(level(bare, { cameras: [{ id: "C1", kind: "fixed-ip", cover: ["n100"] }] }), [{ nodeId: "n0" }]);
    expect(barely).toMatchObject({ watched: 1, coverage: 1 });
  });

  it("gives the same answer every time", () => {
    const l = diamondLevel({ cameras: [{ id: "C1", kind: "ptz", cover: ["b", "c", "e"] }] });
    expect(measure(l, ways)).toEqual(measure(l, ways));
  });
});

describe("on F1", () => {
  const manifest = LevelManifest.parse(structuredClone(cached));
  const floor = FIXTURE_FLOORS.F1;
  const generated = placeLevel(manifest, floor, 1);
  const starting = setupFromPlaced(generated);
  const recordedFix = ChiefFix.parse(fixRecording.fix);
  const [night, moved] = demoSetups("F1").map((d) => d.setup);

  /** The levels the batch plays for a setup, built by the batch's own input and `runBatch`'s variation. */
  const played = (setup: typeof starting) => {
    const input = ownerBatchInput(manifest, floor, setup, [], BATCH_SEEDS);
    return BATCH_SEEDS.map((seed) => (input.vary === false ? input.levelFor(seed) : varyLevel(input.levelFor(seed), seed)));
  };

  it("measures the nights the batch plays: every position it counts is watched on each of them", () => {
    for (const setup of [starting, night, moved]) {
      const watches = played(setup).map((l) => watchedPositions(l).nodes);
      const every = [...watches[0]].filter((id) => watches.every((w) => w.has(id)));
      const m = measureSetup(manifest, floor, setup)!;
      expect(m.watched).toBe(every.length);
      // So no night the crew plays watches fewer positions than the screen says.
      expect(m.watched).toBeLessThanOrEqual(Math.min(...watches.map((w) => w.size)));
    }
    // The generated security's ten nights: a generated guard walks a different round, or from a different start, on each.
    expect(played(starting).map((l) => watchedPositions(l).nodes.size)).toEqual([15, 14, 15, 14, 14, 14, 16, 14, 15, 15]);
  });

  it("measures the generated security over the batch's nights", () => {
    const m = measureSetup(manifest, floor, starting)!;
    expect(m).toMatchObject({ positions: 30, watched: 14, coverage: 47, entries: 2, unwatched: 0 });
    expect(coverageLine(m)).toBe("Coverage: 47% of the floor is watched at some point in every night the crew plays.");
    expect(routesLine(m)).toBe("Unwatched routes: 0 of 2 ways in have a route to the files that no camera or guard ever sees.");
    // 17 of 50 got out with no route unwatched: by timing, or seen and not caught.
    expect(timingLine(m, 17)).toBe(
      "Every route to the files crosses ground a camera or guard watches at some point, so the 17 attempts that got out did it by timing, or were seen and not caught.",
    );
    expect(timingLine(m, 1)).toContain("so the one attempt that got out did it by timing, or was seen and not caught.");
    expect(timingLine(m, 0)).toBeNull();
    expect(timingLine({ ...m, unwatched: 1 }, 17)).toBeNull();
  });

  it("measures the prepared pair: moving C2 adds two watched positions and closes no route", () => {
    const [a, b] = [night, moved].map((s) => measureSetup(manifest, floor, s)!);
    expect(a).toMatchObject({ watched: 13, coverage: 43, entries: 2, unwatched: 0 });
    expect(b).toMatchObject({ watched: 15, coverage: 50, entries: 2, unwatched: 0 });
    expect(measureChange(a, b)).toBe("Coverage 43% → 50%, unwatched routes 0 → 0");
  });

  it("measures the Chief's recorded fix on the generated setup", () => {
    const fixed = setupWithFix(starting, toEngineFix(recordedFix, ownerZones(manifest, floor)), generated.level, "After the fix");
    const after = measureSetup(manifest, floor, fixed)!;
    expect(measureChange(measureSetup(manifest, floor, starting)!, after)).toBe("Coverage 47% → 50%, unwatched routes 0 → 0");
  });

  it("changes when a camera moves, with no batch played", () => {
    const before = measureSetup(manifest, floor, night)!;
    const after = measureSetup(manifest, floor, updateCamera(night, "C2", { node: "dc-west" }))!;
    expect(after.coverage).not.toBe(before.coverage);
  });

  it("measures nothing for a setup with a problem: the batch would not play it", () => {
    const broken = extendRound(startRound(starting, "G1"), "G1", "mc-4");
    expect(measureSetup(manifest, floor, broken)).toBeNull();
  });
});
