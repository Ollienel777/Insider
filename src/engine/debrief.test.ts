// The batch debrief's engine half (issue 127): a known batch summed, the Chief's
// change applied or refused with a reason, and the rerun, deterministic, on
// F1 with the recorded strategies and the recorded fix.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { BatchSummary, ChiefFix, LevelManifest, type BatchResult, type BatchRun, type Strategy } from "@/domain";
import { placeLevel } from "@/level/placer";
import cached from "../../data/levels/F1.romaine-1974.json";
import { roundOf } from "./autoplay";
import { applyFix, compileBoard, createRun, rerunWithFix, runBatch, summariseBatch, varyLevel } from "./index";

const manifest = LevelManifest.parse(structuredClone(cached));
const read = (file: string) => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "llm", file), "utf8"));
const strategies = (read("strategies-F1.json") as { strategies: Strategy[] }).strategies;
const recordedFix = ChiefFix.parse((read("fix-F1.json") as { fix: unknown }).fix);
const levelFor = (seed: number) => placeLevel(manifest, FIXTURE_FLOORS.F1, seed).level;
const input = { buildingId: "F1", strategies, levelFor };

const run = (over: Partial<BatchRun>): BatchRun => ({
  strategyId: "a",
  seed: 1,
  outcome: "caught",
  reachedObjective: false,
  escaped: false,
  turns: 5,
  route: ["n1", "n2"],
  firstDetectionTurn: null,
  detectedBy: null,
  ...over,
});

