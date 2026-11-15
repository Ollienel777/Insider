// Open windows (issue 120): small floors whose windows can be worked out by
// hand, the cap, and F1's generated security, the Chief's recorded fix and the
// prepared pair, pinned as they come out. Every first window found on F1 is
// played back through the engine's own `act`, which must get the crew out
// with the alarm never raised.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefFix, LevelManifest, type FloorGraph } from "@/domain";
import type { OwnerSetup } from "@/domain/owner-setup";
import { act, AUTOPLAY_MAX_TURNS, createRun, moveGuards, type Level, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import fixRecording from "../../../fixtures/llm/fix-F1.json";
import { toEngineFix } from "./chief-fix";
import { demoSetups } from "./demo-setups";
import { CYCLE_CAP } from "./night";
import { NOT_MEASURED, openWindows, searchStates, STATE_BUDGET, type OpenWindows } from "./open-windows";
import { ownerZones } from "./owner-batch";
import { setupFromPlaced, setupWithFix } from "./owner-edit";
import { batchNights, firstWindowLine, measureChange, measureNights, measureSetup, timingLine, windowsLine } from "./setup-measure";

/** Nodes n0…n(k-1) in a line, plus `side` hanging off n0, no sightlines: a guard sees only its own node. */
function line(k: number, doors: Record<number, string> = {}): FloorGraph {
  const ids = Array.from({ length: k }, (_, i) => `n${i}`);
  return {
    nodes: [...ids.map((id, i) => ({ id, x: i, y: 0, roomId: "hall", tags: [] })), { id: "side", x: 0, y: 1, roomId: "hall", tags: [] }],
    edges: [
      ...ids.slice(1).map((id, i) => ({ a: ids[i], b: id, ...(doors[i] && { door: { id: doors[i], lockable: true } }) })),
      { a: "n0", b: "side" },
    ],
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: k, h: 2 } }],
    sightlines: {},
    source: "fixture",
  };
}

function level(floor: FloorGraph, objective: string, overrides: Partial<Level> = {}): Level {
  return {
    buildingId: "T",
    missionId: "t",
    seed: 1,
    floor,
    start: "n0",
    objective,
    exits: ["n0"],
    lockedDoors: [],
    pickTurns: 2,
    patrolTempo: 1,
    guards: [],
    ...overrides,
  };
}

/** Plays a window's actions with the engine from its turn of the night (guards moved on that many turns). */
function playBack(lvl: Level, w: NonNullable<OpenWindows["first"]>): RunState {
  const start = createRun({ ...lvl, start: w.entry });
  let guards = start.guards;
  for (let t = 0; t < w.turn; t++) guards = moveGuards(start.board, guards);
  let run: RunState = { ...start, guards, turn: w.turn };
  for (const action of w.actions) {
    const next = act(run, action);
    if (!next.ok) throw new Error(next.reason);
    run = next.run;
  }
  return run;
}

