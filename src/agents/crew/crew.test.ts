// The crew's one call on the cached F1 level: keyword routing to the recorded
// replies, the recorded flag, the live path on a stubbed model, and what the
// prompt may carry (zone ids and fiction names only, SPEC §4.5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ScriptedChatModel } from "@/adapters/llm";
import { LevelManifest } from "@/domain";
import cached from "../../../data/levels/F1.json";
import { POST } from "../../app/api/crew/route";
import { briefCrew, CREW_PROMPT_HEAD, crewContext, crewMessages, loadCrewRecording, routeOrder } from "./index";

const DEMO_ORDER = "Go in through the dock, wait for the 2 am round to pass, take the records room";
const manifest = LevelManifest.parse(structuredClone(cached));

/** Every node id, room id and coordinate pair of the F1 floor. */
const floorTokens = () => {
  const f = FIXTURE_FLOORS.F1;
  return [...f.nodes.map((n) => n.id), ...f.rooms.map((r) => r.id)];
};

describe("routeOrder", () => {
  it("routes the demo order to the dock-and-wait reply, and others on their keywords", async () => {
    const recording = (await loadCrewRecording("F1"))!;
    expect(routeOrder(recording, DEMO_ORDER).id).toBe("dock-wait");
    expect(routeOrder(recording, "Straight in from the DOCK").id).toBe("dock");
    expect(routeOrder(recording, "Come down from the roof").id).toBe("roof");
    expect(routeOrder(recording, "Walk in through the lobby").id).toBe("lobby");
    expect(routeOrder(recording, "Up the garage ramp").id).toBe("garage");
    expect(routeOrder(recording, "Keep it quiet").id).toBe("quiet");
    expect(routeOrder(recording, "Wait, then go").id).toBe("dock-wait");
    expect(routeOrder(recording, "Get the files").id).toBe("default");
  });

  it("names only zones the manifest has, in every recorded reply", async () => {
    const recording = (await loadCrewRecording("F1"))!;
    const ids = new Set(crewContext(manifest).zones.map((z) => z.id));
    for (const reply of recording.replies) {
      for (const step of reply.plan.steps) expect(ids.has(step.zoneId), `${reply.id}: ${step.zoneId}`).toBe(true);
    }
  });

  it("has the crew say the route needs a second wait on the way out", async () => {
    const recording = (await loadCrewRecording("F1"))!;
    const pushback = routeOrder(recording, DEMO_ORDER).plan.pushback;
    expect(pushback).toMatch(/C2/);
    expect(pushback).toMatch(/coming out/i);
    expect(pushback).toMatch(/wait one more turn/i);
  });
});

describe("the crew's prompt", () => {
  it("carries the manifest's zone ids and names, the guard roster and the alarm, and nothing of the floor", () => {
    const context = crewContext(manifest);
    expect(Object.keys(context).sort()).toEqual(["alarm", "buildingId", "guards", "mission", "objective", "zones"]);
    expect(context.guards).toEqual(["G1", "G2", "G3", "G4"]);
    for (const zone of context.zones) expect(Object.keys(zone).sort()).toEqual(["id", "name"]);
    expect(context.zones.map((z) => z.id)).toContain("objective");
    expect(context.zones.map((z) => z.id)).toContain("dock-N");

    const text = JSON.stringify(crewMessages(context, DEMO_ORDER));
    expect(text).toContain(CREW_PROMPT_HEAD);
    for (const token of floorTokens()) expect(text, token).not.toMatch(new RegExp(`\\b${token}\\b`));
    for (const word of ["sightline", "adjacen", "edges", '"x"', '"y"']) expect(text).not.toContain(word);
  });
});

describe("briefCrew", () => {
  beforeEach(() => {
    vi.stubEnv("HEIST_MODE", "fake");
    vi.stubEnv("LLM_MODE", "fake");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers the demo order with the recorded reply in fake mode, and says it is recorded", async () => {
    const answer = (await briefCrew("F1", DEMO_ORDER))!;
    expect(answer).toMatchObject({ recorded: true, reason: "fake mode", recording: "dock-wait" });
    expect(answer.plan.steps.map((s) => s.zoneId)).toEqual(["dock-N", "dock-N", "objective", "dock-N"]);
  });

  it("is null for a building with no cached level, and refuses an empty or overlong order", async () => {
    expect(await briefCrew("F9", DEMO_ORDER)).toBeNull();
    await expect(briefCrew("F1", "   ")).rejects.toThrow(/empty/);
    await expect(briefCrew("F1", "x".repeat(401))).rejects.toThrow(/longer than 400/);
  });

  it("live, uses the model's answer and marks it not recorded", async () => {
    const plan = { steps: [{ zoneId: "roof", action: "Down from the roof" }], pushback: "Long way.", confidence: 0.4 };
    const model = new ScriptedChatModel({
      script: {
        id: "crew-live",
        agents: [
          {
            agent: "crew",
            systemIncludes: CREW_PROMPT_HEAD,
            turns: [{ toolCalls: [{ name: "crew_plan", args: plan }] }],
          },
        ],
      },
    });
    const answer = (await briefCrew("F1", DEMO_ORDER, {
      selection: { model, mode: "live", provider: "anthropic", reason: "test" },
    }))!;
    expect(answer).toEqual({ plan, recorded: false });
  });

  it("live, falls back to the recorded reply when the model fails", async () => {
    const model = new ScriptedChatModel({ script: { id: "empty", agents: [{ agent: "other", systemIncludes: "nobody", turns: [{ content: "" }] }] } });
    const answer = (await briefCrew("F1", DEMO_ORDER, {
      selection: { model, mode: "live", provider: "anthropic", reason: "test" },
    }))!;
    expect(answer).toMatchObject({ recorded: true, reason: "error", recording: "dock-wait" });
  });
});

describe("POST /api/crew", () => {
  const post = (body: unknown) =>
    POST(new Request("http://localhost/api/crew", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("answers the demo order with numbered steps and the recorded flag", async () => {
    const response = await post({ buildingId: "F1", order: DEMO_ORDER });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plan: { steps: unknown[] }; recorded: boolean };
    expect(body.recorded).toBe(true);
    expect(body.plan.steps).toHaveLength(4);
  });

  it("refuses a bad body, and answers 404 for a building with no level", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ buildingId: "F1" })).status).toBe(400);
    expect((await post({ buildingId: "F1", order: "" })).status).toBe(400);
    expect((await post({ buildingId: "F9", order: DEMO_ORDER })).status).toBe(404);
  });
});
