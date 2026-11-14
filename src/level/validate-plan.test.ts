// The crew plan's validator on the cached F1 level placed as the Run screen
// places it, with the recorded crew replies (fixtures/llm/crew-F1.json).
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { CrewPlan, LevelManifest } from "@/domain";
import { act, createRun, type Action, type RunState } from "@/engine";
import cached from "../../data/levels/F1.json";
import recording from "../../fixtures/llm/crew-F1.json";
import { placeLevel } from "./placer";
import { adviceFor, validatePlan, waitTurns } from "./validate-plan";

const RUN_SEED = 7; // the Run screen's (src/components/run/run-screen.tsx)
const SEEDS = Array.from({ length: 24 }, (_, i) => i);
const place = (seed = RUN_SEED) =>
  placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS.F1), seed);
const placed = place();
const reply = (id: string): CrewPlan => CrewPlan.parse(recording.replies.find((r) => r.id === id)!.plan);

/** Plays every action through the engine; a refused one fails the test. */
function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action, i) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`action ${i} (${JSON.stringify(action)}) refused: ${result.reason}`);
    return result.run;
  }, run);
}

describe("validatePlan on the demo order (SPEC §2 beat 4)", () => {
  const checked = validatePlan(placed, reply("dock-wait"));

  it("keeps the crew's four steps, in order, with the zones' fiction names", () => {
    expect(checked.dropped).toEqual([]);
    expect(checked.steps.map((s) => [s.number, s.zoneId, s.zone])).toEqual([
      [1, "dock-N", "Loading dock"],
      [2, "dock-N", "Loading dock"],
      [3, "objective", "Records room"],
      [4, "dock-N", "Loading dock"],
    ]);
  });

  it("warns that camera C2 sees the plan on the way out, on turn 12, computed on the board", () => {
    expect(checked.outcome).toBe("seen");
    expect(checked.warnings).toHaveLength(1);
    const [warning] = checked.warnings;
    expect(warning).toMatchObject({ kind: "camera", by: "C2", turn: 12, nodeId: "dc-mid", room: "Dock Corridor", outbound: true });
    expect(warning.text).toBe("Camera C2 sees you in the Dock Corridor on turn 12, on the way out.");
    // The same answer the engine gives when the plan's actions are played.
    const run = createRun(placed.level);
    let state = run;
    for (const action of checked.actions) {
      const r = act(state, action);
      if (!r.ok) break;
      state = r.run;
      if (state.alarmEvents.length > 0) break;
    }
    expect(state.alarmEvents[0]).toMatchObject({ turn: 12, cause: { kind: "camera", id: "C2" } });
  });

  it("draws the plan's path from the dock to the files and back", () => {
    expect(checked.path[0]).toBe(F1_DEMO.dockEntry);
    expect(checked.path).toContain(F1_DEMO.objective);
    expect(checked.path[checked.path.length - 1]).toBe(F1_DEMO.dockEntry);
  });

  it("advises the placement's quiet route, with both waits, the second on the way out", () => {
    const advice = checked.advice!;
    expect(advice).not.toBeNull();
    expect(advice.waits.map((w) => [w.turn, w.nodeId, w.outbound])).toEqual([
      [1, F1_DEMO.freightLiftWait, false],
      [12, "dc-east", true],
    ]);
    expect(advice.waits[0].avoids).toEqual({ kind: "camera", by: "C2", turn: 1 });
    expect(advice.waits[1].avoids).toEqual({ kind: "camera", by: "C2", turn: 12 });
    expect(advice.waits[1].text).toBe(
      "On the way out, wait one turn in the Dock Corridor, turn 12. Skip it and camera C2 sees you on turn 12.",
    );
    expect(advice.summary).toBe("In by the loading dock, back out the same way: 17 turns, nobody sees you.");
  });
});