describe("open windows on a small floor", () => {
  // A sweeping camera watches n1 on even turns and `side` on odd ones. The
  // quickest way in and out is a sprint to the files at n2, a take, and a
  // sprint back: three turns, through n1 on the first and the third.
  const sweep = level(line(3), "n2", { cameras: [{ id: "C1", kind: "analog-sweep", cover: ["n1", "side"] }] });

  it("opens only on the turns the quick route is clear, when time is short", () => {
    const w = openWindows(sweep, ["n0"], 3);
    expect(w).toMatchObject({ open: 1, moments: 2, share: 50 });
    expect(w.first).toMatchObject({ entry: "n0", turn: 1, route: ["n0", "n1", "n2", "n1", "n0"] });
    expect(w.first!.actions).toEqual([
      { kind: "sprint", to: "n2", via: "n1" },
      { kind: "take" },
      { kind: "sprint", to: "n0", via: "n1" },
    ]);
    expect(playBack(sweep, w.first!)).toMatchObject({ status: "won", alarmEvents: [] });
  });

  it("opens on every turn when the crew has time to wait for the sweep", () => {
    expect(openWindows(sweep, ["n0"])).toMatchObject({ open: 2, moments: 2, share: 100 });
  });

  it("with no guards and no cameras, every moment is open", () => {
    const w = openWindows(level(line(4), "n3"), ["n0", "side"]);
    expect(w).toMatchObject({ open: 2, moments: 2, share: 100 });
  });

  it("with every position watched all night, none is", () => {
    const all = ["n0", "n1", "n2", "side"];
    expect(openWindows(level(line(3), "n2", { cameras: [{ id: "C1", kind: "fixed-ip", cover: all }] }), ["n0"])).toMatchObject({
      open: 0,
      moments: 1,
      first: null,
    });
  });

  it("counts a pick heard by a guard as caught", () => {
    // The files sit behind a locked door between n1 and n2; a guard stands at n4, three hops from n1.
    const locked = (hearing: number) =>
      level(line(5, { 1: "d12" }), "n2", { lockedDoors: ["d12"], guards: [{ id: "G1", patrol: ["n4"] }], hearing });
    const quiet = openWindows(locked(2), ["n0"]);
    expect(quiet).toMatchObject({ open: 1, moments: 1 });
    expect(quiet.first!.actions.filter((a) => a.kind === "pick")).toHaveLength(2);
    expect(playBack(locked(2), quiet.first!)).toMatchObject({ status: "won", alarmEvents: [] });
    expect(openWindows(locked(3), ["n0"])).toMatchObject({ open: 0, moments: 1 });
  });

  it("counts every turn of a night cut at the cap", () => {
    const capped = level(line(4), "n3", {
      guards: [
        { id: "G1", patrol: ["n1", "n3"] },
        { id: "G2", patrol: ["n2", "n3"] },
      ],
      guardTempo: { G1: 7, G2: 11 },
      cameras: [{ id: "C1", kind: "ptz", cover: ["n1", "n2", "side"] }],
    });
    expect(openWindows(capped, ["n0"]).moments).toBe(CYCLE_CAP);
  });
});

describe("a floor too large to search (issue 144 review)", () => {
  /** A w × h grid with a lockable door on each of its first `doors` row edges, all locked, and two guards whose night reaches the cap. */
  function grid(w: number, h: number, doors: number): Level {
    const id = (x: number, y: number) => `g${x}_${y}`;
    const nodes: FloorGraph["nodes"] = [];
    const edges: FloorGraph["edges"] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        nodes.push({ id: id(x, y), x, y, roomId: "hall", tags: [] });
        const d = edges.filter((e) => e.door).length;
        if (x + 1 < w) edges.push({ a: id(x, y), b: id(x + 1, y), ...(d < doors && { door: { id: `d${d}`, lockable: true } }) });
        if (y + 1 < h) edges.push({ a: id(x, y), b: id(x, y + 1) });
      }
    }
    const floor: FloorGraph = { nodes, edges, rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w, h } }], sightlines: {}, source: "fixture" };
    return level(floor, id(w - 1, h - 1), {
      start: id(0, 0),
      exits: [id(0, 0)],
      lockedDoors: Array.from({ length: doors }, (_, i) => `d${i}`),
      guards: [
        { id: "G1", patrol: [id(1, 1), id(1, 3)] },
        { id: "G2", patrol: [id(2, 1), id(3, 1)] },
      ],
      guardTempo: { G1: 7, G2: 11 },
    });
  }

  it("counts its states without building them, and skips the search over the budget", () => {
    // 80 nodes, a 240-turn night (two nights' turns searched), 3 locked doors: 80 × 480 × 2 × 8.
    const big = grid(8, 10, 3);
    expect(searchStates(big)).toBe(614_400);
    expect(openWindows(big, ["g0_0"], AUTOPLAY_MAX_TURNS, 600_000)).toEqual(NOT_MEASURED);
    // 40 locked doors: 1 << 40 would overflow; the count stays exact and nothing is searched.
    const doors = grid(8, 10, 40);
    expect(searchStates(doors)).toBe(80 * 480 * 2 * 2 ** 40);
    expect(openWindows(doors, ["g0_0"])).toEqual(NOT_MEASURED);
  });

  it("says the windows were not measured, with no timing line, when the batch's nights are over the budget together", () => {
    // 307,200 states a night fits one night's budget but not a tenth of it.
    const night = { level: grid(8, 10, 2), entries: [{ nodeId: "g0_0" }] };
    expect(searchStates(night.level)).toBeGreaterThan(STATE_BUDGET / 10);
    const m = measureNights(Array.from({ length: 10 }, () => night));
    expect(m.windows).toEqual(NOT_MEASURED);
    expect(m).toMatchObject({ openNights: 0, firstNight: null, firstRooms: null });
    expect(m.coverage).toBeGreaterThan(0);
    expect(windowsLine(m)).toBe("Open windows: not measured on a floor this size.");
    expect(firstWindowLine(m)).toBeNull();
    expect(timingLine(m, 5)).toBeNull();
    const open = { ...m, windows: { measured: true, open: 40, moments: 80, share: 50, first: null } };
    expect(measureChange(open, m)).toBe(`Coverage ${m.coverage}% → ${m.coverage}%, open windows 40 of 80 → not measured`);
  });
});

