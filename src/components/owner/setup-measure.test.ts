// Coverage and open windows (issue 120): the night's length, small
// hand-made floors, F1's generated security and the prepared demo pair, each
// measured over the nights the batch plays (issue 132). The demo pair's
// numbers are pinned as they come out, not as the story wants.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefFix, LevelManifest, type FloorGraph } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { AUTOPLAY_MAX_TURNS, BATCH_SEEDS, compileBoard, createRun, moveGuards, varyLevel, type Level } from "@/engine";
import { sightingsAt } from "@/engine/vision";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import cachedF3 from "../../../data/levels/F3.night-desk.json";
import { demoSetups } from "./demo-setups";
import fixRecording from "../../../fixtures/llm/fix-F1.json";
import { toEngineFix } from "./chief-fix";
import { openWindows } from "./open-windows";
import { ownerBatchInput, ownerZones } from "./owner-batch";
import { boardOf, extendRound, setTempo, setupFromPlaced, setupWithFix, startRound, updateCamera } from "./owner-edit";
import {
  coverageLine,
  CYCLE_CAP,
  cycleLength,
  firstWindowLine,
  measureChange,
  measureNights,
  measureSetup,
  timingLine,
  watchedPositions,
  windowsLine,
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
    // The measure steps no further than an attempt lasts: nothing watched only later meets the crew.
    expect(watchedPositions(board.level).cycle).toBe(AUTOPLAY_MAX_TURNS);
  });
});

