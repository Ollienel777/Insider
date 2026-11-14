// The Level Builder on deepagents, keyless: the deep agent's graph, todos,
// subagent dispatch and tools all run for real against the fake adapters;
// only the model's turns are recorded (fixtures/llm/scripts/builder-F1-romaine-1974.json).
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SUBAGENT_PROMPT } from "deepagents";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFakeCoStar } from "@/adapters/costar/fake";
import { loadScript, ScriptedChatModel } from "@/adapters/llm";
import type { ScriptInput } from "@/adapters/llm/scripted";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { createFakeVexcel } from "@/adapters/vexcel/fake";
import { BuildTrace, LevelManifest, type Provenance } from "@/domain";
import { buildLevel, type BuiltLevel, LevelBuildError } from "./builder";
import { defaultMissionId, MISSIONS } from "./missions";
import { BUILDER_PROMPT, DATA_ANALYST_PROMPT, GAME_MASTER_PROMPT } from "./prompts";
import { analystTools, builderTools, type BuildRun, gameMasterTools } from "./tools";

const root = process.cwd();

/** The fake adapters, logging each call the tools make. */
function spiedAdapters() {
  const log: string[] = [];
  const costar = createFakeCoStar();
  const vexcel = createFakeVexcel();
  return {
    log,
    costar: {
      listBuildings: costar.listBuildings,
      getBuilding: (id: string) => (log.push(`costar.getBuilding:${id}`), costar.getBuilding(id)),
      getAvailableSpace: (id: string) => (log.push(`costar.getAvailableSpace:${id}`), costar.getAvailableSpace(id)),
    },
    vexcel: { getAerial: (id: string) => (log.push(`vexcel.getAerial:${id}`), vexcel.getAerial(id)) },
  };
}