describe("open windows on F1, over the nights the batch plays", () => {
  const manifest = LevelManifest.parse(structuredClone(cached));
  const floor = FIXTURE_FLOORS.F1;
  const generated = setupFromPlaced(placeLevel(manifest, floor, 1));
  const fixed = setupWithFix(generated, toEngineFix(ChiefFix.parse(fixRecording.fix), ownerZones(manifest, floor)), placeLevel(manifest, floor, 1).level, "After the fix");
  const [night, moved] = demoSetups("F1").map((d) => d.setup);
  const of = (s: OwnerSetup) => measureSetup(manifest, floor, s)!;

  it("pins each setup's windows, as they come out", () => {
    expect(of(generated).windows).toMatchObject({ open: 40, moments: 80, share: 50 });
    expect(of(fixed).windows).toMatchObject({ open: 0, moments: 80, share: 0, first: null });
    expect(of(night).windows).toMatchObject({ open: 40, moments: 80, share: 50 });
    expect(of(moved).windows).toMatchObject({ open: 20, moments: 80, share: 25 });
    expect(of(moved)).toMatchObject({ openNights: 10, nights: 10, firstNight: 1 });
    expect(windowsLine(of(night))).toBe("Open windows: 40 of 80 moments in the 10 nights the crew plays let a crew in and out unseen by guards and cameras. A moment is a way in at any turn of a night; the attempts all start at turn 0.");
    expect(measureChange(of(night), of(moved))).toBe("Coverage 43% → 50%, open windows 40 of 80 → 20 of 80");
    expect(firstWindowLine(of(moved))).toBe(
      "The first opens on night 1, turn 1, a turn no attempt starts on: Freight Lift Lobby → Dock Corridor → Records Room → Dock Corridor → Freight Lift Lobby.",
    );
    expect(firstWindowLine(of(fixed))).toBeNull();
  });

  it("counts each night's windows with that night's guards and cameras, and adds them up", () => {
    for (const setup of [generated, fixed, night, moved]) {
      const nights = batchNights(manifest, floor, setup)!;
      const each = nights.map((n) => openWindows(n.level, n.entries.map((e) => e.nodeId)));
      expect(of(setup).windows.open).toBe(each.reduce((sum, w) => sum + w.open, 0));
      expect(of(setup).windows.moments).toBe(each.reduce((sum, w) => sum + w.moments, 0));
    }
  });

  it("every first window plays out through the engine on its night unseen and unheard by guards and cameras (the night shift's cleaner is left out, as it never catches)", () => {
    for (const setup of [generated, night, moved]) {
      const m = of(setup);
      const first = m.windows.first!;
      const run = playBack(batchNights(manifest, floor, setup)![m.firstNight! - 1].level, first);
      expect(run.status).toBe("won");
      expect(run.alarmEvents.filter((e) => e.cause.kind !== "cleaner" && e.cause.kind !== "decay")).toEqual([]);
      expect(run.turn - first.turn).toBeLessThanOrEqual(120);
    }
  });

  it("gives the same answer every time", () => {
    expect(of(moved).windows).toEqual(of(moved).windows);
  });
});
