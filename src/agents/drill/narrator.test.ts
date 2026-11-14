// The drill narrator's one call: the recordings match the simulation, a
// recording answers only its own facts, the recorded flag, the live path on a
// scripted model, and what the prompt and the route may carry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { ScriptedChatModel } from "@/adapters/llm";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { drillFacts, simulateDrill, type DrillFacts, type DrillFloorChoice } from "@/drill";
import { POST } from "../../app/api/drill/narrative/route";
import {
  loadDrillRecording,
  matchNarrative,
  narrateDrill,
  NarratorUnavailableError,
  NARRATOR_PROMPT_HEAD,
  narratorMessages,
  narratorSystemPrompt,
} from "./index";

const F1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
const FLOOR = FIXTURE_FLOORS.F1;

function factsFor(floor: DrillFloorChoice): DrillFacts {
  const report = simulateDrill(F1, FLOOR, { floor });
  const baseline = simulateDrill(F1, FLOOR, { floor, blockedStair: null });
  return drillFacts(report, baseline, FLOOR);
}

describe("the recorded narratives", () => {
  it("are recorded for exactly what the simulation gives on floor 22 (the default) and floor 21 (the busiest)", async () => {
    const recording = (await loadDrillRecording("F1"))!;
    expect(matchNarrative(recording, factsFor("staged"))?.id).toBe("floor-22-staged");
    expect(matchNarrative(recording, factsFor("busiest"))?.id).toBe("floor-21-busiest");
  });

  it("state the facts' numbers, and the blocked stair by its name", async () => {
    const recording = (await loadDrillRecording("F1"))!;
    for (const { id, facts, narrative } of recording.narratives) {
      const text = [narrative.scenario, ...narrative.recommendations].join(" ");
      expect(narrative.scenario, id).toContain(`${facts.headcount} people`);
      expect(narrative.scenario, id).toContain(`${facts.timeToClearS} s, ${facts.timeToClearS - facts.baselineS} s longer`);
      expect(narrative.scenario, id).toContain(facts.blockedStair!);
      for (const stair of facts.openStairs) expect(narrative.scenario, id).toContain(stair);
      for (const zone of facts.zones) expect(narrative.scenario, id).toMatch(new RegExp(`${zone.occupants} in (the )?${zone.label}`));
      // Every door it names is a warden post's door.
      const doors = new Set(facts.wardenPosts.map((p) => p.doorId));
      for (const door of text.match(/\bd-[a-z0-9-]+/g) ?? []) expect(doors.has(door), `${id}: ${door}`).toBe(true);
      // The last zone out is the one the first recommendation names, at its time.
      const last = [...facts.zones].sort((a, b) => (b.clearedAtS ?? 0) - (a.clearedAtS ?? 0))[0];
      expect(narrative.recommendations[0], id).toContain(last.label);
      expect(narrative.recommendations[0], id).toContain(`${last.occupants} people`);
      expect(narrative.recommendations[0], id).toContain(`at ${last.clearedAtS} s`);
      expect(text, id).toContain(facts.bottleneck!.label);
      expect(text, id).not.toMatch(/!/);
    }
  });

  it("answer nothing when one fact differs", async () => {
    const recording = (await loadDrillRecording("F1"))!;
    expect(matchNarrative(recording, { ...factsFor("staged"), timeToClearS: 53 })).toBeNull();
    expect(matchNarrative(recording, { ...factsFor("staged"), blockedStair: "East Stair (Stair A)" })).toBeNull();
    expect(matchNarrative(recording, factsFor(8))).toBeNull();
  });
});

describe("the narrator's prompt", () => {
  it("carries the facts and nothing of the floor's geometry", () => {
    const text = JSON.stringify(narratorMessages(factsFor("busiest")));
    expect(text).toContain(NARRATOR_PROMPT_HEAD);
    const nodeIds = FLOOR.nodes.map((n) => n.id);
    for (const id of nodeIds) expect(text, id).not.toMatch(new RegExp(`\\b${id}\\b`));
    for (const word of ['\\"x\\"', '\\"y\\"', '\\"edges\\"', '\\"rect\\"', '\\"nodes\\"']) expect(text).not.toContain(word);
  });

  it("says where the queue stands and what unit its total is in", () => {
    const prompt = narratorSystemPrompt();
    expect(prompt).toMatch(/get into or along/);
    expect(prompt).toMatch(/never say\s+they queue or wait "in" it/);
    expect(prompt).toMatch(/call\s+it person-seconds, never seconds/);
    expect(prompt).not.toMatch(/"waitS"/);
  });
});

