// Being noticed in first person (issue 146) is read from the engine's own
// run state: seen when its sight covers the player's node, near when a
// watched node is one move away, heard when a noisy action had guards in
// range, and never below the alarm's level. Across whole runs on every
// fixture floor it reads the board's own `coverage`, and hears whom the
// crew's callout says heard.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, hearingRange, neighbours, shortestPath, withinHops, type Action, type Level, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import f2 from "../../../../data/levels/F2.sunset-1986.json";
import f3 from "../../../../data/levels/F3.night-desk.json";
import { choices, coverage, sprintChoices } from "../board";
import { noticedBy } from "../play-hud";
import { RUN_SEED } from "../run-screen";
import { barkOf } from "./barks";
import { earshot, noiseCue, noticeOf, NOTICE_LEVEL } from "./notice";
import { sightOf, trippedBy, watchedNodes } from "./sight";
import { FP } from "./tuning";

const placeOf = (manifest: unknown, floor: string) => placeLevel(LevelManifest.parse(structuredClone(manifest)), structuredClone(FIXTURE_FLOORS[floor]), RUN_SEED);
const placed = placeOf(f1, "F1");
const run0 = createRun(placed.level);
const sight = (run: RunState) => sightOf(run, FP.unitM);
const isAlert = (run: RunState) => run.alarm === "alert" || run.alarm === "lockdown";

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
    const { watched } = nodesOf(run0);
    const kinds = new Map(sight(run0).map((s) => [s.id, s.kind]));
    const seen = [...watched.keys()].find((id) => watched.get(id)!.by.some((by) => kinds.get(by) !== "cleaner"))!;
    const run = { ...run0, playerNode: seen };
    const notice = noticeOf(run);
    expect(notice.level).toBe(NOTICE_LEVEL.seen);
    expect(notice.tone).toBe("danger");
    const by = watched.get(seen)!.by;
    expect([...notice.seenBy, ...notice.glimpsedBy]).toEqual(by);
    expect(notice.reason).toMatch(/has you in view/);
  });

  it("is nothing away from every watched node and every guard, with no noise and no alarm", () => {
    const { free } = nodesOf(run0);
    expect(free, "F1 has a quiet node").toBeDefined();
    const run = { ...run0, playerNode: free };
    expect(noticeOf(run)).toMatchObject({ level: 0, tone: "calm", cause: "unseen", reason: "Unseen", seenBy: [], heardBy: [], tripped: null });
  });

  it("warns one open move from a watched node, naming who watches it", () => {
    const { beside, watched } = nodesOf(run0);
    const run = { ...run0, playerNode: beside };
    const notice = noticeOf(run);
    expect(notice.level).toBeGreaterThanOrEqual(NOTICE_LEVEL.near);
    expect(notice.tone).toBe("warning");
    const by = neighbours(run.board, beside).flatMap((e) => watched.get(e.to)?.by ?? []);
    expect(by).toContain(notice.nearTo);
  });

  it("names the guards in earshot, as the engine's hearing range counts hops", () => {
    for (const run of straightIn) {
      const near = withinHops(run.board, run.playerNode, hearingRange(run.board, run.playerNode));
      expect(earshot(run).sort()).toEqual(run.guards.filter((g) => near.has(g.nodeId)).map((g) => g.id).sort());
      if (earshot(run).length > 0) expect(noticeOf(run).level).toBeGreaterThanOrEqual(NOTICE_LEVEL.earshot);
    }
  });

  it("never reads below the alarm's own level", () => {
    for (const alarm of ["suspicious", "alert", "lockdown"] as const) {
      const { free } = nodesOf(run0);
      const run = { ...run0, playerNode: free, alarm };
      const notice = noticeOf(run);
      expect(notice.level).toBe(alarm === "suspicious" ? NOTICE_LEVEL.suspicious : NOTICE_LEVEL.alert);
      expect(notice.reason).toBe(`Alarm ${alarm}`);
    }
  });

  it("names the watcher that raised the alarm, the turn after it did", () => {
    const tripped = straightIn.find((run) => trippedBy(run) !== null)!;
    expect(tripped, "walking straight in is seen").toBeDefined();
    const notice = noticeOf(tripped);
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
        const notice = noticeOf(result.run);
        expect(notice.heardBy.length).toBeGreaterThan(0);
        expect(notice.level).toBeGreaterThanOrEqual(NOTICE_LEVEL.heard);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

/** A run played by a seeded walk: moves, picks at locked doors, sprints and waits, until it ends or `turns` are up. */
function walk(level: Level, seed: number, turns = 160): RunState[] {
  let rng = seed >>> 0;
  const next = () => (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const out = [createRun(level)];
  for (let i = 0; i < turns; i++) {
    const run = out[out.length - 1];
    if (run.status !== "playing") break;
    const options: Action[] = [{ kind: "wait" }, ...choices(run).map((c) => c.action)];
    // Now and then a sprint, as the board offers it: noise heard at every alarm level.
    if (next() < 0.2) options.push(...sprintChoices(run).map((c): Action => ({ kind: "sprint", to: c.nodeId, via: c.via })));
    const picks = options.filter((a) => a.kind === "pick");
    const action = picks.length > 0 && next() < 0.7 ? picks[0] : options[Math.floor(next() * options.length)];
    const result = act(run, action);
    if (result.ok) out.push(result.run);
  }
  return out;
}

const LEVELS = [placeOf(f1, "F1"), placeOf(f2, "F2"), placeOf(f3, "F3")].map((p) => p.level);
const RUNS = LEVELS.flatMap((level) => [1, 2, 3, 4, 5, 6].map((seed) => walk(level, seed)));
const pairs = RUNS.flatMap((states) => states.slice(1).map((after, i) => ({ before: states[i], after })));

describe("the meter against the engine, over whole runs on every fixture floor", () => {
  it("has the player seen or glimpsed by exactly the board's coverage of their node", () => {
    let seen = 0;
    for (const states of RUNS) {
      for (const run of states) {
        if (run.status !== "playing") continue;
        const notice = noticeOf(run);
        const kinds = new Map(sight(run).map((s) => [s.id, s.kind]));
        // A cleaner's look counts for nothing at Alert (alarm.ts `detect`).
        const covered = (coverage(run).get(run.playerNode) ?? []).filter((id) => kinds.get(id) !== "cleaner" || !isAlert(run));
        expect([...notice.seenBy, ...notice.glimpsedBy]).toEqual(covered);
        expect(notice.seenBy.every((id) => kinds.get(id) !== "cleaner")).toBe(true);
        if (notice.seenBy.length > 0) seen++;
      }
    }
    expect(seen, "the walks are seen now and then").toBeGreaterThan(0);
  });

  it("is red exactly when the engine would raise the alarm to Alert on it, or it is there already, and never below the alarm", () => {
    for (const states of RUNS) {
      for (const run of states) {
        if (run.status !== "playing") continue;
        const notice = noticeOf(run);
        const red = notice.seenBy.length > 0 || trippedBy(run) !== null || isAlert(run);
        expect(notice.tone).toBe(red ? "danger" : notice.level > 0 ? "warning" : "calm");
        const floor = run.alarm === "calm" ? 0 : run.alarm === "suspicious" ? NOTICE_LEVEL.suspicious : NOTICE_LEVEL.alert;
        expect(notice.level).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it("keeps a cleaner's glimpse amber: the engine makes it Suspicious at most", () => {
    // A cleaner set down on a node beside the player's start, where its look covers the start.
    const level = LEVELS[0];
    const board = createRun(level).board;
    const post = neighbours(board, level.start).map((e) => e.to).find((at) => {
      const run = createRun({ ...level, cameras: [], guards: [], cleaners: [{ id: "K1", patrol: [at] }] });
      return (coverage(run).get(level.start) ?? []).includes("K1");
    });
    const at = post ?? level.start;
    const run = createRun({ ...level, cameras: [], guards: [], cleaners: [{ id: "K1", patrol: [at] }] });
    const notice = noticeOf(run);
    expect(notice).toMatchObject({ cause: "glimpsed", tone: "warning", level: NOTICE_LEVEL.glimpsed, seenBy: [], glimpsedBy: ["K1"] });
    expect(notice.reason).toBe("Cleaner K1 has you in view");
    // At Alert it changes nothing in the engine, and nothing on the meter but the alarm.
    expect(noticeOf({ ...run, alarm: "alert" })).toMatchObject({ cause: "alarm", glimpsedBy: [], reason: "Alarm alert" });
  });

  it("hears whom the crew's callout says heard, and nobody once the alarm is at Alert", () => {
    let heard = 0;
    let ignored = 0;
    for (const { before, after } of pairs) {
      if (after.status !== "playing") continue;
      const watchers = noticedBy(before, after);
      // A turn someone saw the player on: the meter says so first, whoever heard (the engine's order is replayed in play-hud.ts).
      if (watchers.some((w) => w.sense === "sees")) continue;
      const crew = watchers.filter((w) => w.sense === "hears").map((w) => w.id).sort();
      expect([...noiseCue(after).heardBy].sort()).toEqual(crew);
      const loud = noiseCue(after).loud;
      if (loud && crew.length > 0) heard++;
      if (loud && isAlert(before) && earshot({ ...before, playerNode: after.playerNode }).length > 0) ignored++;
    }
    expect(heard, "some noise is heard").toBeGreaterThan(0);
    expect(ignored, "some noise is made at Alert with a guard in range").toBeGreaterThan(0);
  });

  it("says why with the sense it is about: the eye for sight, though the player was heard too", () => {
    for (const states of RUNS) {
      for (const run of states) {
        if (run.status !== "playing") continue;
        const notice = noticeOf(run);
        if (notice.seenBy.length > 0) expect(notice.cause).toBe("seen");
        else if (notice.tripped) expect(notice.cause).toBe("tripped");
        else if (notice.heardBy.length > 0) expect(notice.cause).toBe("heard");
        // Every watcher by its kind's word, as the rest of the line names them.
        expect(notice.reason).not.toMatch(/^(G|C|K)\d/);
      }
    }
  });

  it("names a guard's bark only on a turn the crew calls a noise, by the guard that heard", () => {
    let barked = 0;
    for (const { before, after } of pairs) {
      const bark = barkOf(before, after);
      if (!bark) continue;
      const watchers = noticedBy(before, after);
      expect(watchers.some((w) => w.sense === "sees"), "a bark is never said over a sighting").toBe(false);
      expect(watchers).toContainEqual({ id: bark.speaker, sense: "hears" });
      barked++;
    }
    expect(barked, "some guard barks").toBeGreaterThan(0);
  });
});

describe("noiseCue on the run's first turn", () => {
  it("has the guards hear from where they stood before they moved: each patrol's first node", () => {
    let checked = 0;
    for (const level of LEVELS) {
      const run = createRun(level);
      for (const choice of sprintChoices(run)) {
        const result = act(run, { kind: "sprint", to: choice.nodeId, via: choice.via });
        if (!result.ok || result.run.status !== "playing") continue;
        const crew = noticedBy(run, result.run);
        if (crew.some((w) => w.sense === "sees")) continue;
        expect([...noiseCue(result.run).heardBy].sort()).toEqual(crew.filter((w) => w.sense === "hears").map((w) => w.id).sort());
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
