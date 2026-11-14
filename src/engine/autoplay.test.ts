// Autoplay and the batch (#126) on the real F1 level: the cached manifest,
// the fixture floor, the crew's recorded strategies, and the placer per seed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { BatchResult, LevelManifest, type Strategy } from "@/domain";
import { placeLevel } from "@/level/placer";
import cached from "../../data/levels/F1.romaine-1974.json";
import { autoplay, BATCH_SEEDS, resolveStrategy, runBatch, varyLevel } from "./index";

const manifest = LevelManifest.parse(structuredClone(cached));
const floor = FIXTURE_FLOORS.F1;
const recorded = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "llm", "strategies-F1.json"), "utf8")) as {
  strategies: Strategy[];
};
const strategies = recorded.strategies;
const levelFor = (seed: number) => placeLevel(manifest, floor, seed).level;
const batch = () => runBatch({ buildingId: "F1", strategies, levelFor });
const byId = (id: string) => strategies.find((s) => s.id === id)!;

describe("runBatch on F1", () => {
  it("plays 5 strategies × 10 seeds into a well-formed BatchResult", () => {
    const result = batch();
    expect(BatchResult.parse(result)).toEqual(result);
    expect(result.seeds).toEqual([...BATCH_SEEDS]);
    expect(result.runs).toHaveLength(50);
    expect(result.dropped).toEqual([]);
    expect(result.summary.runs).toBe(50);
    const { escaped, caught, timeout } = result.summary;
    expect(escaped + caught + timeout).toBe(50);
    for (const run of result.runs) {
      expect(run.route[0]).toBe(levelFor(run.seed).zones![byId(run.strategyId).entryId][0]);
      if (run.escaped) expect(run.reachedObjective).toBe(true);
      expect(run.firstDetectionTurn === null).toBe(run.detectedBy === null);
    }
  });

  it("gives the same result every time for a fixed seed set", () => {
    expect(JSON.stringify(batch())).toBe(JSON.stringify(batch()));
    const seeds = [3, 11, 42];
    const a = runBatch({ buildingId: "F1", strategies, levelFor, seeds });
    const b = runBatch({ buildingId: "F1", strategies: structuredClone(strategies), levelFor, seeds });
    expect(a).toEqual(b);
  });

  it("reads as odds: a strategy gets out on some seeds and is caught on others", () => {
    const { summary } = batch();
    const tally = (id: string) => summary.byStrategy.find((s) => s.strategyId === id)!;
    // 17 of 50 get out with the files.
    expect(summary.escaped).toBe(17);
    expect(summary.escaped).toBeGreaterThanOrEqual(5);
    expect(summary.escaped).toBeLessThanOrEqual(20);
    const mixed = summary.byStrategy.filter((s) => s.escaped > 0 && s.escaped < s.runs);
    expect(mixed.map((s) => s.strategyId)).toEqual(["dock-patient", "dock-fast", "dock-in-roof-out"]);
    // The demo's way in (SPEC §2): the dock, waiting for the round, gets out most often.
    expect(tally("dock-patient").escaped).toBe(9);
    // The rounds walk the main corridor below the east stair.
    expect(tally("roof-quiet").caught).toBe(10);
  });

  it("plays the placed levels as they are with vary: false", () => {
    const plain = runBatch({ buildingId: "F1", strategies, levelFor, vary: false });
    expect(plain.runs.map((r) => r.outcome)).not.toEqual(batch().runs.map((r) => r.outcome));
  });

  it("names what saw the player first, and on which turn", () => {
    const caught = batch().runs.filter((r) => r.outcome === "caught");
    expect(caught.length).toBeGreaterThan(0);
    for (const run of caught) {
      expect(run.detectedBy).not.toBeNull();
      expect(run.firstDetectionTurn).toBeLessThan(run.turns);
    }
  });

  it("plays 50 attempts in under 3 s", () => {
    batch(); // warm up the JIT
    const started = performance.now();
    batch();
    const ms = performance.now() - started;
    console.info(`runBatch: 50 attempts on F1 in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(3000);
  });
});

describe("strategies the board cannot play", () => {
  const base = byId("dock-patient");

  it("drops an entry, exit or zone this floor has no place for, with the reason", () => {
    const result = runBatch({
      buildingId: "F1",
      levelFor,
      seeds: [1, 2],
      strategies: [
        base,
        { ...base, id: "garage", entryId: "garage-E" },
        { ...base, id: "lobby-out", exitId: "lobby-S" },
        { ...base, id: "via-nowhere", via: ["vault-9"] },
        { ...base, name: "again" },
      ],
    });
    expect(result.strategies.map((s) => s.id)).toEqual(["dock-patient"]);
    expect(result.runs).toHaveLength(2);
    expect(result.dropped).toEqual([
      { strategyId: "garage", reason: 'entry "garage-E" is not on this floor' },
      { strategyId: "lobby-out", reason: 'exit "lobby-S" is not on this floor' },
      { strategyId: "via-nowhere", reason: 'zone "vault-9" is not on this floor' },
      { strategyId: "dock-patient", reason: 'a strategy with id "dock-patient" is already in the batch' },
    ]);
  });

  it("resolves a playable strategy onto the level's nodes", () => {
    const resolved = resolveStrategy(levelFor(1), { ...base, via: ["quiet-2206"] });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.start).toBe("fl-car");
    expect(resolved.plan.exit).toBe("fl-car");
    expect(resolved.plan.via[0].length).toBeGreaterThan(0);
  });
});

describe("varyLevel", () => {
  it("starts each round and sweep at a seeded point, on the same route and cover", () => {
    const level = levelFor(1);
    const before = JSON.stringify(level);
    const a = varyLevel(level, 1);
    expect(JSON.stringify(level)).toBe(before);
    expect(varyLevel(level, 1)).toEqual(a);
    a.guards.forEach((guard, i) => {
      const placed = level.guards[i];
      expect(guard.id).toBe(placed.id);
      for (const waypoint of placed.patrol) expect(guard.patrol).toContain(waypoint);
    });
    a.cameras!.forEach((camera, i) => expect(camera.cover).toEqual(level.cameras![i].cover));
    const starts = BATCH_SEEDS.map((seed) => JSON.stringify(varyLevel(levelFor(seed), seed).guards.map((g) => g.patrol[0])));
    expect(new Set(starts).size).toBeGreaterThan(3);
  });
});

describe("autoplay", () => {
  it("heads for a via zone before the objective", () => {
    const level = levelFor(2);
    const play = (via: string[]) => {
      const resolved = resolveStrategy(level, { ...byId("dock-fast"), via });
      if (!resolved.ok) throw new Error(resolved.reason);
      return { plan: resolved.plan, result: autoplay(level, resolved.plan).result };
    };
    const direct = play([]).result;
    const { plan, result } = play(["quiet-2206"]);
    expect(result.route).not.toEqual(direct.route);
    // It turns off the dock corridor into office 2210, toward the suites, not into the records room.
    expect(result.route.slice(0, 6)).toEqual(["fl-car", "fl-lobby", "dc-west", "dc-mid", "dc-east", "o-west"]);
    const files = result.route.indexOf(level.objective);
    if (files !== -1) {
      const suite = new Set(plan.via[0]);
      const firstSuite = result.route.findIndex((id) => suite.has(id));
      expect(firstSuite).not.toBe(-1);
      expect(firstSuite).toBeLessThan(files);
    }
  });

  it("stops at the turn cap", () => {
    const level = levelFor(1);
    const resolved = resolveStrategy(level, byId("dock-patient"));
    if (!resolved.ok) throw new Error(resolved.reason);
    const { result } = autoplay(level, resolved.plan, 3);
    expect(result).toMatchObject({ outcome: "timeout", turns: 3, escaped: false });
  });

  it("leaves the level it is given untouched", () => {
    const level = levelFor(1);
    const before = JSON.stringify(level);
    const resolved = resolveStrategy(level, byId("roof-quiet"));
    if (!resolved.ok) throw new Error(resolved.reason);
    autoplay(level, resolved.plan);
    expect(JSON.stringify(level)).toBe(before);
  });
});
