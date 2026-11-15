// Guard barks (issue 146) come from two engine states: a guard that hears
// the player says so, and a sighting is left to the crew. On the radio, a
// bark takes the air only from the plan step or a noise callout, gives it
// back for good to anything that outranks it, and is said once in a while,
// not once a turn.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import { sprintChoices } from "../board";
import { RUN_SEED } from "../run-screen";
import { BARK_GAP_MS, BARK_HOLD_MS, BARK_SILENT, barkMayTalk, barkOf, GUARD_BARKS, tuneBark, type Bark } from "./barks";
import { noiseCue } from "./notice";

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
      const seen = after.alarmEvents.some((e) => e.turn === from.turn && (e.cause.kind === "camera" || e.cause.kind === "guard" || e.cause.kind === "cleaner"));
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

  it("says nothing at Alert: the engine ignores noise there, and the guards are already closing in", () => {
    const waited = play(run0, { kind: "wait" })!;
    let checked = 0;
    for (const playerNode of run0.board.nodes.keys()) {
      const from = { ...waited, playerNode, alarm: "alert" as const };
      for (const choice of sprintChoices(from)) {
        const after = play(from, { kind: "sprint", to: choice.nodeId, via: choice.via });
        if (!after || after.status !== "playing") continue;
        expect(barkOf(from, after)).toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("a bark on the radio", () => {
  const RUN = {};
  const heard = (turn: number, speaker = "G1"): Bark => ({ key: `${turn}:${speaker}`, speaker, text: "Hello?", tone: "warning" });

  it("takes the air from the plan step or a noise callout, never from a sighting, the Chief or a note", () => {
    expect(barkMayTalk(null)).toBe(true);
    expect(barkMayTalk("step")).toBe(true);
    expect(barkMayTalk("noise")).toBe(true);
    for (const kind of ["sighting", "chief", "note"] as const) {
      expect(barkMayTalk(kind)).toBe(false);
      expect(tuneBark(BARK_SILENT, RUN, heard(3), kind, 0).bark).toBeNull();
    }
  });

  it("holds the air for its hold, then gives it back", () => {
    const on = tuneBark(BARK_SILENT, RUN, heard(3), "noise", 1000);
    expect(on.bark).toMatchObject({ speaker: "G1", until: 1000 + BARK_HOLD_MS });
    expect(tuneBark(on, RUN, null, "step", 1000 + BARK_HOLD_MS - 1).bark).not.toBeNull();
    expect(tuneBark(on, RUN, null, "step", 1000 + BARK_HOLD_MS).bark).toBeNull();
  });

  it("gives the air back for good to a sighting callout that comes after it", () => {
    const on = tuneBark(BARK_SILENT, RUN, heard(3), "noise", 0);
    const cut = tuneBark(on, RUN, null, "sighting", 700);
    expect(cut.bark).toBeNull();
    // The callout's hold ends before the bark's would have: the bark does not come back.
    expect(tuneBark(cut, RUN, null, "step", 900).bark).toBeNull();
  });

  it("is said once for a door picked turn after turn in a guard's hearing", () => {
    // First person's turns are 700 ms: three picks heard on three turns.
    let state = tuneBark(BARK_SILENT, RUN, heard(3), "noise", 0);
    const first = state.bark;
    state = tuneBark(state, RUN, heard(4), "noise", 700);
    expect(state.bark).toBe(first);
    state = tuneBark(state, RUN, heard(5, "G2"), "noise", 1400);
    expect(state.bark).toBe(first);
    // After its hold and the gap, the next heard turn barks again.
    state = tuneBark(state, RUN, null, "step", BARK_HOLD_MS);
    expect(state.bark).toBeNull();
    expect(tuneBark(state, RUN, heard(9), "noise", BARK_GAP_MS - 1).bark).toBeNull();
    expect(tuneBark(state, RUN, heard(9), "noise", BARK_GAP_MS).bark).toMatchObject({ key: "9:G1" });
  });

  it("starts from silence on a new run (Restart)", () => {
    const on = tuneBark(BARK_SILENT, RUN, heard(3), "noise", 0);
    const restarted = tuneBark(on, {}, null, "step", 100);
    expect(restarted.bark).toBeNull();
    // Nor does the last run's gap hold the new run's first bark back.
    expect(tuneBark(restarted, restarted.run, heard(0), "noise", 200).bark).not.toBeNull();
  });
});