describe("narrateDrill", () => {
  beforeEach(() => {
    vi.stubEnv("HEIST_MODE", "fake");
    vi.stubEnv("LLM_MODE", "fake");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers with the recorded narrative in fake mode, and says it is recorded", async () => {
    const answer = await narrateDrill(factsFor("staged"));
    expect(answer).toMatchObject({ recorded: true, reason: "fake mode", recording: "floor-22-staged" });
    expect(answer.narrative.recommendations).toHaveLength(3);
  });

  it("refuses to answer, in fake mode, a drill nothing was recorded for", async () => {
    await expect(narrateDrill(factsFor(8))).rejects.toThrow(/no recorded narrative/);
  });

  it("live, uses the model's answer and marks it not recorded", async () => {
    const narrative = { scenario: "Floor 22 holds 6 people.", recommendations: ["One.", "Two.", "Three."] };
    const model = new ScriptedChatModel({
      script: {
        id: "drill-live",
        agents: [
          {
            agent: "drill",
            systemIncludes: NARRATOR_PROMPT_HEAD,
            turns: [{ toolCalls: [{ name: "drill_narrative", args: narrative }] }],
          },
        ],
      },
    });
    const answer = await narrateDrill(factsFor("staged"), {
      selection: { model, mode: "live", provider: "anthropic", reason: "test" },
    });
    expect(answer).toEqual({ narrative, recorded: false });
  });

  it("live, falls back to the recorded narrative when the model fails", async () => {
    const model = new ScriptedChatModel({ script: { id: "empty", agents: [{ agent: "other", systemIncludes: "nobody", turns: [{ content: "" }] }] } });
    const answer = await narrateDrill(factsFor("busiest"), {
      selection: { model, mode: "live", provider: "anthropic", reason: "test" },
    });
    expect(answer).toMatchObject({ recorded: true, reason: "error", recording: "floor-21-busiest" });
  });

  it("live, reports the model's failure, not 'nothing recorded', when no recording can stand in", async () => {
    const model = new ScriptedChatModel({ script: { id: "empty", agents: [{ agent: "other", systemIncludes: "nobody", turns: [{ content: "" }] }] } });
    const failed = narrateDrill(factsFor(8), { selection: { model, mode: "live", provider: "anthropic", reason: "test" } });
    await expect(failed).rejects.toBeInstanceOf(NarratorUnavailableError);
    await expect(failed).rejects.toThrow(/the model did not answer/);
  });

  it("live, with a setting that refuses every live call, answers with the recording as for a failed call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("HEIST_MODE", "live");
    vi.stubEnv("LLM_MODE", "live");
    vi.stubEnv("LLM_PROVIDER", "openai");
    const answer = await narrateDrill(factsFor("staged"));
    expect(answer).toMatchObject({ recorded: true, reason: "error", recording: "floor-22-staged" });
    await expect(narrateDrill(factsFor(8))).rejects.toBeInstanceOf(NarratorUnavailableError);
    warn.mockRestore();
  });
});

describe("POST /api/drill/narrative", () => {
  beforeEach(() => {
    vi.stubEnv("HEIST_MODE", "fake");
    vi.stubEnv("LLM_MODE", "fake");
  });
  afterEach(() => vi.unstubAllEnvs());

  const post = (body: unknown) =>
    POST(
      new Request("http://localhost/api/drill/narrative", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  it("answers the default drill with the recorded narrative and the recorded flag", async () => {
    const response = await post({ facts: factsFor("staged") });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { recorded: boolean; narrative: { scenario: string } };
    expect(body.recorded).toBe(true);
    expect(body.narrative.scenario).toContain("West Stair (Stair B)");
  });

  it("refuses a bad body or anything beyond the facts, and answers 404 for an unrecorded drill", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    const facts = factsFor("staged");
    expect((await post({ facts: { ...facts, nodes: FLOOR.nodes } })).status).toBe(400);
    expect((await post({ facts: { ...facts, zones: [{ ...facts.zones[0], x: 1 }] } })).status).toBe(400);
    expect((await post({ facts: factsFor(8) })).status).toBe(404);
  });
});
