// The Plan screen's parts on the cached F1 level, placed as the Run screen
// places it: the request the browser sends, the crew's reply, and the ghost
// path on the board.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { BoardView } from "@/components/run/board-view";
import { RUN_SEED } from "@/components/run/run-screen";
import { CrewPlan, LevelManifest } from "@/domain";
import { createRun } from "@/engine";
import { placeLevel } from "@/level/placer";
import { validatePlan } from "@/level/validate-plan";
import cached from "../../../data/levels/F1.romaine-1974.json";
import recording from "../../../fixtures/llm/crew-F1.json";
import { askCrew, crewRequest, EXAMPLE_ORDER, type CrewAnswer } from "./crew-request";
import { CrewReply, ghostOf } from "./crew-reply";
import { PlanScreen } from "./plan-screen";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const plan = (id: string) => CrewPlan.parse(recording.replies.find((r) => r.id === id)!.plan);
const recorded = (id: string): CrewAnswer => ({ plan: plan(id), recorded: true, reason: "fake mode", recording: id });

describe("the crew request", () => {
  it("carries the building id and the order, and no node, coordinate or adjacency", async () => {
    let sent: { url: string; body: string } | null = null;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      sent = { url, body: String(init?.body) };
      return Response.json(recorded("dock-wait"));
    }) as unknown as typeof fetch;
    const answer = await askCrew(crewRequest("F1", `  ${EXAMPLE_ORDER} `), { fetch: fakeFetch });
    expect(answer.recorded).toBe(true);

    expect(sent!.url).toBe("/api/crew");
    const body = JSON.parse(sent!.body) as Record<string, unknown>;
    expect(body).toEqual({ buildingId: "F1", order: EXAMPLE_ORDER });
    const floor = FIXTURE_FLOORS.F1;
    for (const id of [...floor.nodes.map((n) => n.id), ...floor.rooms.map((r) => r.id)]) {
      expect(sent!.body, id).not.toMatch(new RegExp(`\\b${id}\\b`));
    }
    for (const word of ['"x"', '"y"', "edges", "adjacen", "sightline", "nodes"]) expect(sent!.body).not.toContain(word);
  });

  it("throws with the server's message on a failure", async () => {
    const failing = (async () => Response.json({ error: "no recorded crew replies" }, { status: 503 })) as unknown as typeof fetch;
    await expect(askCrew(crewRequest("F2", "Go"), { fetch: failing })).rejects.toThrow("no recorded crew replies");
  });
});

describe("CrewReply", () => {
  it("shows the demo reply's numbered steps, the recorded chip, the C2 warning and both advised waits", () => {
    const html = renderToStaticMarkup(
      <CrewReply answer={recorded("dock-wait")} checked={validatePlan(placed, plan("dock-wait"))} />,
    );
    expect(html.match(/data-testid="crew-step"/g)).toHaveLength(4);
    expect(html).toContain('data-testid="recorded-chip"');
    expect(html).toContain("Fake mode: no model was called. This is a recorded crew reply.");
    expect(html).toMatch(/data-testid="plan-warning" data-by="C2" data-turn="12"/);
    expect(html).toContain("Camera C2 sees you in the Dock Corridor on turn 12, on the way out.");
    expect(html.match(/data-testid="advice-wait"/g)).toHaveLength(2);
    expect(html).toContain("On the way out, wait one turn in the Dock Corridor, turn 12.");
    expect(html).toContain("wait one more turn at the records door");
  });

  it("shows no recorded chip on a live answer", () => {
    const html = renderToStaticMarkup(
      <CrewReply answer={{ plan: plan("dock-wait"), recorded: false }} checked={validatePlan(placed, plan("dock-wait"))} />,
    );
    expect(html).not.toContain("recorded-chip");
  });

  it("notes each dropped step", () => {
    const html = renderToStaticMarkup(<CrewReply answer={recorded("lobby")} checked={validatePlan(placed, plan("lobby"))} />);
    expect(html).toContain("Dropped step 3: &quot;lobby-S&quot; is not a zone on this floor.");
    expect(html.match(/data-dropped="true"/g)).toHaveLength(1);
  });
});

describe("the ghost path", () => {
  it("draws the plan in the accent at 50% over the board at reduced emphasis, with C2's sighting marked", () => {
    const checked = validatePlan(placed, plan("dock-wait"));
    const html = renderToStaticMarkup(
      <BoardView placed={placed} run={createRun(placed.level)} choices={[]} onChoose={() => {}} reduced ghost={ghostOf(checked)} testId="plan-board" />,
    );
    const path = /<polyline data-testid="ghost-path" data-nodes="([^"]+)"[^>]*>/.exec(html);
    expect(path).not.toBeNull();
    expect(path![1]).toBe(checked.path.join(" "));
    expect(path![0]).toContain('stroke-opacity="0.5"');
    expect(path![0]).toContain("stroke:var(--accent)");
    expect(html).toContain('data-testid="board-base" opacity="0.55"');
    expect(html).toMatch(/data-testid="ghost-sighting" data-node="dc-mid"/);
    expect(html).toContain("C2 · T12");
    expect(html.match(/data-testid="ghost-wait"/g)).toHaveLength(2);
  });

  it("draws nothing over the run board", () => {
    const html = renderToStaticMarkup(<BoardView placed={placed} run={createRun(placed.level)} choices={[]} onChoose={() => {}} />);
    expect(html).not.toContain("ghost-plan");
    expect(html).toContain('data-testid="run-board"');
  });
});

describe("PlanScreen", () => {
  it("renders the board skeleton, the order box and Start the run before the floor loads", () => {
    const html = renderToStaticMarkup(
      <PlanScreen building={{ id: "F1", name: "Halvorsen Tower" }} manifest={manifest} heistMode="fake" />,
    );
    expect(html).toContain('data-testid="board-skeleton"');
    expect(html).toContain('placeholder="Tell the crew how you want to play it"');
    expect(html).toMatch(/href="\/b\/F1\/run"[^>]*>Start the run</);
  });

  it("says a building with no level has no board", () => {
    const html = renderToStaticMarkup(<PlanScreen building={{ id: "F2", name: "Figueroa Exchange" }} manifest={null} />);
    expect(html).toContain("This building&#x27;s level isn&#x27;t ready yet.");
  });
});
