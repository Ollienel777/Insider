// First person's own cards beside Live mode's HUD (#134, the #119 review's
// R1-N2): with the HUD around the view, the alarm, the turn and the objective
// show once, in the HUD, not again in the view. Rendered to markup only: the
// renderer starts in an effect, which a static render never runs.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { createRun } from "@/engine";
import { placeLevel } from "@/level/placer";
import f1 from "../../../../data/levels/F1.romaine-1974.json";
import { RUN_SEED } from "../run-screen";
import FirstPersonView from "./first-person-view";

const placed = placeLevel(LevelManifest.parse(structuredClone(f1)), structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const view = (hudAround?: boolean) =>
  renderToStaticMarkup(
    <FirstPersonView placed={placed} run={createRun(placed.level)} objective="Take the files" onAct={() => {}} onUnavailable={() => {}} hudAround={hudAround} />,
  );

describe("first person's alarm and objective cards", () => {
  it("show on their own, with no HUD around the view", () => {
    const html = view();
    expect(html).toContain('data-testid="fp-alarm"');
    expect(html).toContain('data-testid="fp-objective"');
    expect(html).toContain("Take the files");
  });

  it("are left out when Live mode's HUD already shows them", () => {
    const html = view(true);
    expect(html).not.toContain('data-testid="fp-alarm"');
    expect(html).not.toContain('data-testid="fp-objective"');
    // What only the view says stays: the hint at the foot of the view.
    expect(html).toContain('data-testid="fp-hint"');
  });
});
