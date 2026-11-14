// The Casting Director on deepagents, keyless: the deep agent's graph, todos,
// subagent dispatch and tools all run for real against the fake adapters;
// only the model's turns are recorded (fixtures/llm/scripts/casting-*.json).
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SUBAGENT_PROMPT } from "deepagents";
import { createFakeCoStar, FIXTURE_INVENTORY } from "@/adapters/costar/fake";
import { passes } from "@/adapters/costar/search";
import { createFakeVexcel } from "@/adapters/vexcel/fake";
import { loadScript, ScriptedChatModel } from "@/adapters/llm";
import type { ScriptInput } from "@/adapters/llm/scripted";
import { MISSIONS } from "@/agents/builder/missions";
import { CastingResult, type CastingTrace } from "@/domain";
import expected from "../../../fixtures/inventory-finalists.json";
import { CASTING_DIR, readCachedCasting, writeCachedCasting } from "./cache";
import { castMission, CastingError, type CastMission } from "./director";
import { DIRECTOR_PROMPT, SCOUT_PROMPT } from "./prompts";
import { type CastRun, directorTools, scoutTools } from "./tools";

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

  it.each(MISSION_IDS)("%s: the scout's scripted answer quotes the funnel counts the search returned", async (id) => {
    const script = await loadScript(`casting-${id}`);
    const answer = script.agents.find((a) => a.agent === "location-scout")!.turns.at(-1)!.content;
    const funnel = /^Funnel: (.*?)\. Left:/.exec(answer)?.[1];
    expect(funnel, "the answer opens with the funnel").toBeDefined();
    const quoted = [...funnel!.matchAll(/(?:^|-> )(\d+)/g)].map((m) => Number(m[1]));
    expect(quoted).toEqual(runs.get(id)!.cast.result.funnel.map((s) => s.count));
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

  it("leaves general-purpose read-only: it can read the mission, never search or write the shortlist", async () => {
    const calls: { agent: string; tools: string[] }[] = [];
    class Spy extends ScriptedChatModel {
      override async _generate(...args: Parameters<ScriptedChatModel["_generate"]>) {
        const answer = await super._generate(...args);
        const tools = (args[1].tools ?? []).map((t) => (t as { name?: string }).name ?? "");
        calls.push({ agent: this.calls.at(-1)!.agent, tools });
        return answer;
      }
    }
    const model = new Spy({
      script: {
        id: "general-purpose",
        agents: [
          {
            agent: "casting-director",
            systemIncludes: DIRECTOR_PROMPT.split("\n")[0],
            turns: [
              { toolCalls: [{ name: "task", args: { subagent_type: "general-purpose", description: "Read romaine-1974." } }] },
              { content: "Stopping." },
            ],
          },
          { agent: "general-purpose", systemIncludes: DEFAULT_SUBAGENT_PROMPT, turns: [{ content: "Read it." }] },
        ],
      },
    });
    const error = await castMission("romaine-1974", { model }).catch((e) => e);
    expect(error).toBeInstanceOf(CastingError);
    const gp = calls.filter((c) => c.agent === "general-purpose");
    expect(gp).toHaveLength(1);
    expect(gp[0].tools).toContain("get_mission");
    for (const name of ["write_shortlist", "search_inventory", "get_candidate", "get_aerial_entries", "task"]) {
      expect(gp[0].tools, name).not.toContain(name);
    }
    expect(error.trace.events).toEqual([expect.objectContaining({ kind: "subagent", agent: "general-purpose", status: "completed" })]);
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
      symlinkSync(CASTING_DIR, path.join(dir, "linked"));
      await expect(writeCachedCasting(cast.result, path.join(dir, "linked"))).rejects.toThrow(/never goes in data\/casting/);
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

describe("write_shortlist's refusals", () => {
  const romaine = MISSIONS.find((m) => m.id === "romaine-1974")!;

  /** A run with `filters` of romaine-1974's casting applied through the scout's own tool. */
  async function applied(filters: number) {
    const mission = { ...structuredClone(romaine), casting: romaine.casting.slice(0, filters) };
    const run: CastRun = { mission, costar: createFakeCoStar(), vexcel: createFakeVexcel(), inventory: FIXTURE_INVENTORY, applied: [] };
    const search = scoutTools(run).find((t) => t.name === "search_inventory")!;
    for (const f of mission.casting) await search.invoke({ missionId: mission.id, filter: f.kind });
    const write = directorTools(run).find((t) => t.name === "write_shortlist")!;
    const shortlist = (ids: string[]) =>
      write.invoke({ missionId: mission.id, finalists: ids.map((id) => ({ id, reason: `${id} fits` })) });
    return { run, shortlist };
  }

  it("writes the three survivors, and refuses an id the funnel dropped or a duplicate", async () => {
    const { run, shortlist } = await applied(romaine.casting.length);
    await expect(shortlist(["F1", "L01", "F2"])).rejects.toThrow(/F2 is not among the candidates left/);
    await expect(shortlist(["F1", "L01", "L01"])).rejects.toThrow(/three different properties/);
    expect(run.shortlist).toBeUndefined();
    await shortlist(["F1", "L01", "L02"]);
    expect(run.shortlist?.finalists.map((c) => c.id)).toEqual(["F1", "L01", "L02"]);
  });

  it("refuses 2 or 4 finalists", async () => {
    const { run, shortlist } = await applied(romaine.casting.length);
    await expect(shortlist(["F1", "L01"])).rejects.toThrow();
    await expect(shortlist(["F1", "L01", "L02", "F2"])).rejects.toThrow();
    expect(run.shortlist).toBeUndefined();
  });

  it("refuses a survivor outside the last step's top five", async () => {
    // Four of romaine-1974's filters leave more than five properties.
    const { run, shortlist } = await applied(4);
    const step = run.search!.steps.at(-1)!;
    const top = step.top.map((c) => c.id);
    const survivors = FIXTURE_INVENTORY.filter((p) => run.applied.every((f) => passes(p, f))).map((p) => p.id);
    expect(survivors).toHaveLength(step.count);
    const outside = survivors.find((id) => !top.includes(id));
    expect(outside, "a survivor outside the top five").toBeDefined();
    await expect(shortlist([top[0], top[1], outside!])).rejects.toThrow(new RegExp(`${outside} is not among the candidates left`));
  });
});

describe("the scout's refusals", () => {
  const romaine = MISSIONS.find((m) => m.id === "romaine-1974")!;

  function scout() {
    const run: CastRun = { mission: romaine, costar: createFakeCoStar(), vexcel: createFakeVexcel(), inventory: FIXTURE_INVENTORY, applied: [] };
    const tools = scoutTools(run);
    const search = (filter: string) =>
      tools.find((t) => t.name === "search_inventory")!.invoke({ missionId: romaine.id, filter });
    const get = (id: string) => tools.find((t) => t.name === "get_candidate")!.invoke({ id });
    return { run, search, get };
  }

  it("reads only a candidate this run's search returned, though the inventory holds others", async () => {
    const { run, search, get } = scout();
    await search(romaine.casting[0].kind);
    const returned = new Set(run.search!.steps.flatMap((s) => s.top).map((c) => c.id));
    const other = FIXTURE_INVENTORY.find((p) => !returned.has(p.id));
    expect(other, "an inventory property the search did not return").toBeDefined();
    await expect(get(other!.id)).rejects.toThrow(new RegExp(`${other!.id} is not among the candidates search_inventory returned`));
    const first = [...returned][0];
    expect(JSON.parse(await get(first)).id).toBe(first);
  });

  it("refuses a filter already applied, and leaves the search as it was", async () => {
    const { run, search } = scout();
    const kind = romaine.casting[0].kind;
    await search(kind);
    const before = run.search;
    await expect(search(kind)).rejects.toThrow(new RegExp(`"${kind}" filter is already applied`));
    expect(run.applied.map((f) => f.kind)).toEqual([kind]);
    expect(run.search).toBe(before);
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
