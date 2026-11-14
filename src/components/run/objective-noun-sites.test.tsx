// The objective's noun (#70) where each screen shows it, on the cached F2 and
// F3 levels placed as the Run screen places them: every check here reads what
// the board, the status line, the outcome, the Why card's rules and the Plan
// screen's warnings actually say, and goes red if any of them reverts to "files".
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type CrewPlan } from "@/domain";
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import { quietRoute } from "@/level/quiet-route";
import { validatePlan } from "@/level/validate-plan";
import f1Cached from "../../../data/levels/F1.romaine-1974.json";
import f2Cached from "../../../data/levels/F2.sunset-1986.json";
import f3Cached from "../../../data/levels/F3.night-desk.json";
import { choices, describeTurn } from "./board";
import { BoardView, DISC, fixedLabels } from "./board-view";
import { project } from "./iso";
import { MARK_FONT, textBox } from "./labels";
import { Outcome, RUN_SEED } from "./run-screen";

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}

describe.each([
  { id: "F1", cached: f1Cached, noun: "files" },
  { id: "F2", cached: f2Cached, noun: "boxes" },
  { id: "F3", cached: f3Cached, noun: "prototype" },
])("the objective's noun on $id (#70)", ({ id, cached, noun }) => {
  const here = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);
  const label = noun.toUpperCase();
  const others = ["files", "boxes", "prototype"].filter((n) => n !== noun);

  it("draws the noun under the objective, and sizes its layout box for the word drawn", () => {
    const run = createRun(here.level);
    const html = renderToStaticMarkup(<BoardView placed={here} run={run} choices={choices(run)} onChoose={() => {}} />);
    expect(html).toContain(`>${label}<`);
    for (const other of others) expect(html).not.toContain(`>${other.toUpperCase()}<`);
    // fixedLabels sizes the objective's label first: its box is the drawn word's.
    const n = here.level.floor.nodes.find((node) => node.id === here.level.objective)!;
    const p = project(n.x, n.y);
    expect(fixedLabels(here, run.board.cameras).taken.text[0]).toEqual(
      textBox(p.x, p.y + DISC.ry + 14, label.length, MARK_FONT, "middle"),
    );
  });

  it("names the noun in the status line at the pickup and at the win, and in the outcome", () => {
    let run = createRun(here.level);
    let pickup: string | null = null;
    for (const action of quietRoute(here)!) {
      const after = play(run, [action]);
      if (!run.carrying && after.carrying) pickup = describeTurn(here, run, after);
      if (after.status === "won") expect(describeTurn(here, run, after)).toBe(`Out with the ${noun} in ${after.turn} turns.`);
      run = after;
    }
    expect(run.status).toBe("won");
    expect(pickup).toBe(`You have the ${noun}. Get out.`);
    expect(renderToStaticMarkup(<Outcome placed={here} run={run} />)).toContain(`Out with the ${noun}.`);
  });

  it("names the noun in the dock guard's and the cleaners' rules on the Why card", () => {
    const rules = [
      ...here.guards.flatMap((g) => (g.post ? [g.post.rule] : [])),
      ...here.cleaners.map((c) => c.rule),
    ];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toMatch(new RegExp(`\\bthe ${noun}$`));
      for (const other of others) expect(rule).not.toMatch(new RegExp(`\\b${other}\\b`));
    }
  });

  it("names the noun in the Plan screen's route warning", () => {
    const entry = here.entries.find((e) => e.nodeId === here.level.start)!;
    const plan: CrewPlan = { steps: [{ zoneId: entry.entryId, action: "Wait one turn" }], pushback: "", confidence: 0.5 };
    const checked = validatePlan(here, plan);
    expect(checked.outcome).toBe("unfinished");
    expect(checked.warnings[0].text).toMatch(new RegExp(`^The plan never takes the ${noun}: it ends in the .+\\.$`));
  });
});