describe("coverage and open windows on a small floor", () => {
  it("with no cameras and no guards, nothing is watched and every moment is open", () => {
    const m = measure(diamondLevel(), ways);
    expect(m).toMatchObject({ positions: 5, watched: 0, coverage: 0, entries: 2, windows: { open: 2, moments: 2 } });
    expect(coverageLine(m)).toBe("Coverage: 0% of the floor is watched at some point in every night the crew plays.");
    expect(windowsLine(m)).toBe("Open windows: 2 of 2 moments in the one night the crew plays let a crew in and out unseen by guards and cameras. A moment is a way in at any turn of a night; the attempts all start at turn 0.");
  });

  it("counts a locked door as passable: the crew picks it", () => {
    const m = measure(diamondLevel({ lockedDoors: ["d-ab"], cameras: [{ id: "C1", kind: "fixed-ip", cover: ["c"] }] }), ways);
    // a still reaches d through the locked door to b; e has only the watched c.
    expect(m).toMatchObject({ watched: 1, coverage: 20, windows: { open: 1, moments: 2 } });
    expect(m.windows.first?.actions.filter((a) => a.kind === "pick")).toHaveLength(2);
    expect(windowsLine(m)).toBe("Open windows: 1 of 2 moments in the one night the crew plays lets a crew in and out unseen by guards and cameras. A moment is a way in at any turn of a night; the attempts all start at turn 0.");
  });

  it("with every route watched, no moment is open", () => {
    const m = measure(
      diamondLevel({
        cameras: [{ id: "C1", kind: "fixed-ip", cover: ["c"] }],
        guards: [{ id: "G1", patrol: ["b"] }],
      }),
      ways,
    );
    expect(m).toMatchObject({ watched: 2, coverage: 40, windows: { open: 0 } });
    expect(windowsLine(m)).toBe("Open windows: 0 of 2 moments in the one night the crew plays let a crew in and out unseen by guards and cameras. A moment is a way in at any turn of a night; the attempts all start at turn 0.");
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
    expect(m).toMatchObject({ watched: 5, coverage: 83, cycle: 4 });
  });

  it("a guard standing its post has no facing, so it watches every sightline from its post, on every night", () => {
    const post = level(lineFloor(5), { guards: [{ id: "G1", patrol: ["n2"] }], start: "n0", objective: "n4" });
    // A post never hops, so the engine never turns it: it looks every way, behind it included.
    const [guard] = createRun(post).guards;
    expect(guard.facing).toBeNull();
    expect([...watchedPositions(post).nodes].sort()).toEqual(["n0", "n1", "n2", "n3", "n4"]);
    // The batch's variation moves only rounds and sweeps, so every night has the post the same.
    const nights = BATCH_SEEDS.map((seed) => ({ level: varyLevel(post, seed), entries: [{ nodeId: "n0" }] }));
    expect(measureNights(nights)).toMatchObject({ positions: 5, watched: 5, coverage: 100, windows: { open: 0 }, cycle: 1 });
  });

  it("over several nights: coverage counts what every night watches, open windows are counted on each night and added up", () => {
    // The camera is over b one night, over c the next, and over both on a third.
    const night = (cover: string[]) => ({ level: diamondLevel({ cameras: [{ id: "C1", kind: "fixed-ip" as const, cover }] }), entries: ways });
    const [overB, overC, shut] = [night(["b"]), night(["c"]), night(["b", "c"])];
    expect(measureNights([overB])).toMatchObject({ watched: 1, windows: { open: 2, moments: 2 }, openNights: 1 });
    expect(measureNights([overC])).toMatchObject({ watched: 1, windows: { open: 1, moments: 2 }, openNights: 1 });
    expect(measureNights([shut])).toMatchObject({ watched: 2, windows: { open: 0, moments: 2 }, openNights: 0 });
    // Neither b nor c is watched every night; each night's windows count.
    expect(measureNights([overB, overC])).toMatchObject({ watched: 0, coverage: 0, windows: { open: 3, moments: 4 }, openNights: 2, nights: 2 });
    // A night that shuts every route does not close the one another night leaves open.
    const m = measureNights([shut, overC, shut]);
    expect(m).toMatchObject({ watched: 1, windows: { open: 1, moments: 6 }, openNights: 1, nights: 3, firstNight: 2 });
    expect(windowsLine(m)).toBe("Open windows: 1 of 6 moments in the 3 nights the crew plays lets a crew in and out unseen by guards and cameras. A moment is a way in at any turn of a night; the attempts all start at turn 0.");
    expect(firstWindowLine(m)).toMatch(/^The first opens on night 2, turn 0, when the attempts start: /);
    expect(timingLine(m, 5)).toBeNull();
  });

  it("with no way in, says so instead of 0 of 0", () => {
    expect(windowsLine(measure(diamondLevel(), []))).toBe("Open windows: this floor has no way in to measure.");
    expect(timingLine(measure(diamondLevel(), []), 3)).toBeNull();
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

/** The levels the batch plays: its own input for the setup, varied as `runBatch` varies it (the owner's input leaves `vary` on). */
function playedNights(manifest: LevelManifest, floor: FloorGraph, setup: OwnerSetup): Level[] {
  const input = ownerBatchInput(manifest, floor, setup, [], BATCH_SEEDS);
  expect(input.vary).toBeUndefined();
  return BATCH_SEEDS.map((seed) => varyLevel(input.levelFor(seed), seed));
}

/**
 * Coverage, and which ways in have a route nothing watches all night, read
 * without `watchedPositions` or the measure's search:
 * on each night the batch plays, the engine's own sighting check
 * (`sightingsAt`: cameras and guards, no cleaners) on every node, in the order
 * `act` plays a turn (the crew's half against this turn's cameras and the
 * guards where they stand, then the guards' look once they move), for as long
 * as an attempt lasts. Routes by a plain search of the floor's edges.
 */
function oracle(manifest: LevelManifest, floor: FloorGraph, setup: OwnerSetup) {
  const levels = playedNights(manifest, floor, setup);
  const seenBy = levels.map((level) => {
    const { board, guards: start } = createRun(level);
    const seen = new Set<string>();
    let guards = start;
    const look = (turn: number | null) => {
      for (const n of level.floor.nodes) if (sightingsAt(board, { guards, cleaners: [] }, n.id, turn).length > 0) seen.add(n.id);
    };
    for (let turn = 0; turn < AUTOPLAY_MAX_TURNS; turn++) {
      look(turn);
      guards = moveGuards(board, guards);
      look(null);
    }
    return seen;
  });
  const next = new Map<string, string[]>();
  for (const e of floor.edges) {
    next.set(e.a, [...(next.get(e.a) ?? []), e.b]);
    next.set(e.b, [...(next.get(e.b) ?? []), e.a]);
  }
  const unseenPath = (seen: Set<string>, from: string, to: string) => {
    const reached = new Set(seen.has(from) ? [] : [from]);
    for (const at of reached) for (const n of next.get(at) ?? []) if (!seen.has(n)) reached.add(n);
    return reached.has(to);
  };
  const open = levels.map((level, i) => {
    const ways = boardOf(manifest, floor, setup, BATCH_SEEDS[i])!.entries.map((e) => e.nodeId);
    return new Set(ways.filter((w) => unseenPath(seenBy[i], w, level.objective)));
  });
  const opened = new Set(open.flatMap((o) => [...o]));
  return {
    measure: { watched: floor.nodes.filter((n) => seenBy.every((s) => s.has(n.id))).length },
    perNight: open.map((o) => o.size),
    opened,
    open,
    levels,
  };
}

describe("on F1", () => {
  const manifest = LevelManifest.parse(structuredClone(cached));
  const floor = FIXTURE_FLOORS.F1;
  const generated = placeLevel(manifest, floor, 1);
  const starting = setupFromPlaced(generated);
  const recordedFix = ChiefFix.parse(fixRecording.fix);
  const [night, moved] = demoSetups("F1").map((d) => d.setup);

  const played = (setup: typeof starting) => playedNights(manifest, floor, setup);

  it("matches an independent reading of what each night the batch plays watches; no night leaves a route watched by nothing", () => {
    for (const setup of [starting, night, moved]) {
      const { measure: read, perNight } = oracle(manifest, floor, setup);
      expect(measureSetup(manifest, floor, setup)).toMatchObject(read);
      expect(perNight).toEqual(Array(10).fill(0));
    }
  });

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
    expect(m).toMatchObject({ positions: 30, watched: 14, coverage: 47, entries: 2, windows: { open: 40, moments: 80 }, openNights: 10, nights: 10 });
    expect(coverageLine(m)).toBe("Coverage: 47% of the floor is watched at some point in every night the crew plays.");
    expect(windowsLine(m)).toBe("Open windows: 40 of 80 moments in the 10 nights the crew plays let a crew in and out unseen by guards and cameras. A moment is a way in at any turn of a night; the attempts all start at turn 0.");
    // With windows open, attempts that got out need not have been seen: no timing line.
    expect(timingLine(m, 17)).toBeNull();
    // With none open, the ones that got out were seen or heard on the way.
    const shut = { ...m, windows: { ...m.windows, open: 0, first: null } };
    expect(timingLine(shut, 17)).toBe(
      "No moment in the 10 nights the crew plays lets a crew in and out unseen by guards and cameras, so the 17 attempts that got out were seen or heard and not caught.",
    );
    expect(timingLine(shut, 1)).toContain("so the one attempt that got out was seen or heard and not caught.");
    expect(timingLine(shut, 0)).toBeNull();
  });

  it("measures the prepared pair: moving C2 adds two watched positions and halves the open windows", () => {
    const [a, b] = [night, moved].map((s) => measureSetup(manifest, floor, s)!);
    expect(a).toMatchObject({ watched: 13, coverage: 43, entries: 2, windows: { open: 40, moments: 80 } });
    expect(b).toMatchObject({ watched: 15, coverage: 50, entries: 2, windows: { open: 20, moments: 80 } });
    expect(measureChange(a, b)).toBe("Coverage 43% → 50%, open windows 40 of 80 → 20 of 80");
  });

  it("shows each side's total in the change, so a longer night does not read as more open (issue 144 review)", () => {
    // Slowing G1 to tempo 5 makes the night five times longer and leaves half the moments open, as before.
    const a = measureSetup(manifest, floor, night)!;
    const slow = measureSetup(manifest, floor, setTempo(night, "G1", 5))!;
    expect(slow.windows).toMatchObject({ open: 200, moments: 400, share: 50 });
    expect(measureChange(a, slow)).toBe("Coverage 43% → 43%, open windows 40 of 80 → 200 of 400");
  });

  it("measures the Chief's recorded fix on the generated setup", () => {
    const fixed = setupWithFix(starting, toEngineFix(recordedFix, ownerZones(manifest, floor)), generated.level, "After the fix");
    const after = measureSetup(manifest, floor, fixed)!;
    expect(measureChange(measureSetup(manifest, floor, starting)!, after)).toBe("Coverage 47% → 50%, open windows 40 of 80 → 0 of 80");
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

describe("on F3, where some nights leave a way in open (issue 132)", () => {
  const manifest = LevelManifest.parse(structuredClone(cachedF3));
  const floor = FIXTURE_FLOORS.F3;
  const starting = setupFromPlaced(placeLevel(manifest, floor, 1));

  it("counts the windows on every night, and every route nothing watches is open at every turn", () => {
    // On seeds 4, 7, 8 and 9 the dock way in has a route to the prototype that nothing watches that night.
    const { measure: read, perNight } = oracle(manifest, floor, starting);
    expect(perNight).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 1, 0]);
    const m = measureSetup(manifest, floor, starting)!;
    expect(m).toMatchObject(read);
    expect(m).toMatchObject({ positions: 24, watched: 11, coverage: 46, entries: 2, windows: { open: 20, moments: 40 }, openNights: 10, nights: 10 });
    expect(windowsLine(m)).toBe("Open windows: 20 of 40 moments in the 10 nights the crew plays let a crew in and out unseen by guards and cameras. A moment is a way in at any turn of a night; the attempts all start at turn 0.");
    // A route nothing watches all night is open at every turn of that night, whenever the crew steps in.
    const { open, levels } = oracle(manifest, floor, starting);
    levels.forEach((level, i) => {
      for (const way of open[i]) {
        const w = openWindows(level, [way]);
        expect(w.open).toBe(w.moments);
      }
    });
    // So attempts that got out need not have been seen: no timing line.
    expect(timingLine(m, 40)).toBeNull();
  });

  it("finds that route on seed 4: from the service lift to the lab bench, watched by nothing all night", () => {
    const night4 = playedNights(manifest, floor, starting)[3];
    const seen = watchedPositions(night4).nodes;
    const path = ["sl-car", "sl-door", "s1-nw", "s1-mid", "s1-ne", "nh-e", "lab-door", "lab-bench"];
    expect(path.filter((id) => seen.has(id))).toEqual([]);
    expect(night4.objective).toBe("lab-bench");
  });
});