/** Every string anywhere in a JSON value. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

beforeAll(() => {
  vi.stubEnv("HEIST_MODE", "fake");
  vi.stubEnv("LLM_MODE", "fake");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildLevel(F1) on the recorded script", () => {
  let built: BuiltLevel;
  let model: ScriptedChatModel;
  let adapters: ReturnType<typeof spiedAdapters>;

  beforeAll(async () => {
    model = new ScriptedChatModel({ script: await loadScript("builder-F1-romaine-1974") });
    adapters = spiedAdapters();
    built = await buildLevel("F1", "romaine-1974", {
      model,
      costar: adapters.costar,
      vexcel: adapters.vexcel,
      dataModes: { costar: "fake", vexcel: "fake" },
    });
  });

  it("runs the deep agent and its two subagents through every recorded turn", () => {
    const turns = (agent: string) => model.calls.filter((c) => c.agent === agent).map((c) => c.turn);
    expect(turns("level-builder")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(turns("data-analyst")).toEqual([0, 1, 2]);
    expect(turns("game-master")).toEqual([0, 1]);
    expect(built.summary).toMatch(/^Level built for F1: analog era, 4 guards/);
  });

  it("whose tools really read the fake CoStar and Vexcel adapters", () => {
    expect(adapters.log).toEqual(
      expect.arrayContaining([
        "costar.getBuilding:F1",
        "costar.getAvailableSpace:F1",
        "vexcel.getAerial:F1",
      ]),
    );
    // derive_security_profile and write_manifest read the record again themselves.
    expect(adapters.log.filter((c) => c === "costar.getBuilding:F1").length).toBeGreaterThanOrEqual(3);
  });

  it("writes a manifest that validates as a LevelManifest, from the rules table's numbers", () => {
    expect(LevelManifest.safeParse(built.manifest).success).toBe(true);
    expect(built.manifest.buildingId).toBe("F1");
    expect(built.manifest.securityProfile).toEqual({
      era: "analog",
      guardCount: 4,
      patrolTempo: 1,
      cameraKind: "analog-sweep",
      cameraCount: 2,
      lockKind: "key",
    });
    expect(built.manifest.zones.map((z) => z.role)).toEqual([
      ...Array(9).fill("quiet"),
      "crowded",
      "secure",
      "objective",
    ]);
    expect(built.manifest.entries.map((e) => e.id)).toEqual(["dock-N", "roof", "garage-E", "lobby-S", "exit-W"]);
    expect(built.manifest.mission.id).toBe("romaine-1974");
    expect(built.manifest.mission.briefing).toMatch(/Floor 22/);
  });

  it("has provenance for the era, the guard count, each zone and each entry, naming layer, field, value and rule", () => {
    const { provenance } = built.manifest;
    const forRole = (role: string): Provenance => {
      const found = provenance.find((p) => p.elementRole === role);
      expect(found, role).toBeDefined();
      return found!;
    };
    expect(forRole("profile:era")).toMatchObject({ layer: "costar", field: "yearBuilt", value: 1974 });
    expect(forRole("profile:era").rule).toMatch(/Analog era/);
    expect(forRole("profile:guardCount")).toMatchObject({ layer: "costar", field: "buildingClass", value: "A" });
    for (const zone of built.manifest.zones) forRole(`zone:${zone.id}`);
    for (const entry of built.manifest.entries) {
      expect(forRole(`entry:${entry.id}`)).toMatchObject({ layer: "vexcel", field: "entries.kind", value: entry.kind });
    }
    for (const p of provenance) {
      expect(p.field, p.elementRole).not.toBe("");
      expect(p.rule, p.elementRole).not.toBe("");
    }
  });

  it("holds no Matterport-derived data: zone roles, never node or room ids", () => {
    expect(new Set(built.manifest.provenance.map((p) => p.layer as string))).not.toContain("matterport");
    const floor = FIXTURE_FLOORS.F1;
    const scanIds = new Set([...floor.nodes.map((n) => n.id), ...floor.rooms.map((r) => r.id)]);
    expect(strings(built.manifest).filter((s) => scanIds.has(s))).toEqual([]);
    expect(JSON.stringify(built.manifest)).not.toMatch(/"(nodes|edges|sightlines|roomId|x|y)":/);
  });

  it("traces a todo list, two subagent tasks and at least five tool calls, with timings", () => {
    const { events } = built.trace;
    expect(BuildTrace.safeParse(built.trace).success).toBe(true);

    const todos = events.filter((e) => e.kind === "todo");
    expect(todos.length).toBeGreaterThanOrEqual(3);
    expect(todos.filter((t) => t.status === "completed").map((t) => t.label)).toContain("Write the level manifest");

    const tasks = events.filter((e) => e.kind === "subagent");
    expect(tasks.map((t) => t.agent)).toEqual(["data-analyst", "game-master"]);
    expect(tasks.every((t) => t.status === "completed" && typeof t.durationMs === "number")).toBe(true);

    const tools = events.filter((e) => e.kind === "tool");
    expect(tools.length).toBeGreaterThanOrEqual(5);
    expect(tools.map((t) => `${t.agent}/${t.label}`)).toEqual([
      "data-analyst/get_building",
      "data-analyst/get_available_space",
      "data-analyst/get_aerial_entries",
      "data-analyst/derive_security_profile",
      "game-master/get_mission",
      "level-builder/write_manifest",
    ]);
    expect(tools.every((t) => t.status === "completed" && typeof t.durationMs === "number")).toBe(true);

    // Each task and tool keeps what went in and what came back (#79).
    const getBuilding = tools.find((t) => t.label === "get_building")!;
    expect(JSON.parse(getBuilding.input!)).toEqual({ buildingId: "F1" });
    expect(getBuilding.output).toContain('"name": "Halvorsen Tower"');
    expect(tasks[0].input).toBe(tasks[0].label);
    expect(tasks[0].output).toMatch(/^Built 1974/);

    // In start order, and each subagent's tools inside its own task.
    const at = events.map((e) => e.atMs);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(built.trace.model).toBe("scripted");
    expect(built.trace.recordedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});

describe("the builder takes the chosen mission as input (#119)", () => {
  const run = (): BuildRun => ({
    buildingId: "F1",
    missionId: "romaine-1974",
    costar: createFakeCoStar(),
    vexcel: createFakeVexcel(),
  });
  const tool = <T extends { name: string }>(tools: T[], name: string): T => tools.find((t) => t.name === name)!;
  const words = (n: number) => Array.from({ length: n }, () => "dark").join(" ");

  it("is given the mission in its task, and the game master reads it with get_mission, not the library", async () => {
    const model = new ScriptedChatModel({ script: await loadScript("builder-F1-romaine-1974") });
    const built = await buildLevel("F1", "romaine-1974", { model });
    expect(built.manifest.missionId).toBe("romaine-1974");
    expect(built.manifest.mission.id).toBe("romaine-1974");
    const getMission = built.trace.events.find((e) => e.label === "get_mission")!;
    expect(JSON.parse(getMission.input!)).toEqual({ missionId: "romaine-1974" });
    // The building is already cast: the reply carries the mission, not its casting needs.
    expect(JSON.parse(getMission.output!)).toMatchObject({ id: "romaine-1974", title: "The Romaine Street Papers" });
    expect(getMission.output).not.toContain("casting");
    expect(built.trace.events.some((e) => e.label === "list_missions")).toBe(false);
  }, 30_000);

  it("get_mission and write_manifest refuse any mission but the run's", async () => {
    const r = run();
    const getMission = tool(gameMasterTools(r), "get_mission");
    expect(JSON.parse(await getMission.invoke({ missionId: "romaine-1974" }))).toMatchObject({ id: "romaine-1974" });
    await expect(getMission.invoke({ missionId: "sunset-1986" })).rejects.toThrow(
      "this run builds mission romaine-1974, not sunset-1986",
    );
    await tool(analystTools(r), "derive_security_profile").invoke({ buildingId: "F1" });
    const write = tool(builderTools(r), "write_manifest");
    const args = { buildingId: "F1", briefing: "In by the dock. The security is game fiction.", objective: { name: "R", rule: "Take" } };
    r.gameMasterAnswer = `Mission: romaine-1974. Briefing: ${args.briefing}`;
    await expect(write.invoke({ ...args, missionId: "sunset-1986" })).rejects.toThrow("not sunset-1986");
    await write.invoke({ ...args, missionId: "romaine-1974" });
    expect(r.manifest?.missionId).toBe("romaine-1974");
  });

  it("write_manifest counts the briefing's words and requires the game-fiction line, so the agent must retry", async () => {
    const r = run();
    await tool(analystTools(r), "derive_security_profile").invoke({ buildingId: "F1" });
    const write = tool(builderTools(r), "write_manifest");
    const args = { buildingId: "F1", missionId: "romaine-1974", objective: { name: "R", rule: "Take" } };
    // Each briefing is the game master's own, so only the rule under test refuses it.
    r.gameMasterAnswer = [`${words(118)} It is game fiction.`, "In by the dock, out by the roof.", `${words(116)} It is game fiction.`].join("\n");
    await expect(write.invoke({ ...args, briefing: `${words(118)} It is game fiction.` })).rejects.toThrow(
      "the briefing is 122 words; the limit is 120. Send it back to the game-master",
    );
    await expect(write.invoke({ ...args, briefing: "In by the dock, out by the roof." })).rejects.toThrow(
      'the briefing must say its security is game fiction',
    );
    expect(r.manifest).toBeUndefined();
    await write.invoke({ ...args, briefing: `${words(116)} It is game fiction.` });
    expect(r.manifest?.mission.briefing).toMatch(/game fiction\.$/);
  });

  it("write_manifest refuses a briefing that is not the game master's word for word", async () => {
    const r = run();
    await tool(analystTools(r), "derive_security_profile").invoke({ buildingId: "F1" });
    r.gameMasterAnswer = "Mission: romaine-1974. Briefing: In by the dock,   out by the roof. The security is game fiction.";
    const write = tool(builderTools(r), "write_manifest");
    const args = { buildingId: "F1", missionId: "romaine-1974", objective: { name: "R", rule: "Take" } };
    await expect(write.invoke({ ...args, briefing: "In by the dock. The security is game fiction." })).rejects.toThrow(
      "the briefing is not the game master's word for word",
    );
    await write.invoke({ ...args, briefing: "In by the dock, out by the roof. The security is game fiction." });
    expect(r.manifest).toBeDefined();
  });

  it("write_manifest refuses a briefing when no game-master answer was captured, rather than pass it", async () => {
    const r = run();
    await tool(analystTools(r), "derive_security_profile").invoke({ buildingId: "F1" });
    const write = tool(builderTools(r), "write_manifest");
    await expect(
      write.invoke({
        buildingId: "F1",
        missionId: "romaine-1974",
        briefing: "In by the dock. The security is game fiction.",
        objective: { name: "R", rule: "Take" },
      }),
    ).rejects.toThrow("no game-master answer to check the briefing against");
    expect(r.manifest).toBeUndefined();
  });

  it("refuses, in a full build, a written briefing that differs from what the game master answered", async () => {
    // The recorded script, with the builder's write_manifest briefing changed:
    // only the answer kept by keepAnswer can tell the two apart.
    const script = structuredClone(await loadScript("builder-F1-romaine-1974"));
    const call = script.agents.flatMap((a) => a.turns.flatMap((t) => t.toolCalls)).find((c) => c.name === "write_manifest")!;
    call.args.briefing = "In by the dock, out by the roof. The security is game fiction.";
    const error = (await buildLevel("F1", "romaine-1974", { model: new ScriptedChatModel({ script }) }).catch(
      (e: unknown) => e,
    )) as LevelBuildError;
    expect(error).toBeInstanceOf(LevelBuildError);
    const failed = error.trace.events.find((e) => e.kind === "tool" && e.label === "write_manifest");
    expect(failed).toMatchObject({ status: "failed" });
    expect(String(failed?.output)).toContain("the briefing is not the game master's word for word");
  }, 30_000);

  it("copies the game master's briefing into write_manifest verbatim on the recorded script", async () => {
    const script = await loadScript("builder-F1-romaine-1974");
    const gm = script.agents.find((a) => a.agent === "game-master")!.turns.at(-1)!.content;
    const written = script.agents
      .flatMap((a) => a.turns.flatMap((t) => t.toolCalls))
      .find((c) => c.name === "write_manifest")!.args.briefing as string;
    expect(gm.endsWith(`Briefing: ${written}`)).toBe(true);
  });

  it("tells the builder to copy the briefing verbatim and the game master that the length is counted", () => {
    expect(BUILDER_PROMPT).toMatch(/briefing copied verbatim/);
    expect(BUILDER_PROMPT).toMatch(/Never shorten,\s+reword or drop a line/);
    expect(GAME_MASTER_PROMPT).toMatch(/Call get_mission/);
    expect(GAME_MASTER_PROMPT).toMatch(/at most\s+120 words/);
    expect(GAME_MASTER_PROMPT).toMatch(/Do not report a word count: write_manifest counts the words/);
    expect(GAME_MASTER_PROMPT).not.toMatch(/list_missions/);
  });

  it("with no mission named, builds a building's own mission: the one that casts it first", () => {
    expect(defaultMissionId("F1")).toBe("romaine-1974");
    expect(defaultMissionId("F2")).toBe("sunset-1986");
    expect(defaultMissionId("F3")).toBe("night-desk");
    expect(defaultMissionId("F4")).toBe("paper-trail-2001");
    expect(defaultMissionId("L01")).toBeNull();
  });
});

// F1 is the demo building; F2 and F3 are the other LA pins a judge can pick (#39).
describe.each([
  ["F1", "romaine-1974"],
  ["F2", "sunset-1986"],
  ["F3", "night-desk"],
])("the cached %s × %s level in data/levels/", (id, missionId) => {
  const read = (file: string): unknown => JSON.parse(readFileSync(path.join(root, "data", "levels", file), "utf8"));

  it(`is what the builder writes today (rerun npm run build:levels -- ${id}:${missionId} when this fails)`, async () => {
    const fresh = await buildLevel(id, missionId);
    expect(read(`${id}.${missionId}.json`)).toEqual(fresh.manifest);
    expect(fresh.trace.model).toBe(`scripted (builder-${id}-${missionId}), no LLM ran`);
  });

  it("has a trace with a todo list, both subagents and five tool calls", () => {
    const trace = BuildTrace.parse(read(`${id}.${missionId}.trace.json`));
    expect(trace.buildingId).toBe(id);
    expect(trace.events.some((e) => e.kind === "todo")).toBe(true);
    expect(trace.events.filter((e) => e.kind === "subagent").map((e) => e.agent)).toEqual([
      "data-analyst",
      "game-master",
    ]);
    expect(trace.events.filter((e) => e.kind === "tool").length).toBeGreaterThanOrEqual(5);
  });

  it("wrote the manifest on the first try: one write_manifest call, and it succeeded", () => {
    const trace = BuildTrace.parse(read(`${id}.${missionId}.trace.json`));
    const writes = trace.events.filter((e) => e.kind === "tool" && e.label === "write_manifest");
    expect(writes.map((e) => e.status)).toEqual(["completed"]);
  });
});

describe("the builder's guard rails", () => {
  const builder = (turns: ScriptInput["agents"][number]["turns"]): ScriptInput => ({
    id: "guard-rails",
    agents: [{ agent: "level-builder", systemIncludes: BUILDER_PROMPT.split("\n")[0], turns }],
  });

  it("refuses write_manifest before the security profile is derived, and says so in the trace", async () => {
    const model = new ScriptedChatModel({
      script: builder([
        {
          toolCalls: [
            {
              name: "write_manifest",
              args: { buildingId: "F1", missionId: "romaine-1974", briefing: "Go.", objective: { name: "R", rule: "Take" } },
            },
          ],
        },
        { content: "Giving up." },
      ]),
    });
    const error = await buildLevel("F1", "romaine-1974", { model }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LevelBuildError);
    expect((error as Error).message).toBe("the Level Builder finished without writing a manifest for F1 (romaine-1974)");
    // The failure went back to the model as an error result, not a crash,
    // and the trace says which call failed.
    expect(model.calls.map((c) => c.turn)).toEqual([0, 1]);
    expect((error as LevelBuildError).trace.events).toEqual([
      expect.objectContaining({ kind: "tool", label: "write_manifest", status: "failed" }),
    ]);
  });

  it("refuses a tool call for another building", async () => {
    const model = new ScriptedChatModel({
      script: builder([
        {
          toolCalls: [
            {
              name: "write_manifest",
              args: { buildingId: "F2", missionId: "romaine-1974", briefing: "Go.", objective: { name: "R", rule: "Take" } },
            },
          ],
        },
        { content: "Giving up." },
      ]),
    });
    const error = (await buildLevel("F1", "romaine-1974", { model }).catch((e: unknown) => e)) as LevelBuildError;
    expect(error.trace.events.map((e) => e.status)).toEqual(["failed"]);
  });

  // deepagents' own subagent, under the prompt it ships with (R1-M2).
  const generalPurpose = (turns: ScriptInput["agents"][number]["turns"]): ScriptInput["agents"][number] => ({
    agent: "general-purpose",
    systemIncludes: DEFAULT_SUBAGENT_PROMPT,
    turns,
  });
  const dispatchGeneralPurpose = {
    toolCalls: [{ name: "task", args: { subagent_type: "general-purpose", description: "Look around F1." } }],
  };

  it("shows a dispatch to deepagents' general-purpose subagent, and its tool calls, under its name", async () => {
    const script = builder([dispatchGeneralPurpose, { content: "Giving up." }]);
    script.agents.push(
      generalPurpose([
        { toolCalls: [{ name: "write_manifest", args: { buildingId: "F1", missionId: "romaine-1974", briefing: "Go.", objective: { name: "R", rule: "Take" } } }] },
        { content: "Could not write it." },
      ]),
    );
    const error = (await buildLevel("F1", "romaine-1974", { model: new ScriptedChatModel({ script }) }).catch((e: unknown) => e)) as LevelBuildError;
    expect(error.trace.events).toEqual([
      expect.objectContaining({ kind: "subagent", agent: "general-purpose", status: "completed", output: "Could not write it." }),
      expect.objectContaining({ kind: "tool", agent: "general-purpose", label: "write_manifest", status: "failed" }),
    ]);
  });

  it("records a subagent whose run fails as a failed subagent run, not a tool error (R1-M1)", async () => {
    const script = builder([dispatchGeneralPurpose, { content: "Giving up." }]);
    // Its one turn calls a tool it does not have, so the subagent's run throws.
    script.agents.push(generalPurpose([{ toolCalls: [{ name: "no_such_tool", args: {} }] }]));
    const error = (await buildLevel("F1", "romaine-1974", { model: new ScriptedChatModel({ script }) }).catch((e: unknown) => e)) as LevelBuildError;
    expect(error.trace.events).toEqual([
      expect.objectContaining({ kind: "subagent", agent: "general-purpose", status: "failed" }),
    ]);
    expect(error.trace.events[0].output).toMatch(/^Error: the general-purpose subagent's run failed: /);
  });

  it("keeps live adapters' data out of the trace: no input or output on any event (SPEC §4.5, M1)", async () => {
    const adapters = spiedAdapters();
    // The same fixture data, but passed with no modes, so treated as live.
    const live = await buildLevel("F1", "romaine-1974", {
      model: new ScriptedChatModel({ script: await loadScript("builder-F1-romaine-1974") }),
      costar: adapters.costar,
      vexcel: adapters.vexcel,
    });
    expect(live.trace.liveData).toBe(true);
    expect(live.trace.events.filter((e) => e.kind === "tool")).toHaveLength(6);
    // The model's turns and the tools' results name the building, its year
    // and its street; nothing anywhere in the trace may (round 2).
    const serialized = JSON.stringify(live.trace);
    for (const derived of ["Halvorsen", "1974", "Bunker Hill", "floor 22", "2202"]) {
      expect(serialized).not.toContain(derived);
    }
    expect(strings(live.trace).filter((s) => /Halvorsen|1974/.test(s))).toEqual([]);
    expect(live.trace.events.filter((e) => e.kind === "todo").map((e) => e.label)).toContain("Step 1 of 3");
    expect(live.trace.events.filter((e) => e.kind === "subagent").map((e) => e.label)).toEqual([
      "Run data-analyst",
      "Run game-master",
    ]);
    for (const event of live.trace.events) {
      expect(event).not.toHaveProperty("input");
      expect(event).not.toHaveProperty("output");
    }
    const vexcelLive = await buildLevel("F1", "romaine-1974", {
      model: new ScriptedChatModel({ script: await loadScript("builder-F1-romaine-1974") }),
      costar: adapters.costar,
      vexcel: adapters.vexcel,
      dataModes: { costar: "fake", vexcel: "live" },
    });
    expect(vexcelLive.trace.liveData).toBe(true);
    expect(vexcelLive.trace.events.some((e) => e.input !== undefined || e.output !== undefined)).toBe(false);
  });

  it("offers general-purpose to the task tool exactly once, beside the two subagents, and lists all three in the trace (R1-M2)", async () => {
    /** Keeps each call's bound tools. */
    class Watching extends ScriptedChatModel {
      readonly bound: unknown[][] = [];
      override async _generate(...args: Parameters<ScriptedChatModel["_generate"]>) {
        this.bound.push(args[1].tools ?? []);
        return super._generate(...args);
      }
    }
    const model = new Watching({ script: await loadScript("builder-F1-romaine-1974") });
    const { trace } = await buildLevel("F1", "romaine-1974", { model });
    const task = (model.bound[0] as { name?: string; function?: { name?: string; description?: string }; description?: string }[])
      .map((t) => t.function ?? t)
      .find((t) => t.name === "task")!;
    const listed = [...task.description!.matchAll(/^- ([a-z-]+): /gm)].map((m) => m[1]);
    expect(listed).toEqual(["general-purpose", "data-analyst", "game-master"]);
    expect(trace.subagents).toEqual(["general-purpose", "data-analyst", "game-master"]);
  });

  it("fails clearly in fake mode when a building has no recorded script", async () => {
    await expect(buildLevel("F5", "syntactic-2019")).rejects.toThrow("no recorded builder script for F5 and syntactic-2019");
    // A script is per building and mission: F1's does not build F1 for another mission.
    await expect(buildLevel("F1", "night-desk")).rejects.toThrow("no recorded builder script for F1 and night-desk");
  });

  it("gives each agent a system prompt the script can tell apart", () => {
    const firsts = [BUILDER_PROMPT, DATA_ANALYST_PROMPT, GAME_MASTER_PROMPT].map((p) => p.split("\n")[0]);
    for (const line of firsts) {
      expect([BUILDER_PROMPT, DATA_ANALYST_PROMPT, GAME_MASTER_PROMPT].filter((p) => p.includes(line))).toHaveLength(1);
    }
  });
});

describe("the mission library", () => {
  it("carries romaine-1974 with its Inspired by event, date and source URL", () => {
    const romaine = MISSIONS.find((m) => m.id === "romaine-1974");
    expect(romaine).toMatchObject({
      city: "LA",
      type: "heist",
      title: "The Romaine Street Papers",
      inspiredBy: {
        event: expect.stringContaining("Summa Corporation burglary"),
        date: "June 5, 1974",
        sourceUrl: "https://www.cia.gov/stories/story/the-exposing-of-project-azorian",
      },
    });
  });
});
