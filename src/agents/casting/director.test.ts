// The Casting Director on deepagents, keyless: the deep agent's graph, todos,
// subagent dispatch and tools all run for real against the fake adapters;
// only the model's turns are recorded (fixtures/llm/scripts/casting-*.json).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFakeCoStar } from "@/adapters/costar/fake";
import { createFakeVexcel } from "@/adapters/vexcel/fake";
import { loadScript, ScriptedChatModel } from "@/adapters/llm";
import type { ScriptInput } from "@/adapters/llm/scripted";
import { MISSIONS } from "@/agents/builder/missions";
import { CastingResult, type CastingTrace } from "@/domain";
import expected from "../../../fixtures/inventory-finalists.json";
import { CASTING_DIR, readCachedCasting, writeCachedCasting } from "./cache";
import { castMission, CastingError, type CastMission } from "./director";
import { DIRECTOR_PROMPT, SCOUT_PROMPT } from "./prompts";

const MISSION_IDS = MISSIONS.map((m) => m.id);

beforeAll(() => {
  vi.stubEnv("HEIST_MODE", "fake");
  vi.stubEnv("LLM_MODE", "fake");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A trace without its timings and recording time: what a rerun must reproduce. */
function untimed(result: CastingResult) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { recordedAt, ...trace } = result.trace;
  return {
    ...result,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    trace: { ...trace, events: trace.events.map(({ atMs, durationMs, ...e }) => e) },
  };
}

/** Every string anywhere in a JSON value. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("castMission on the recorded scripts, every mission", () => {
  const runs = new Map<string, { cast: CastMission; model: ScriptedChatModel }>();

  beforeAll(async () => {
    for (const id of MISSION_IDS) {
      const model = new ScriptedChatModel({ script: await loadScript(`casting-${id}`) });
      runs.set(id, { cast: await castMission(id, { model }), model });
    }
  }, 60_000);

  it("covers the five missions", () => {
    expect(MISSION_IDS).toEqual(Object.keys(expected));
  });

  it.each(MISSION_IDS)("%s: its finalists are inventory-finalists.json's three, best first, as a CastingResult", (id) => {
    const { cast } = runs.get(id)!;
    expect(() => CastingResult.parse(cast.result)).not.toThrow();
    expect(cast.result.finalists.map((c) => c.id)).toEqual((expected as Record<string, string[]>)[id]);
    expect(cast.result.source).toBe("fixture");
    expect(cast.fake).toBe(true);
  });

  it.each(MISSION_IDS)("%s: runs the director and the scout through every recorded turn", async (id) => {
    const { model } = runs.get(id)!;
    const script = await loadScript(`casting-${id}`);
    for (const entry of script.agents) {
      const turns = model.calls.filter((c) => c.agent === entry.agent).map((c) => c.turn);
      expect(turns, entry.agent).toEqual(entry.turns.map((_, i) => i));
    }
  });

  it.each(MISSION_IDS)("%s: the funnel is the search's, one row per filter after the whole inventory", (id) => {
    const { cast } = runs.get(id)!;
    const mission = MISSIONS.find((m) => m.id === id)!;
    expect(cast.result.funnel.map((s) => s.label)).toEqual(["61 buildings in the inventory", ...mission.casting.map((f) => f.label)]);
    expect(cast.result.funnel.at(-1)!.count).toBe(3);
    for (const c of cast.result.finalists) {
      expect(c.fit.map((f) => f.criterion)).toEqual(mission.casting.map((f) => f.label));
      expect(c.reason.length).toBeGreaterThan(20);
    }
  });

  it("traces todos, the scout's task and every tool call with its input and output", () => {
    const { trace } = runs.get("romaine-1974")!.cast.result;
    expect(trace.liveData).toBe(false);
    expect(trace.subagents).toEqual(["general-purpose", "location-scout"]);
    expect(trace.model).toBe("ScriptedChatModel (script casting-romaine-1974, no LLM)");
    const of = (kind: string) => trace.events.filter((e) => e.kind === kind);
    expect(of("todo").length).toBeGreaterThanOrEqual(3);
    expect(of("subagent")).toEqual([expect.objectContaining({ agent: "location-scout", status: "completed" })]);
    expect(of("subagent")[0].output).toMatch(/^Funnel: 61 in the inventory/);
    const tools = of("tool");
    expect(tools.filter((e) => e.label === "search_inventory")).toHaveLength(7);
    expect(tools.every((e) => e.status === "completed" && e.input && e.output && e.durationMs !== undefined)).toBe(true);
    const lastSearch = JSON.parse(tools.filter((e) => e.label === "search_inventory").at(-1)!.output!);
    expect(lastSearch.left).toBe(3);
    expect(tools.at(-1)).toMatchObject({ agent: "casting-director", label: "write_shortlist" });
  });

  describe("the cached shortlists in data/casting/", () => {
    it.each(MISSION_IDS)("%s is what a fake run writes today, timings aside (rerun npm run cast when this fails)", async (id) => {
      const cached = await readCachedCasting(id);
      expect(cached).not.toBeNull();
      expect(untimed(cached!)).toEqual(untimed(runs.get(id)!.cast.result));
    });
  });
});

describe("the deep agent's subagents", () => {
  it("offers the task tool exactly general-purpose and location-scout", async () => {
    const bound: unknown[][] = [];
    class Spy extends ScriptedChatModel {
      override async _generate(...args: Parameters<ScriptedChatModel["_generate"]>) {
        bound.push(args[1].tools ?? []);
        return super._generate(...args);
      }
    }
    const model = new Spy({ script: await loadScript("casting-romaine-1974") });
    await castMission("romaine-1974", { model });
    const task = bound
      .flat()
      .find((t) => (t as { name?: string }).name === "task") as { description: string } | undefined;
    expect(task).toBeDefined();
    const listed = [...task!.description.matchAll(/^- ([\w-]+):/gm)].map((m) => m[1]);
    expect(listed).toEqual(["general-purpose", "location-scout"]);
  });

  it("gives each agent a system prompt the scripts can tell apart", () => {
    const [director, scout] = [DIRECTOR_PROMPT, SCOUT_PROMPT].map((p) => p.split("\n")[0]);
    expect(SCOUT_PROMPT).not.toContain(director);
    expect(DIRECTOR_PROMPT).not.toContain(scout);
  });
});

describe("live data stays out of the trace (SPEC §4.5)", () => {
  const withheld = (trace: CastingTrace) => {
    expect(trace.liveData).toBe(true);
    for (const e of trace.events) {
      expect(e.input, e.label).toBeUndefined();
      expect(e.output, e.label).toBeUndefined();
      if (e.kind === "todo") expect(e.label).toMatch(/^Todo \d+$/);
      if (e.kind === "subagent") expect(e.label).toBe(`task ${e.agent}`);
    }
  };

  it("withholds payloads and model-written labels when Vexcel is live, and data/casting/ refuses the result", async () => {
    const model = new ScriptedChatModel({ script: await loadScript("casting-night-desk") });
    const cast = await castMission("night-desk", { model, vexcel: createFakeVexcel() });
    expect(cast.fake).toBe(false);
    withheld(cast.result.trace);
    expect(strings(cast.result.trace)).not.toContain(expect.stringContaining("Meridian"));
    await expect(writeCachedCasting(cast.result, CASTING_DIR)).rejects.toThrow(/never goes in data\/casting/);
    const dir = mkdtempSync(path.join(tmpdir(), "casting-"));
    try {
      await writeCachedCasting(cast.result, dir);
      expect(JSON.parse(readFileSync(path.join(dir, "night-desk.json"), "utf8")).trace.liveData).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("withholds them when the inventory search answers from live CoStar, and reads no record it cannot", async () => {
    const fake = createFakeCoStar();
    const costar = { searchInventory: async (filters: Parameters<typeof fake.searchInventory>[0]) => ({ ...(await fake.searchInventory(filters)), source: "costar" as const }) };
    const model = new ScriptedChatModel({ script: await loadScript("casting-romaine-1974") });
    const error = await castMission("romaine-1974", { model, costar, vexcelMode: "fake", vexcel: createFakeVexcel() }).catch((e) => e);
    expect(error).toBeInstanceOf(CastingError);
    withheld((error as CastingError).trace);
    const failed = (error as CastingError).trace.events.filter((e) => e.status === "failed").map((e) => e.label);
    expect(failed).toEqual(expect.arrayContaining(["get_candidate", "write_shortlist"]));
  });
});

describe("the director's guard rails", () => {
  const script = (turns: ScriptInput["agents"][number]["turns"]): ScriptInput => ({
    id: "guard-rails",
    agents: [{ agent: "casting-director", systemIncludes: DIRECTOR_PROMPT.split("\n")[0], turns }],
  });

  it("refuses write_shortlist before every filter is applied, and says so in the trace", async () => {
    const model = new ScriptedChatModel({
      script: script([
        {
          toolCalls: [
            {
              name: "write_shortlist",
              args: {
                missionId: "romaine-1974",
                finalists: [
                  { id: "F1", reason: "a" },
                  { id: "L01", reason: "b" },
                  { id: "L02", reason: "c" },
                ],
              },
            },
          ],
        },
        { content: "Stopping." },
      ]),
    });
    const error = await castMission("romaine-1974", { model }).catch((e) => e);
    expect(error).toBeInstanceOf(CastingError);
    expect(error.message).toMatch(/without writing a shortlist/);
    expect(error.trace.events).toEqual([expect.objectContaining({ label: "write_shortlist", status: "failed" })]);
    expect(error.trace.events[0].output).toMatch(/apply every casting filter first/);
  });

  it("refuses a tool call for another mission", async () => {
    const model = new ScriptedChatModel({
      script: script([{ toolCalls: [{ name: "get_mission", args: { missionId: "night-desk" } }] }, { content: "Stopping." }]),
    });
    const error = await castMission("romaine-1974", { model }).catch((e) => e);
    expect(error.trace.events[0]).toMatchObject({ label: "get_mission", status: "failed", output: "Error: this run casts romaine-1974, not night-desk" });
  });

  it("refuses a mission that is not in the library, and fails clearly with no recorded script", async () => {
    await expect(castMission("no-such-mission")).rejects.toThrow(/no mission "no-such-mission"/);
    const missions = [{ ...MISSIONS[0], id: "unscripted" }];
    await expect(castMission("unscripted", { missions })).rejects.toThrow(/no recorded casting script for unscripted/);
  });
});
