// The files taken and a door opened, said so the player cannot miss them (issue 188).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { exitPrompt } from "./fp/first-person-view";
import { onAir } from "./live-layout";
import { keepMoment, MOMENT_TURNS, momentOf, shownMoment, takeLine, wayOutGoal } from "./moment";
import { ObjectiveLine } from "./objective-line";
import { objectiveInfo, type PlayHud } from "./play-hud";
import { RadioLine } from "./radio-line";
import { RUN_SEED } from "./run-screen";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const { mission } = manifest;
const start = () => createRun(placed.level);

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(result.reason);
    return result.run;
  }, run);
}
const move = (to: string): Action => ({ kind: "move", to });
const wait: Action = { kind: "wait" };
const TO_THE_DOOR: readonly Action[] = [move("fl-lobby"), wait, move("dc-west"), move("dc-mid"), move("dc-east")];
const PICK: Action = { kind: "pick", doorId: "d-records-room" };

const atDoor = () => play(start(), [...TO_THE_DOOR, PICK]);
const opened = () => play(atDoor(), [PICK]);
const onFiles = () => play(opened(), [move("rr-door"), move("rr-files")]);
const carrying = () => play(onFiles(), [{ kind: "take" }]);

describe("the moment", () => {
  it("is the take, naming every way out, nearest first", () => {
    const before = onFiles();
    const after = carrying();
    expect(momentOf(placed, before, after)).toEqual({
      kind: "take",
      text: "You have the files. Get out by the loading dock or the roof hatch.",
    });
    expect(takeLine(placed, "fl-car")).toBe("You have the files. Get out by the loading dock or the roof hatch.");
  });

  it("is a door opening, naming the room it opens on", () => {
    const moment = momentOf(placed, atDoor(), opened());
    expect(moment).toMatchObject({ kind: "door", doorId: "d-records-room" });
    expect(moment?.text).toMatch(/^Door open: the .+\.$/);
  });

  /** `run` with `doorId` locked by the Chief, and the next turn's state with the lock cleared, as the alarm's fall to Calm does (engine alarm.ts). */
  function chiefLockClears(run: RunState, doorId: string, action: Action): [RunState, RunState] {
    const before: RunState = { ...run, locked: [...run.locked, doorId].sort(), chiefLocks: [doorId] };
    const played = play(before, [action]);
    return [before, { ...played, locked: played.locked.filter((d) => d !== doorId), chiefLocks: [] }];
  }

  it("is no door when the alarm's fall to Calm clears a Chief lock (review of issue 188)", () => {
    const [before, after] = chiefLockClears(play(start(), [move("fl-lobby")]), "d-server-closet", wait);
    expect(momentOf(placed, before, after)).toBeNull();
  });

  it("is no door when a Chief lock clears beside the player while they pick another door", () => {
    const [before, after] = chiefLockClears(play(start(), TO_THE_DOOR), "d-2210-north", PICK);
    expect(after.locked).toContain("d-records-room");
    expect(momentOf(placed, before, after)).toBeNull();
  });

  it("is still the door when the player's own pick opens it", () => {
    expect(momentOf(placed, atDoor(), opened())).toMatchObject({ kind: "door", doorId: "d-records-room" });
  });

  it("is nothing on a turn that took nothing and opened nothing, or once the run is over", () => {
    expect(momentOf(placed, start(), play(start(), [move("fl-lobby")]))).toBeNull();
    // A pick that leaves the door part-picked is not the door opening.
    expect(momentOf(placed, play(start(), TO_THE_DOOR), atDoor())).toBeNull();
    expect(momentOf(placed, onFiles(), { ...carrying(), status: "won" })).toBeNull();
  });

  it("lasts its turns, then goes; a new run drops it", () => {
    const before = onFiles();
    // One run: each `start()` makes a new board, which is a new run to the moment.
    let kept = keepMoment({ run: before, moment: null }, placed, play(before, [{ kind: "take" }]));
    expect(shownMoment(kept.moment, kept.run)?.kind).toBe("take");
    let run = kept.run!;
    for (let i = 1; i < MOMENT_TURNS; i++) {
      run = play(run, [wait]);
      kept = keepMoment(kept, placed, run);
      expect(shownMoment(kept.moment, run)?.kind).toBe("take");
    }
    run = play(run, [wait]);
    kept = keepMoment(kept, placed, run);
    expect(shownMoment(kept.moment, run)).toBeNull();
    // Two turns played between renders still show the door.
    const door = play(start(), TO_THE_DOOR);
    const skipped = keepMoment({ run: door, moment: null }, placed, play(door, [PICK, PICK]));
    expect(shownMoment(skipped.moment, skipped.run)?.kind).toBe("door");
    expect(keepMoment(skipped, placed, start()).moment).toBeNull();
  });
});

describe("carrying the files", () => {
  it("turns the objective line into the way out, with a chip that stays", () => {
    const info = objectiveInfo(placed, carrying(), mission.objective, mission.exitCondition);
    expect(info).toMatchObject({ label: "Way out", taken: "Carrying the files" });
    expect(info.goal).toBe("Out by the loading dock or the roof hatch. Reach either with the files and the run ends.");
    const out = renderToStaticMarkup(<ObjectiveLine label={info.label} goal={info.goal} hops={info.hops} taken={info.taken} />);
    expect(out).toMatch(/data-testid="objective-taken" data-carrying="true"/);
    expect(out).toContain("Carrying the files");
    expect(out).toContain("border-success");
    // Not before the take.
    expect(objectiveInfo(placed, onFiles(), mission.objective, mission.exitCondition).taken).toBeNull();
  });

  it("names one exit, or many, and says reaching one ends the run", () => {
    const one = { ...placed, level: { ...placed.level, exits: ["fl-car"] } };
    expect(wayOutGoal(one, "fl-car")).toBe("Out by the loading dock. Reach it with the files and the run ends.");
    expect(wayOutGoal({ ...placed, level: { ...placed.level, exits: [] } }, null)).toBe("Get out the way you came in.");
  });

  it("says, at an exit, that walking on to it ends the run", () => {
    expect(exitPrompt(placed, "fl-car", "files")).toBe("The way out: the loading dock. Walk on to it with the files to end the run.");
  });
});

describe("the radio line", () => {
  const hud = (radio: PlayHud["radio"], moment: PlayHud["moment"]): PlayHud => ({
    objective: objectiveInfo(placed, carrying(), mission.objective, mission.exitCondition),
    danger: { alarm: "calm", watchers: [] },
    radio,
    moment,
  });
  const take = { kind: "take", text: "You have the files. Get out by the loading dock or the roof hatch." } as const;

  it("carries the moment in the success colour, announced", () => {
    const line = onAir(hud({ kind: "step", text: "Out by the loading dock" }, take), { speaker: "G1", text: "Huh?", tone: "warning" });
    expect(line).toEqual({ speaker: "Crew", text: take.text, tone: "success", moment: "take" });
    const out = renderToStaticMarkup(<RadioLine line={line} />);
    expect(out).toMatch(/data-tone="success" data-moment="take"/);
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain(take.text);
  });

  it("gives way to a sighting, and is the radio's own line without a moment", () => {
    expect(onAir(hud({ kind: "sighting", text: "C2 sees you." }, take))?.tone).toBe("danger");
    expect(onAir(hud({ kind: "step", text: "Next" }, null))).toMatchObject({ tone: "next", text: "Next" });
  });
});
