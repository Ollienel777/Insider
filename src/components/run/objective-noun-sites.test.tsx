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

  it("names the noun in the posts' and the cleaners' rules on the Why card, the watch post's included", () => {
    // The watch post (#35) stands only when a later run watches an earlier way in: place one for each entry.
    const watched = here.entries.map((e) =>
      placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED, undefined, {
        watchEntry: e.entryId,
      }),
    );
    const rules = [here, ...watched].flatMap((level) => [
      ...level.guards.flatMap((g) => (g.post ? [g.post.rule] : [])),
      ...level.cleaners.map((c) => c.rule),
    ]);
    expect(rules.some((r) => r.startsWith("Posted on the nearest node to the dock"))).toBe(true);
    expect(rules.some((r) => r.startsWith("Posted near the way in"))).toBe(true);
    expect(here.cleaners.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toMatch(new RegExp(`\\bthe ${noun}$`));
      for (const other of others) expect(rule).not.toMatch(new RegExp(`\\b${other}\\b`));
    }
  });

  it("names the noun in the corridor cleaner's rule, when every suite room holds an available suite", () => {
    // The cached levels leave an occupied suite room on F2 and F3, so their cleaners walk a room.
    // Make every suite room available, as on F1's floor 22: the crowded zone has no room of its
    // own and its cleaner works a corridor (the placer's CLEANER_RULE.corridor).
    const m = LevelManifest.parse(structuredClone(cached));
    const quiet = m.zones.find((z) => z.role === "quiet")!;
    const occupied = here.zones.find((z) => z.role === "crowded")?.roomIds ?? [];
    for (const roomId of occupied) {
      const suite = /\d+/.exec(here.level.floor.rooms.find((r) => r.id === roomId)!.label)![0];
      m.zones.push({ ...structuredClone(quiet), id: `quiet-${suite}`, name: `Suite ${suite} (vacant)` });
    }
    const allAvailable = placeLevel(m, structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);
    const corridor = allAvailable.cleaners.filter((c) => /no room of its own/.test(c.rule));
    expect(corridor.length).toBeGreaterThan(0);
    for (const c of corridor) {
      expect(c.rule).toMatch(new RegExp(`\\bthe ${noun}$`));
      for (const other of others) expect(c.rule).not.toMatch(new RegExp(`\\b${other}\\b`));
    }
  });

  it("names the noun in the Plan screen's route warnings", () => {
    const entry = here.entries.find((e) => e.nodeId === here.level.start)!;
    const waits: CrewPlan = { steps: [{ zoneId: entry.entryId, action: "Wait one turn" }], pushback: "", confidence: 0.5 };
    const never = validatePlan(here, waits);
    expect(never.outcome).toBe("unfinished");
    expect(never.warnings[0].text).toMatch(new RegExp(`^The plan never takes the ${noun}: it ends in the .+\\.$`));
    // A plan that takes the objective and stops there. With no camera, guard or cleaner on
    // the board nothing sees it first, so the warning is the route's.
    const unwatched = { ...here, level: { ...here.level, cameras: [], guards: [], cleaners: [] } };
    const takes: CrewPlan = {
      steps: [
        { zoneId: entry.entryId, action: "In" },
        { zoneId: here.objective.zoneId, action: `Take the ${noun}` },
      ],
      pushback: "",
      confidence: 0.5,
    };
    const short = validatePlan(unwatched, takes);
    expect(short.outcome).toBe("unfinished");
    expect(short.warnings[0].text).toMatch(new RegExp(`^The plan ends in the .+ with the ${noun}, short of an exit\\.$`));
  });
});