describe("the advised route, played end to end on F1 through the engine", () => {
  it("stays unseen through the records door to the files and out, on every seed", () => {
    for (const seed of SEEDS) {
      const p = place(seed);
      const advice = validatePlan(p, reply("dock-wait")).advice!;
      const run = play(createRun(p.level), advice.route);
      expect(run.alarmEvents, `seed ${seed}`).toEqual([]);
      expect(new Set(run.turns.map((t) => t.alarm)), `seed ${seed}`).toEqual(new Set(["calm"]));
      // Through the records door and onto the files.
      expect(run.turns.some((t) => t.player.kind === "take" && t.player.nodeId === F1_DEMO.objective), `seed ${seed}`).toBe(true);
      expect(run.locked, `seed ${seed}`).not.toContain(F1_DEMO.recordsDoor);
      expect(run.status, `seed ${seed}`).toBe("won");
      expect(advice.waits.filter((w) => w.outbound), `seed ${seed}`).toHaveLength(1);
    }
  });

  it("is what the crew's plan becomes once it waits where the advice says", () => {
    const followed: CrewPlan = {
      steps: [
        { zoneId: "dock-N", action: "Up from the loading dock on the freight lift" },
        { zoneId: "dock-N", action: "Wait one turn at the freight lift" },
        { zoneId: "objective", action: "Pick the records room door and take the files" },
        { zoneId: "dock-N", action: "Back out the way you came" },
      ],
      pushback: "",
      confidence: 0.8,
    };
    // Without the second wait the plan is seen; the advice's route is not.
    expect(validatePlan(placed, followed).outcome).toBe("seen");
    expect(play(createRun(placed.level), adviceFor(placed)!.route).status).toBe("won");
  });
});

describe("validatePlan on the other recorded replies", () => {
  it("warns that C2 sees a plan that walks straight in, on turn 1", () => {
    for (const id of ["dock", "default", "quiet"]) {
      const checked = validatePlan(placed, reply(id));
      expect(checked.warnings[0], id).toMatchObject({ kind: "camera", by: "C2", turn: 1, outbound: false });
      expect(checked.warnings[0].text, id).toBe("Camera C2 sees you in the Dock Corridor on turn 1.");
    }
  });

  it("drops zones that are not on the floor, and notes each one", () => {
    const checked = validatePlan(placed, reply("lobby"));
    expect(checked.dropped.map((d) => [d.number, d.zoneId])).toEqual([
      [1, "lobby-S"],
      [3, "lobby-S"],
    ]);
    expect(checked.dropped[0].reason).toBe('"lobby-S" is not a zone on this floor');
    expect(checked.steps.map((s) => s.zoneId)).toEqual(["objective"]);
    expect(checked.advice).not.toBeNull();
  });

  it("drops a zone the model made up", () => {
    const plan: CrewPlan = {
      steps: [
        { zoneId: "dock-N", action: "In" },
        { zoneId: "freight-vault", action: "Crack the vault" },
        { zoneId: "objective", action: "Take the files" },
      ],
      pushback: "",
      confidence: 0.5,
    };
    const checked = validatePlan(placed, plan);
    expect(checked.dropped).toEqual([
      { number: 2, zoneId: "freight-vault", action: "Crack the vault", reason: '"freight-vault" is not a zone on this floor' },
    ]);
    expect(checked.steps.map((s) => s.number)).toEqual([1, 3]);
  });

  it("names the guard or camera a roof plan runs into", () => {
    const checked = validatePlan(placed, reply("roof"));
    expect(checked.outcome).toBe("seen");
    expect(checked.warnings[0].by).toMatch(/^(G|C)\d$/);
    expect(checked.warnings[0].text).toMatch(/^(Camera|Guard) [GC]\d (sees|hears) you in the .+ on turn \d+/);
  });

  it("says when a plan never leaves with the files", () => {
    const plan: CrewPlan = { steps: [{ zoneId: "dock-N", action: "Wait one turn" }], pushback: "", confidence: 0.5 };
    const checked = validatePlan(placed, plan);
    expect(checked.outcome).toBe("unfinished");
    expect(checked.warnings[0].text).toBe("The plan never takes the files: it ends in the Freight Lift Lobby.");
  });

  it("finds a plan that already follows the quiet route clean, and gives no advice", () => {
    const plan: CrewPlan = {
      steps: [
        { zoneId: "dock-N", action: "Wait one turn at the freight lift" },
        { zoneId: "objective", action: "Take the files, then wait one turn at the door" },
        { zoneId: "dock-N", action: "Out the way you came" },
      ],
      pushback: "",
      confidence: 0.9,
    };
    // The second wait happens in the records room, a turn before dc-east: the same timing for C2.
    const checked = validatePlan(placed, plan);
    expect(checked.warnings).toEqual([]);
    expect(checked.outcome).toBe("clean");
    expect(checked.advice).toBeNull();
    expect(play(createRun(placed.level), checked.actions).status).toBe("won");
  });
});

describe("waitTurns", () => {
  it("reads the turns a step waits", () => {
    expect(waitTurns("Wait one turn at the freight lift")).toBe(1);
    expect(waitTurns("wait for the 02:00 round to pass")).toBe(1);
    expect(waitTurns("Hold two turns in office 2210")).toBe(2);
    expect(waitTurns("Wait 3 turns")).toBe(3);
    expect(waitTurns("Pick the records room door and take the files")).toBe(0);
  });
});
