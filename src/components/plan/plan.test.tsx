// The Plan screen's parts on the cached F1 level, placed as the Run screen
// places it: the request the browser sends, the crew's reply, and the ghost
// path on the board.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { BoardView } from "@/components/run/board-view";
import { RUN_SEED } from "@/components/run/run-screen";
import { CrewPlan, LevelManifest } from "@/domain";
import { createRun } from "@/engine";
import { placeLevel } from "@/level/placer";
import { validatePlan } from "@/level/validate-plan";
import cached from "../../../data/levels/F1.romaine-1974.json";
import recording from "../../../fixtures/llm/crew-F1.json";
import { fallbackPlan } from "@/level/fallback-plan";
import { getStatus, resetStatus } from "@/lib/demo-status";
import { askCrew, askCrewOrBoard, crewRequest, EXAMPLE_ORDER, NoCrewReplyError, type CrewAnswer } from "./crew-request";
import { boardPlanTitle, CrewReply, ghostOf } from "./crew-reply";
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

  it("says when the crew has no reply to give at all, so the Plan screen can work one out (issue 140)", async () => {
    const none = (async () =>
      Response.json({ error: 'no recorded crew replies for "247386"', code: "no-recording" }, { status: 503 })) as unknown as typeof fetch;
    await expect(askCrew(crewRequest("247386", "Go"), { fetch: none })).rejects.toBeInstanceOf(NoCrewReplyError);
    const broken = (async () => Response.json({ error: "the crew could not answer" }, { status: 500 })) as unknown as typeof fetch;
    await expect(askCrew(crewRequest("F1", "Go"), { fetch: broken })).rejects.not.toBeInstanceOf(NoCrewReplyError);
  });

  it("treats a 503 that isn't the crew's own no-recording answer as an outage, not as no reply", async () => {
    // A proxy or the host: no JSON body, or a body without the crew's code.
    const proxy = (async () => new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(askCrew(crewRequest("247386", "Go"), { fetch: proxy })).rejects.not.toBeInstanceOf(NoCrewReplyError);
    const other = (async () => Response.json({ error: "overloaded" }, { status: 503 })) as unknown as typeof fetch;
    await expect(askCrew(crewRequest("247386", "Go"), { fetch: other })).rejects.not.toBeInstanceOf(NoCrewReplyError);
  });
});

describe("the Plan screen's brief on a building with no recording (issue 140)", () => {
  afterEach(() => resetStatus());
  const noRecording = (reason?: string) =>
    (async () =>
      Response.json(
        {
          error: 'no recorded crew replies for "247386"',
          code: "no-recording",
          ...(reason && { reason }),
          ...(reason === "timeout" && { fallback: { service: "llm", id: "llm-test-1", message: "The model didn't answer in time, so the crew's plan is worked out from the board." } }),
        },
        { status: 503 },
      )) as unknown as typeof fetch;

  it("works the plan out from the board, marked with why the model gave none, and the demo status hears of the timeout", async () => {
    const answer = await askCrewOrBoard(crewRequest("247386", "Go in quietly"), placed, { fetch: noRecording("timeout") });
    expect(answer).toEqual({ plan: fallbackPlan(placed), recorded: false, source: "board", reason: "timeout" });
    expect(getStatus().toasts.map((t) => t.id)).toEqual(["llm-test-1"]);
    expect(getStatus().fellBack.has("llm")).toBe(true);
  });

  it("with the model off, the board plan says so and nothing is toasted", async () => {
    const answer = await askCrewOrBoard(crewRequest("247386", "Go"), placed, { fetch: noRecording("fake mode") });
    expect(answer).toMatchObject({ source: "board", reason: "fake mode" });
    expect(getStatus().toasts).toEqual([]);
  });

  it("passes a reply through, and throws on an outage or with no board to work on", async () => {
    const reply = (async () => Response.json(recorded("dock-wait"))) as unknown as typeof fetch;
    expect(await askCrewOrBoard(crewRequest("F1", "Go"), placed, { fetch: reply })).toEqual(recorded("dock-wait"));
    const proxy = (async () => new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(askCrewOrBoard(crewRequest("247386", "Go"), placed, { fetch: proxy })).rejects.not.toBeInstanceOf(NoCrewReplyError);
    await expect(askCrewOrBoard(crewRequest("247386", "Go"), null, { fetch: noRecording("timeout") })).rejects.toBeInstanceOf(NoCrewReplyError);
  });
});

describe("CrewReply", () => {
  it("labels a plan worked out on the board, and not as recorded (issue 140)", () => {
    const board = fallbackPlan(placed);
    const html = renderToStaticMarkup(<CrewReply answer={{ plan: board, recorded: false, source: "board" }} checked={validatePlan(placed, board)} />);
    expect(html).toContain('data-testid="board-plan-chip"');
    expect(html).toContain("Worked out on the board");
    expect(html).not.toContain('data-testid="recorded-chip"');
    expect(html.match(/data-testid="crew-step"/g)).toHaveLength(3);
  });

  it("says on the board chip why the model gave no reply: only with the model off was none called", () => {
    const board = fallbackPlan(placed);
    const chip = (reason?: CrewAnswer["reason"]) =>
      renderToStaticMarkup(<CrewReply answer={{ plan: board, recorded: false, source: "board", ...(reason && { reason }) }} checked={validatePlan(placed, board)} />);
    expect(chip("timeout")).toContain("The model didn&#x27;t answer within the time limit.");
    expect(chip("timeout")).not.toContain("No model was called");
    expect(chip("error")).toContain("The model call failed.");
    expect(chip("fake mode")).toContain("Fake mode: no model was called.");
    for (const reason of [undefined, "timeout", "error", "fake mode", "configuration"] as const) {
      expect(boardPlanTitle(reason)).toContain("no recorded crew reply to stand in");
    }
  });

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
      <PlanScreen building={{ id: "F1", name: "Halvorsen Tower" }} manifest={manifest} heistMode="fake" source="fixture" />,
    );
    expect(html).toContain('data-testid="board-skeleton"');
    expect(html).toContain('placeholder="Tell the crew how you want to play it"');
    expect(html).toMatch(/href="\/b\/F1\/run"[^>]*>Start the run</);
  });

  it("says a building with no level has no board", () => {
    const html = renderToStaticMarkup(<PlanScreen building={{ id: "F2", name: "Figueroa Exchange" }} manifest={null} source="fixture" />);
    expect(html).toContain("This building&#x27;s level isn&#x27;t ready yet.");
  });
});
