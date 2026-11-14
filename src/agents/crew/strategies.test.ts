// The crew's strategies call (#126): the recorded answer keyless, the clamp to
// the manifest's ids, the live path on a stubbed model, the prompt's limits
// (SPEC §4.5) and the route's input discipline.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ScriptedChatModel } from "@/adapters/llm";
import { LevelManifest, type Strategy } from "@/domain";
import cached from "../../../data/levels/F1.json";
import { POST } from "../../app/api/crew/strategies/route";
import {
  clampStrategies,
  crewContext,
  loadStrategyRecording,
  proposeStrategies,
  STRATEGIES_PROMPT_HEAD,
  strategiesMessages,
} from "./index";

const manifest = LevelManifest.parse(structuredClone(cached));

const strategy = (over: Partial<Strategy> = {}): Strategy => ({
  id: "dock",
  name: "Dock",
  entryId: "dock-N",
  exitId: "dock-N",
  timing: "immediate",
  route: "shortest",
  via: [],
  risk: "medium",
  rationale: "Short and covered by one camera.",
  ...over,
});

const liveSelection = (strategies: Strategy[]) => ({
  model: new ScriptedChatModel({
    script: {
      id: "strategies-live",
      agents: [
        {
          agent: "crew",
          systemIncludes: STRATEGIES_PROMPT_HEAD,
          turns: [{ toolCalls: [{ name: "crew_strategies", args: { strategies } }] }],
        },
      ],
    },
  }),
  mode: "live" as const,
  provider: "anthropic" as const,
  reason: "test",
});

beforeEach(() => {
  vi.stubEnv("HEIST_MODE", "fake");
  vi.stubEnv("LLM_MODE", "fake");
});
afterEach(() => vi.unstubAllEnvs());

describe("clampStrategies", () => {
  it("keeps strategies that name only the manifest's entries and zones", () => {
    const ok = [strategy(), strategy({ id: "roof", entryId: "roof", exitId: "dock-N", via: ["quiet-2206", "objective"] })];
    expect(clampStrategies(manifest, ok)).toEqual({ strategies: ok, dropped: [] });
  });

  it("drops an unknown entry, exit or zone, and a repeated id, each with its reason", () => {
    const { strategies, dropped } = clampStrategies(manifest, [
      strategy(),
      strategy({ id: "window", entryId: "window-3" }),
      strategy({ id: "chute", exitId: "laundry-chute" }),
      strategy({ id: "vault", via: ["quiet-2202", "vault"] }),
      strategy({ id: "entry-as-zone", via: ["dock-N"] }),
      strategy({ name: "Dock again" }),
    ]);
    expect(strategies.map((s) => s.id)).toEqual(["dock"]);
    expect(dropped).toEqual([
      { strategyId: "window", reason: '"window-3" is not an entry of this level' },
      { strategyId: "chute", reason: '"laundry-chute" is not an entry of this level, so it cannot be the way out' },
      { strategyId: "vault", reason: '"vault" is not a zone of this level' },
      { strategyId: "entry-as-zone", reason: '"dock-N" is not a zone of this level' },
      { strategyId: "dock", reason: 'a strategy with id "dock" came earlier' },
    ]);
  });
});

describe("proposeStrategies", () => {
  it("answers with the five recorded strategies in fake mode, all legal, and says so", async () => {
    const answer = (await proposeStrategies("F1"))!;
    expect(answer).toMatchObject({ recorded: true, reason: "fake mode", dropped: [] });
    expect(answer.strategies).toHaveLength(5);
    const recording = (await loadStrategyRecording("F1"))!;
    expect(answer.strategies).toEqual(recording.strategies);
  });

  it("is null for a building with no cached level", async () => {
    expect(await proposeStrategies("F9")).toBeNull();
  });

  it("live, uses the model's strategies, drops an illegal one with the reason, and marks it not recorded", async () => {
    const legal = strategy({ id: "roof-run", entryId: "roof", exitId: "roof", risk: "high" });
    const illegal = strategy({ id: "sewer", entryId: "sewer-grate" });
    const answer = (await proposeStrategies("F1", { selection: liveSelection([legal, illegal]) }))!;
    expect(answer).toEqual({
      strategies: [legal],
      dropped: [{ strategyId: "sewer", reason: '"sewer-grate" is not an entry of this level' }],
      recorded: false,
    });
  });

  it("live, falls back to the recorded strategies when the answer fails the schema", async () => {
    const broken = [{ ...strategy(), risk: "reckless" }] as unknown as Strategy[];
    const answer = (await proposeStrategies("F1", { selection: liveSelection(broken) }))!;
    expect(answer).toMatchObject({ recorded: true, reason: "error" });
    expect(answer.strategies).toHaveLength(5);
  });

  it("prompts with zone ids and fiction names only, nothing of the floor", () => {
    const context = { ...crewContext(manifest), entries: manifest.entries.map((e) => e.id) };
    const text = JSON.stringify(strategiesMessages(context));
    expect(text).toContain(STRATEGIES_PROMPT_HEAD);
    expect(text).toContain("dock-N: Loading dock");
    expect(text).toContain("quiet-2206: Suite 2206 (vacant)");
    const f = FIXTURE_FLOORS.F1;
    for (const token of [...f.nodes.map((n) => n.id), ...f.rooms.map((r) => r.id)]) {
      expect(text, token).not.toMatch(new RegExp(`\\b${token}\\b`));
    }
    for (const word of ["sightline", "adjacen", "edges", '"x"', '"y"']) expect(text).not.toContain(word);
  });
});

describe("POST /api/crew/strategies", () => {
  const post = (body: unknown) =>
    POST(
      new Request("http://localhost/api/crew/strategies", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  it("answers with the strategies and the recorded flag, echoing a setup id", async () => {
    const response = await post({ buildingId: "F1", setupId: "demo-setup" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { strategies: unknown[]; dropped: unknown[]; recorded: boolean; setupId: string };
    expect(body).toMatchObject({ recorded: true, dropped: [], setupId: "demo-setup" });
    expect(body.strategies).toHaveLength(5);
  });

  it("takes only {buildingId, setupId?}: a floor, a bad id or a bad body is refused", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ buildingId: "../F1" })).status).toBe(400);
    expect((await post({ buildingId: "F1", setupId: 3 })).status).toBe(400);
    const floor = await post({ buildingId: "F1", floor: FIXTURE_FLOORS.F1 });
    expect(floor.status).toBe(400);
    expect(((await floor.json()) as { error: string }).error).toMatch(/not floor/);
    expect((await post({ buildingId: "F9" })).status).toBe(404);
  });
});