describe("summariseBatch", () => {
  const out = (route: string[], seed: number, strategyId = "a") =>
    run({ strategyId, seed, outcome: "escaped", escaped: true, reachedObjective: true, route });
  const seen = (kind: "camera" | "guard", id: string, turn: number, seed: number, strategyId = "b") =>
    run({ strategyId, seed, firstDetectionTurn: turn, detectedBy: { kind, id } });
  const runs = [
    out(["e", "x", "o", "x", "e"], 1),
    out(["e", "y", "o", "y", "e"], 2),
    out(["e", "x", "o", "x", "e"], 3),
    run({ seed: 4, outcome: "timeout" }),
    seen("camera", "C2", 3, 1),
    seen("camera", "C2", 1, 2),
    seen("guard", "G1", 6, 3),
    seen("camera", "C2", 3, 4),
  ];
  const result: BatchResult = {
    buildingId: "T1",
    seeds: [1, 2, 3, 4],
    strategies: [],
    dropped: [],
    runs,
    summary: {
      runs: 8,
      escaped: 3,
      reachedObjective: 3,
      caught: 4,
      timeout: 1,
      byStrategy: [
        { strategyId: "a", runs: 4, escaped: 3, reachedObjective: 3, caught: 0, timeout: 1 },
        { strategyId: "b", runs: 4, escaped: 0, reachedObjective: 0, caught: 4, timeout: 0 },
      ],
      byDetector: [],
    },
  };

  it("counts, finds the commonest way out and the element that bites most, and lays out the strip", () => {
    const summary = summariseBatch(result);
    expect(BatchSummary.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({
      buildingId: "T1",
      total: 8,
      escaped: 3,
      byStrategy: [
        { strategyId: "a", runs: 4, escaped: 3 },
        { strategyId: "b", runs: 4, escaped: 0 },
      ],
      topRoute: { nodes: ["e", "x", "o", "x", "e"], count: 2 },
    });
    expect(summary.detectors).toEqual([
      { kind: "camera", id: "C2", count: 3, turns: [1, 3] },
      { kind: "guard", id: "G1", count: 1, turns: [6] },
    ]);
    expect(summary.strip).toHaveLength(8);
    expect(summary.strip[0]).toEqual({ strategyId: "a", seed: 1, outcome: "escaped" });
    expect(summary.strip.map((c) => c.outcome[0]).join("")).toBe("eeetcccc");
  });

  it("has no route without an escape", () => {
    expect(summariseBatch({ ...result, runs: runs.filter((r) => !r.escaped) }).topRoute).toBeNull();
  });

  it("gives F1's batch as a 50-cell strip, most escapes by the dock", () => {
    const summary = summariseBatch(runBatch(input));
    expect(summary.strip).toHaveLength(50);
    expect(summary.escaped).toBe(17);
    expect(summary.topRoute?.nodes.slice(0, 3)).toEqual(["fl-car", "fl-lobby", "dc-west"]);
    expect(summary.topRoute?.count).toBe(14);
    expect(summary.detectors[0]).toMatchObject({ kind: "guard", id: "G2" });
  });
});

describe("applyFix", () => {
  const level = levelFor(1);

  it("moves a camera onto a zone, keeping its kind", () => {
    const applied = applyFix(level, { kind: "move-camera", elementId: "C2", to: "dock-corridor" });
    expect(applied.ok).toBe(true);
    const c2 = applied.level.cameras!.find((c) => c.id === "C2")!;
    expect(c2.cover).toEqual(level.floor.nodes.filter((n) => n.roomId === "dock-corridor").map((n) => n.id));
    expect(c2.kind).toBe(level.cameras!.find((c) => c.id === "C2")!.kind);
    expect(() => createRun(applied.level)).not.toThrow();
  });

  it("retimes a walking guard along the same round", () => {
    const applied = applyFix(level, { kind: "retime-guard", elementId: "G1", byTurns: 2 });
    expect(applied.ok).toBe(true);
    const g1 = applied.level.guards.find((g) => g.id === "G1")!;
    for (const waypoint of level.guards.find((g) => g.id === "G1")!.patrol) expect(g1.patrol).toContain(waypoint);
    expect(g1.patrol[0]).not.toBe(level.guards.find((g) => g.id === "G1")!.patrol[0]);
  });

  it("retimes later for a positive byTurns and earlier for a negative one", () => {
    const round = roundOf(compileBoard(level), level.guards.find((g) => g.id === "G1")!.patrol);
    expect(round.length).toBeGreaterThan(2);
    const patrolOf = (byTurns: number) => {
      const applied = applyFix(level, { kind: "retime-guard", elementId: "G1", byTurns });
      expect(applied.ok).toBe(true);
      return applied.level.guards.find((g) => g.id === "G1")!.patrol;
    };
    // The whole patrol, not only its start: an out-and-back round starts on the same node either way.
    // Later by 1: it starts a node back along its round, so it reaches the round's first node a turn late.
    expect(patrolOf(1)).toEqual([...round.slice(-1), ...round.slice(0, -1)]);
    // Earlier by 1: it starts a node ahead.
    expect(patrolOf(-1)).toEqual([...round.slice(1), round[0]]);
    expect(patrolOf(1)).not.toEqual(patrolOf(-1));
  });

  it("adds a guard off the entries, and locks the doors into a zone", () => {
    const added = applyFix(level, { kind: "add-guard", elementId: "G9", to: "dock-corridor" });
    expect(added.ok && added.level.guards.at(-1)).toMatchObject({ id: "G9" });
    expect(() => createRun(added.level)).not.toThrow();
    const locked = applyFix({ ...level, lockedDoors: [] }, { kind: "lock-door", elementId: "objective" });
    expect(locked.ok).toBe(true);
    expect(locked.level.lockedDoors).toContain("d-records-room");
  });

  it("refuses what this level does not have, with the reason, and leaves it unchanged", () => {
    const cases = [
      [{ kind: "move-camera", elementId: "C9", to: "dock-corridor" }, 'no camera "C9"'],
      [{ kind: "move-camera", elementId: "C2", to: "vault" }, 'no zone "vault"'],
      [{ kind: "move-camera", elementId: "C2" }, "move-camera needs a zone to cover"],
      [{ kind: "retime-guard", elementId: "G7", byTurns: 1 }, 'no guard "G7"'],
      [{ kind: "retime-guard", elementId: "G1", byTurns: 0 }, "retime-guard needs a whole, non-zero byTurns"],
      [{ kind: "retime-guard", elementId: "G1", byTurns: 9 }, "a round moves at most 6 turns either way"],
      [{ kind: "retime-guard", elementId: "G3", byTurns: 1 }, 'guard "G3" holds a post and walks no round'],
      // G1 walks a round of 4 on F1: a whole round (or two back) leaves it where it was.
      [{ kind: "retime-guard", elementId: "G1", byTurns: 4 }, 'guard "G1" walks a round of 4 turns, so 4 turns changes nothing'],
      [{ kind: "retime-guard", elementId: "G1", byTurns: -4 }, 'guard "G1" walks a round of 4 turns, so -4 turns changes nothing'],
      [{ kind: "lock-door", elementId: "objective" }, 'zone "objective" has no unlocked door that locks'],
      [{ kind: "add-guard", elementId: "G1", to: "dock-corridor" }, '"G1" is already on the floor'],
    ] as const;
    for (const [change, reason] of cases) {
      const applied = applyFix(level, change);
      expect(applied, reason).toEqual({ ok: false, level, reason });
    }
  });
});

describe("rerunWithFix on F1", () => {
  it("gives the same before and after every time", () => {
    const a = rerunWithFix(input, recordedFix);
    const b = rerunWithFix({ ...input, strategies: structuredClone(strategies) }, structuredClone(recordedFix));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the recorded fix (C2 over the whole dock corridor) lowers the success count", () => {
    const rerun = rerunWithFix(input, recordedFix);
    expect(rerun.dropped).toBeNull();
    expect(rerun.before.escaped).toBe(17);
    expect(rerun.after.escaped).toBeLessThan(rerun.before.escaped);
    expect(rerun.after.escaped).toBe(0);
    expect(rerun.after.total).toBe(50);
    expect(rerun.after.detectors[0]).toMatchObject({ kind: "camera", id: "C2" });
  });

  it("reuses a batch already played, and the varied level still takes the change", () => {
    const before = runBatch(input);
    expect(rerunWithFix(input, recordedFix, before).beforeResult).toBe(before);
    const varied = varyLevel(applyFix(levelFor(3), recordedFix.change).level, 3);
    expect(varied.cameras!.find((c) => c.id === "C2")!.cover).toContain("dc-east");
  });

  it("replays the setup unchanged when the change does not fit, with the reason", () => {
    const rerun = rerunWithFix(input, { change: { kind: "move-camera", elementId: "C7", to: "dock-corridor" }, rationale: "x" });
    expect(rerun.dropped).toBe('no camera "C7"');
    expect(rerun.after).toEqual(rerun.before);
  });
});
