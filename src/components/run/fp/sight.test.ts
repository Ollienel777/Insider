// What first person draws on the floor is the engine's answer (issue 115):
// a node is marked exactly when stepping onto it this turn is seen, so what
// the player sees matches what catches them. Checked turn by turn along a
// quiet run and along a run that walks straight into the cameras.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, shortestPath, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import { quietRoute } from "@/level/quiet-route";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import f2 from "../../../../data/levels/F2.sunset-1986.json";
import f3 from "../../../../data/levels/F3.night-desk.json";
import { cameraMount, coverage } from "../board";
import { RUN_SEED } from "../run-screen";
import { sightOf, trippedBy, watchedNodes } from "./sight";
import { FP } from "./tuning";

const CASES = [
  { id: "F1", cached: f1 },
  { id: "F2", cached: f2 },
  { id: "F3", cached: f3 },
] as const;

describe.each(CASES)("what is drawn as watched on $id", ({ id, cached }) => {
  const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);

  /** Every state of a run that plays `actions` until the engine stops it. */
  function states(actions: readonly Action[]): RunState[] {
    const out = [createRun(placed.level)];
    for (const action of actions) {
      const result = act(out[out.length - 1], action);
      if (!result.ok) break;
      out.push(result.run);
    }
    return out;
  }
  const quiet = states(quietRoute(placed)!);
  const run0 = createRun(placed.level);
  const straightIn = states(
    shortestPath(run0.board, placed.level.start, [placed.level.objective])!
      .slice(1)
      .map((to): Action => ({ kind: "move", to })),
  );

  it("marks exactly the nodes the engine would see the player on, every turn", () => {
    for (const run of [...quiet, ...straightIn]) {
      const marked = watchedNodes(sightOf(run, FP.unitM));
      const engine = coverage(run);
      expect([...marked.keys()].sort()).toEqual([...engine.keys()].sort());
      for (const [nodeId, seen] of marked) expect(seen.by.sort()).toEqual([...engine.get(nodeId)!].sort());
    }
  });

  it("stepping onto a marked node raises the alarm, and onto an unmarked one never does", () => {
    for (const before of quiet.slice(0, -1)) {
      const marked = watchedNodes(sightOf(before, FP.unitM));
      for (const exit of before.board.adjacency.get(before.playerNode) ?? []) {
        const result = act(before, { kind: "move", to: exit.to });
        if (!result.ok) continue;
        const raised = result.run.alarmEvents.length > before.alarmEvents.length;
        expect(raised, `turn ${before.turn}: ${before.playerNode} → ${exit.to}`).toBe(marked.has(exit.to));
      }
    }
  });

  it("turns the watcher that raised the alarm, and only that one, to the tripped colour", () => {
    const tripped = straightIn.find((run) => trippedBy(run) !== null);
    expect(tripped, "walking straight in is seen").toBeDefined();
    const sight = sightOf(tripped!, FP.unitM);
    expect(sight.filter((s) => s.tripped).map((s) => s.id)).toEqual([trippedBy(tripped!)]);
    expect(sightOf(quiet[0], FP.unitM).some((s) => s.tripped)).toBe(false);
  });

  it("looks from where the board draws each watcher, in metres", () => {
    const sight = sightOf(run0, FP.unitM);
    for (const guard of run0.guards) {
      const node = run0.board.nodes.get(guard.nodeId)!;
      expect(sight.find((s) => s.id === guard.id)!.origin).toEqual({ x: node.x * FP.unitM, y: node.y * FP.unitM });
    }
    for (const camera of run0.board.cameras) {
      const mount = cameraMount(placed.level.floor, camera.parts.flat());
      expect(sight.find((s) => s.id === camera.id)!.origin).toEqual({ x: mount.x * FP.unitM, y: mount.y * FP.unitM });
    }
  });
});
