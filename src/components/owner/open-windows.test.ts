// Open windows (issue 120): small floors whose windows can be worked out by
// hand, the cap, and F1's generated security, the Chief's recorded fix and the
// prepared pair, pinned as they come out. Every first window found on F1 is
// played back through the engine's own `act`, which must get the crew out
// with the alarm never raised.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefFix, LevelManifest, type FloorGraph } from "@/domain";
import { act, createRun, moveGuards, type Level, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import fixRecording from "../../../fixtures/llm/fix-F1.json";
import { toEngineFix } from "./chief-fix";
import { demoSetups } from "./demo-setups";
import { CYCLE_CAP } from "./night";
import { openWindows, type OpenWindows } from "./open-windows";
import { ownerZones } from "./owner-batch";
import { boardOf, setupFromPlaced, setupWithFix } from "./owner-edit";
import { firstWindowLine, measureChange, measureSetup, windowsLine } from "./setup-measure";

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

describe("open windows on F1", () => {
  const manifest = LevelManifest.parse(structuredClone(cached));
  const floor = FIXTURE_FLOORS.F1;
  const generated = placeLevel(manifest, floor, 1);
  const fixed = boardOf(
    manifest,
    floor,
    setupWithFix(setupFromPlaced(generated), toEngineFix(ChiefFix.parse(fixRecording.fix), ownerZones(manifest, floor)), generated.level, "After the fix"),
    1,
  )!;
  const [night, moved] = demoSetups("F1").map((d) => boardOf(manifest, floor, d.setup, 1)!);

  it("pins each setup's windows, as they come out", () => {
    const of = (p: typeof generated) => measureSetup(p).windows;
    expect(of(generated)).toMatchObject({ open: 4, moments: 8, share: 50 });
    expect(of(fixed)).toMatchObject({ open: 0, moments: 8, share: 0, first: null });
    expect(of(night)).toMatchObject({ open: 4, moments: 8, share: 50 });
    expect(of(moved)).toMatchObject({ open: 2, moments: 8, share: 25 });
    expect(windowsLine(measureSetup(night))).toBe("Open windows: 4 of 8 moments in the night let a crew in and out unseen.");
    expect(measureChange(measureSetup(night), measureSetup(moved))).toBe(
      "Coverage 50% → 57%, open windows 4 → 2",
    );
    expect(firstWindowLine(measureSetup(moved))).toBe(
      "The first opens on turn 0: Freight Lift Lobby → Dock Corridor → Records Room → Dock Corridor → Freight Lift Lobby.",
    );
    expect(firstWindowLine(measureSetup(fixed))).toBeNull();
  });

  it("every first window plays out through the engine unseen and unheard by guards and cameras (the night shift's cleaner is left out, as it never catches)", () => {
    for (const placed of [generated, night, moved]) {
      const first = measureSetup(placed).windows.first!;
      const run = playBack(placed.level, first);
      expect(run.status).toBe("won");
      expect(run.alarmEvents.filter((e) => e.cause.kind !== "cleaner" && e.cause.kind !== "decay")).toEqual([]);
      expect(run.turn - first.turn).toBeLessThanOrEqual(120);
    }
  });

  it("gives the same answer every time", () => {
    expect(measureSetup(moved).windows).toEqual(measureSetup(moved).windows);
  });
});
