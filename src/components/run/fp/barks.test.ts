// Guard barks and the near miss (issue 146) come from two engine states:
// a guard that hears the player says so, a sighting is left to the crew, and
// slipping off a node just as it is watched is "That was close".
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, shortestPath, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import { sprintChoices } from "../board";
import { RUN_SEED } from "../run-screen";
import { barkOf, GUARD_BARKS, NEAR_MISS } from "./barks";
import { noiseCue } from "./notice";
import { sightOf, watchedNodes } from "./sight";

const placed = placeLevel(LevelManifest.parse(structuredClone(f1)), structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const run0 = createRun(placed.level);
const play = (run: RunState, action: Action): RunState | null => {
  const result = act(run, action);
  return result.ok ? result.run : null;
};

describe("barkOf", () => {
  it("says nothing on a fresh run, a quiet wait, or across a restart", () => {
    expect(barkOf(null, run0)).toBeNull();
    const waited = play(run0, { kind: "wait" })!;
    expect(barkOf(run0, waited)).toBeNull();
    expect(barkOf(waited, createRun(placed.level))).toBeNull();
  });

  it("has a guard that heard a sprint ask who is there, in its own name", () => {
    // After a turn, with the player put on each node in turn: every sprint the board offers from there.
    const waited = play(run0, { kind: "wait" })!;
    const starts = [...run0.board.nodes.keys()].map((playerNode) => ({ ...waited, playerNode }));
    let checked = 0;
    for (const from of starts) for (const choice of sprintChoices(from)) {
      const after = play(from, { kind: "sprint", to: choice.nodeId, via: choice.via });
      if (!after) continue;
      const seen = after.alarmEvents.some((e) => e.turn === from.turn && (e.cause.kind === "camera" || e.cause.kind === "guard"));
      const heard = noiseCue(after).heardBy;
      const bark = barkOf(from, after);
      if (seen) expect(bark, "a sighting is the crew's callout").toBeNull();
      else if (heard.length > 0) {
        expect(bark).toMatchObject({ speaker: heard[0], tone: "warning" });
        expect(GUARD_BARKS).toContain(bark!.text);
        checked++;
      }
    }
    expect(checked, "some sprint is heard and unseen").toBeGreaterThan(0);
  });

  it("is a near miss when the node just left is watched now and the one moved to is not", () => {
    // Every unseen single move along the way in: the crew says so exactly when the engine's sight closed behind.
    let run = run0;
    let found = 0;
    for (const to of shortestPath(run0.board, placed.level.start, [placed.level.objective])!.slice(1)) {
      const after = play(run, { kind: "move", to });
      if (!after || after.status !== "playing") break;
      const watched = watchedNodes(sightOf(after, 1));
      const quiet = !after.alarmEvents.some((e) => e.turn === run.turn);
      const close = quiet && watched.has(run.playerNode) && !watched.has(after.playerNode) && noiseCue(after).heardBy.length === 0;
      const bark = barkOf(run, after);
      expect(bark?.text === NEAR_MISS, `${run.playerNode} → ${to}`).toBe(close);
      if (close) found++;
      run = after;
    }
    // And one made to order, so the case is covered whatever the fixture's route does.
    const waited = play(run0, { kind: "wait" })!;
    expect(waited.alarmEvents).toHaveLength(0);
    const watchedNow = watchedNodes(sightOf(waited, 1));
    const left = [...watchedNow.keys()][0];
    const into = [...run0.board.nodes.keys()].find((id) => !watchedNow.has(id))!;
    expect(barkOf({ ...run0, playerNode: left }, { ...waited, playerNode: into })).toMatchObject({ speaker: "Crew", text: NEAR_MISS });
    expect(barkOf({ ...run0, playerNode: into }, { ...waited, playerNode: left })).toBeNull();
    expect(found).toBeGreaterThanOrEqual(0);
  });
});
