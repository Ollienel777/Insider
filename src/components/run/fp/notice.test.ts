// Being noticed in first person (issue 146) is read from the engine's own
// run state: seen when its sight covers the player's node, near when a
// watched node is one move away, heard when a noisy action had guards in
// range, and never below the alarm's level.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, hearingRange, neighbours, shortestPath, withinHops, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import { sprintChoices } from "../board";
import { RUN_SEED } from "../run-screen";
import { earshot, noiseCue, noticeOf, NOTICE_LEVEL } from "./notice";
import { sightOf, trippedBy, watchedNodes } from "./sight";
import { FP } from "./tuning";

const placed = placeLevel(LevelManifest.parse(structuredClone(f1)), structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const run0 = createRun(placed.level);
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

/** A node nobody watches on `run`'s turn, none of whose open neighbours is watched either, with no guard in earshot; and one somebody watches. */
function nodesOf(run: RunState) {
  const watched = watchedNodes(sight(run));
  const quiet = (id: string) => {
    const at = { ...run, playerNode: id };
    return (
      !watched.has(id) &&
      !sight(run).some((s) => s.next.includes(id)) &&
      neighbours(run.board, id).every((e) => !watched.has(e.to)) &&
      earshot(at).length === 0
    );
  };
  const free = [...run.board.nodes.keys()].find(quiet)!;
  const seen = [...watched.keys()][0];
  const beside = [...run.board.nodes.keys()].find(
    (id) => !watched.has(id) && neighbours(run.board, id).some((e) => e.doorId === undefined && watched.has(e.to)),
  )!;
  return { free, seen, beside, watched };
}

describe("noticeOf", () => {
  it("is full and in the danger tone when the engine's sight covers the player's node", () => {
    const { seen, watched } = nodesOf(run0);
    const run = { ...run0, playerNode: seen };
    const notice = noticeOf(run, sight(run));
    expect(notice.level).toBe(NOTICE_LEVEL.seen);
    expect(notice.tone).toBe("danger");
    expect(notice.seenBy).toEqual(watched.get(seen)!.by);
    expect(notice.reason).toMatch(/has you in view/);
  });

  it("is nothing away from every watched node and every guard, with no noise and no alarm", () => {
    const { free } = nodesOf(run0);
    expect(free, "F1 has a quiet node").toBeDefined();
    const run = { ...run0, playerNode: free };
    expect(noticeOf(run, sight(run))).toMatchObject({ level: 0, tone: "calm", reason: "Unseen", seenBy: [], heardBy: [], tripped: null });
  });

  it("warns one open move from a watched node, naming who watches it", () => {
    const { beside, watched } = nodesOf(run0);
    const run = { ...run0, playerNode: beside };
    const notice = noticeOf(run, sight(run));
    expect(notice.level).toBeGreaterThanOrEqual(NOTICE_LEVEL.near);
    expect(notice.tone).toBe("warning");
    const by = neighbours(run.board, beside).flatMap((e) => watched.get(e.to)?.by ?? []);
    expect(by).toContain(notice.nearTo);
  });

  it("names the guards in earshot, as the engine's hearing range counts hops", () => {
    for (const run of straightIn) {
      const near = withinHops(run.board, run.playerNode, hearingRange(run.board, run.playerNode));
      expect(earshot(run).sort()).toEqual(run.guards.filter((g) => near.has(g.nodeId)).map((g) => g.id).sort());
      if (earshot(run).length > 0) expect(noticeOf(run, sight(run)).level).toBeGreaterThanOrEqual(NOTICE_LEVEL.earshot);
    }
  });

  it("never reads below the alarm's own level", () => {
    for (const alarm of ["suspicious", "alert", "lockdown"] as const) {
      const { free } = nodesOf(run0);
      const run = { ...run0, playerNode: free, alarm };
      const notice = noticeOf(run, sight(run));
      expect(notice.level).toBe(alarm === "suspicious" ? NOTICE_LEVEL.suspicious : NOTICE_LEVEL.alert);
      expect(notice.reason).toBe(`Alarm ${alarm}`);
    }
  });

  it("names the watcher that raised the alarm, the turn after it did", () => {
    const tripped = straightIn.find((run) => trippedBy(run) !== null)!;
    expect(tripped, "walking straight in is seen").toBeDefined();
    const notice = noticeOf(tripped, sight(tripped));
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
    const waited = act(run0, { kind: "wait" });
    if (!waited.ok) throw new Error(waited.reason);
    let checked = 0;
    for (const playerNode of run0.board.nodes.keys()) {
      const from = { ...waited.run, playerNode };
      for (const choice of sprintChoices(from)) {
        const result = act(from, { kind: "sprint", to: choice.nodeId, via: choice.via });
        if (!result.ok || noiseCue(result.run).heardBy.length === 0) continue;
        const notice = noticeOf(result.run, sight(result.run));
        expect(notice.heardBy.length).toBeGreaterThan(0);
        expect(notice.level).toBeGreaterThanOrEqual(NOTICE_LEVEL.heard);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
