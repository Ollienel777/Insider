// Being noticed in first person (issue 146) is read from the engine's own
// run state: seen when its sight covers the player's node, close when a
// watched node is near, heard when a noisy action had guards in range.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, hearingRange, shortestPath, withinHops, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import { sprintChoices } from "../board";
import { RUN_SEED } from "../run-screen";
import { earshot, noiseCue, noticeOf, NOTICE_CLOSE_MAX } from "./notice";
import { sightOf, trippedBy, watchedNodes } from "./sight";
import { FP } from "./tuning";

const placed = placeLevel(LevelManifest.parse(structuredClone(f1)), structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const run0 = createRun(placed.level);
const nodes = new Map([...run0.board.nodes].map(([id, n]) => [id, { x: n.x * FP.unitM, y: n.y * FP.unitM }]));
const sight = (run: RunState) => sightOf(run, FP.unitM);

function states(actions: readonly Action[]): RunState[] {
  const out = [run0];
  for (const action of actions) {
    const result = act(out[out.length - 1], action);
    if (!result.ok) break;
    out.push(result.run);
  }
  return out;
}

const straightIn = states(
  shortestPath(run0.board, placed.level.start, [placed.level.objective])!
    .slice(1)
    .map((to): Action => ({ kind: "move", to })),
);

/** A node nobody watches on `run`'s turn, and one somebody does. */
function nodesOf(run: RunState) {
  const watched = watchedNodes(sight(run));
  const free = [...run.board.nodes.keys()].find((id) => !watched.has(id) && !sight(run).some((s) => s.next.includes(id)))!;
  const seen = [...watched.keys()][0];
  return { free, seen, watched };
}

describe("noticeOf", () => {
  it("is full and in the danger tone when the engine's sight covers the player's node", () => {
    const { seen, watched } = nodesOf(run0);
    const run = { ...run0, playerNode: seen };
    const notice = noticeOf(run, sight(run), nodes.get(seen)!, nodes);
    expect(notice.level).toBe(1);
    expect(notice.tone).toBe("danger");
    expect(notice.seenBy).toEqual(watched.get(seen)!.by);
    expect(notice.reason).toMatch(/has you in view/);
  });

  it("is nothing far from every watched node, with no noise and no alarm", () => {
    const { free } = nodesOf(run0);
    const run = { ...run0, playerNode: free };
    const notice = noticeOf(run, sight(run), { x: 1e4, y: 1e4 }, nodes);
    expect(notice).toMatchObject({ level: 0, tone: "calm", reason: null, seenBy: [], heardBy: [], tripped: null });
  });

  it("rises as the body nears a watched node, short of being seen", () => {
    const { free, seen } = nodesOf(run0);
    const run = { ...run0, playerNode: free };
    const at = nodes.get(seen)!;
    const near = noticeOf(run, sight(run), { x: at.x + FP.watchedM + 0.5, y: at.y }, nodes);
    const further = noticeOf(run, sight(run), { x: at.x + FP.watchedM + 2.5, y: at.y }, nodes);
    expect(near.tone).toBe("warning");
    expect(near.level).toBeGreaterThan(further.level);
    expect(near.level).toBeLessThanOrEqual(NOTICE_CLOSE_MAX);
    expect(near.closeTo).not.toBeNull();
  });

  it("names the watcher that raised the alarm, the turn after it did", () => {
    const tripped = straightIn.find((run) => trippedBy(run) !== null)!;
    expect(tripped, "walking straight in is seen").toBeDefined();
    const notice = noticeOf(tripped, sight(tripped), nodes.get(tripped.playerNode)!, nodes);
    expect(notice.tone).toBe("danger");
    expect(notice.tripped).toBe(trippedBy(tripped));
    expect(notice.reason).toContain(trippedBy(tripped)!);
  });
});

describe("noiseCue", () => {
  it("is quiet after a walk and a wait", () => {
    expect(noiseCue(run0).loud).toBe(false);
    expect(noiseCue(straightIn[1]).loud).toBe(false);
    const waited = act(run0, { kind: "wait" });
    expect(waited.ok && noiseCue(waited.run).loud).toBe(false);
  });

  it("is loud after a sprint, and names every guard the engine had hear it", () => {
    // A turn in first, so the log holds where the guards stood when the engine listened.
    const waited = act(run0, { kind: "wait" });
    if (!waited.ok) throw new Error(waited.reason);
    const from = waited.run;
    let checked = 0;
    for (const choice of sprintChoices(from)) {
      const result = act(from, { kind: "sprint", to: choice.nodeId, via: choice.via });
      if (!result.ok) continue;
      const cue = noiseCue(result.run);
      expect(cue.loud).toBe(true);
      expect(cue.kind).toBe("sprint");
      expect(cue.rangeHops).toBe(hearingRange(from.board, choice.nodeId));
      const heard = withinHops(from.board, choice.nodeId, cue.rangeHops);
      expect([...cue.heardBy].sort()).toEqual(from.guards.filter((g) => heard.has(g.nodeId)).map((g) => g.id).sort());
      for (const e of result.run.alarmEvents.filter((e) => e.cause.kind === "noise")) expect(cue.heardBy).toContain(e.cause.id);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("reads as heard on the meter", () => {
    for (const choice of sprintChoices(run0)) {
      const result = act(run0, { kind: "sprint", to: choice.nodeId, via: choice.via });
      if (!result.ok || noiseCue(result.run).heardBy.length === 0) continue;
      const run = result.run;
      const notice = noticeOf(run, sight(run), { x: 1e4, y: 1e4 }, nodes);
      expect(notice.heardBy.length).toBeGreaterThan(0);
      expect(notice.level).toBeGreaterThanOrEqual(0.5);
      return;
    }
  });
});

describe("earshot", () => {
  it("is the guards and cleaners within the engine's hearing range of the player's node", () => {
    for (const run of straightIn) {
      const near = withinHops(run.board, run.playerNode, hearingRange(run.board, run.playerNode));
      const want = [...run.guards, ...run.cleaners].filter((g) => near.has(g.nodeId)).map((g) => g.id);
      expect([...earshot(run)].sort()).toEqual(want.sort());
    }
  });
});
