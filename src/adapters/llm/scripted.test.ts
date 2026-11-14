// ScriptedChatModel under real LangChain and deepagents agents: the agents'
// graphs, todos, subagent dispatch and tools all run; only the model's turns
// are recorded.
import { tool } from "@langchain/core/tools";
import { createDeepAgent } from "deepagents";
import { createAgent, todoListMiddleware } from "langchain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadScript, Script, ScriptedChatModel, ScriptError } from "./scripted";

const ADD_SCRIPT = {
  id: "add",
  agents: [
    {
      agent: "calculator",
      systemIncludes: "You add numbers.",
      turns: [
        { content: "Adding.", toolCalls: [{ name: "add", args: { a: 2, b: 3 } }] },
        { content: "2 + 3 = 5." },
      ],
    },
  ],
};

function addTool(seen: unknown[]) {
  return tool(
    async ({ a, b }) => {
      seen.push({ a, b });
      return String(a + b);
    },
    { name: "add", description: "Add two numbers", schema: z.object({ a: z.number(), b: z.number() }) },
  );
}

describe("ScriptedChatModel in a LangChain agent", () => {
  it("replays a two-step script: the agent calls the tool, then finishes", async () => {
    const seen: unknown[] = [];
    const model = new ScriptedChatModel({ script: ADD_SCRIPT });
    const agent = createAgent({ model, tools: [addTool(seen)], systemPrompt: "You add numbers." });

    const result = await agent.invoke({ messages: [{ role: "user", content: "What is 2 + 3?" }] });

    expect(seen).toEqual([{ a: 2, b: 3 }]);
    const types = result.messages.map((m) => m.getType());
    expect(types).toEqual(["human", "ai", "tool", "ai"]);
    expect(result.messages[2].content).toBe("5");
    expect(result.messages.at(-1)?.content).toBe("2 + 3 = 5.");
    expect(model.calls).toEqual([
      { agent: "calculator", turn: 0, toolCalls: ["add"] },
      { agent: "calculator", turn: 1, toolCalls: [] },
    ]);
  });

  it("refuses a scripted call to a tool the agent did not bind", async () => {
    const model = new ScriptedChatModel({ script: ADD_SCRIPT });
    const agent = createAgent({ model, tools: [], systemPrompt: "You add numbers." });
    await expect(agent.invoke({ messages: [{ role: "user", content: "2 + 3?" }] })).rejects.toThrow(
      /calls "add", which is not bound/,
    );
  });

  it("names the agent and turn when the script runs out", async () => {
    const model = new ScriptedChatModel({ script: ADD_SCRIPT });
    const messages = [
      { role: "system", content: "You add numbers." },
      { role: "user", content: "2 + 3?" },
      { role: "assistant", content: "one" },
      { role: "assistant", content: "two" },
    ];
    await expect(model.invoke(messages)).rejects.toThrow('agent "calculator": no turn 2 (it has 2)');
  });

  it("refuses a call it cannot place, or one that matches two agents", async () => {
    const model = new ScriptedChatModel({
      script: {
        id: "twins",
        agents: [
          { agent: "a", systemIncludes: "twin", turns: [{ content: "a" }] },
          { agent: "b", systemIncludes: "twin", turns: [{ content: "b" }] },
        ],
      },
    });
    await expect(model.invoke([{ role: "system", content: "nobody" }, { role: "user", content: "x" }])).rejects.toThrow(
      ScriptError,
    );
    await expect(model.invoke([{ role: "system", content: "twin" }, { role: "user", content: "x" }])).rejects.toThrow(
      "matches several agents (a, b)",
    );
  });

  it("tells the same agent's tasks apart by `task`", async () => {
    const model = new ScriptedChatModel({
      script: {
        id: "tasks",
        agents: [
          { agent: "chief", systemIncludes: "Chief", task: "ALERT", turns: [{ content: "converge" }] },
          { agent: "chief", systemIncludes: "Chief", turns: [{ content: "hold" }] },
        ],
      },
    });
    const ask = (task: string) => model.invoke([{ role: "system", content: "Chief" }, { role: "user", content: task }]);
    expect((await ask("state: ALERT")).content).toBe("converge");
    expect((await ask("state: CALM")).content).toBe("hold");
  });

  it("answers withStructuredOutput with a validated object", async () => {
    const Plan = z.object({ steps: z.array(z.string()).min(1), confidence: z.number() });
    const model = new ScriptedChatModel({
      script: {
        id: "crew",
        agents: [
          {
            agent: "crew",
            systemIncludes: "You are the crew.",
            turns: [{ toolCalls: [{ name: "crew_plan", args: { steps: ["dock", "freight lift"], confidence: 0.7 } }] }],
          },
        ],
      },
    });
    const answer = await model
      .withStructuredOutput(Plan, { name: "crew_plan" })
      .invoke([{ role: "system", content: "You are the crew." }, { role: "user", content: "go" }]);
    expect(answer).toEqual({ steps: ["dock", "freight lift"], confidence: 0.7 });

    const bad = new ScriptedChatModel({
      script: {
        id: "bad",
        agents: [{ agent: "crew", systemIncludes: "crew", turns: [{ toolCalls: [{ name: "extract", args: { steps: [] } }] }] }],
      },
    });
    await expect(
      bad.withStructuredOutput(Plan).invoke([{ role: "system", content: "crew" }, { role: "user", content: "go" }]),
    ).rejects.toThrow();
  });

  it("loads and validates scripts from fixtures/llm/scripts", async () => {
    const script = await loadScript("two-subagents");
    expect(Script.parse(script).agents.map((a) => a.agent)).toEqual(["level-builder", "data-analyst", "game-master"]);
    await expect(loadScript("../package")).rejects.toThrow("invalid script name");
    await expect(loadScript("no-such-script")).rejects.toThrow();
  });
});

/**
 * Resolves once `count` callers have arrived, so two tools can each wait for
 * the other: it only settles if the two subagents really run concurrently.
 */
function barrier(count: number, timeoutMs = 2_000) {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return async (who: string) => {
    arrived += 1;
    if (arrived === count) open();
    const timer = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${who} waited alone: the subagents did not run in parallel`)), timeoutMs),
    );
    await Promise.race([opened, timer]);
  };
}

describe("ScriptedChatModel under deepagents (createDeepAgent)", () => {
  it("runs todos and two subagents dispatched in parallel through `task`, each on its own turns", async () => {
    const model = new ScriptedChatModel({ script: await loadScript("two-subagents") });
    const meet = barrier(2);
    const toolLog: string[] = [];

    const getBuilding = tool(
      async ({ id }) => {
        toolLog.push("get_building:start");
        await meet("data-analyst");
        toolLog.push("get_building:end");
        return JSON.stringify({ id, yearBuilt: 1974, buildingClass: "A" });
      },
      { name: "get_building", description: "A building's CoStar record", schema: z.object({ id: z.string() }) },
    );
    const listMissions = tool(
      async ({ city }) => {
        toolLog.push("list_missions:start");
        await meet("game-master");
        toolLog.push("list_missions:end");
        return JSON.stringify([{ id: "romaine-1974", city }]);
      },
      { name: "list_missions", description: "Missions for a city", schema: z.object({ city: z.string() }) },
    );

    const agent = createDeepAgent({
      model,
      systemPrompt: "You are the Level Builder for Heist Anywhere.",
      // deepagents 1.16.5 does not add the todo list by default; the builder
      // passes it explicitly.
      middleware: [todoListMiddleware()],
      subagents: [
        {
          name: "data-analyst",
          description: "Reads CoStar and Vexcel and derives the security profile.",
          systemPrompt: "You are the data analyst.",
          tools: [getBuilding],
        },
        {
          name: "game-master",
          description: "Picks the mission and writes the briefing.",
          systemPrompt: "You are the game master.",
          tools: [listMissions],
        },
      ],
    });

    const result = await agent.invoke({ messages: [{ role: "user", content: "Build the level for F1." }] });

    // Todos ran for real, through the todo middleware's state.
    expect(result.todos).toHaveLength(3);
    expect(result.todos.every((t: { status: string }) => t.status === "completed")).toBe(true);

    // Both subagents ran, each through its own two turns.
    const byAgent = (name: string) => model.calls.filter((c) => c.agent === name).map((c) => c.turn);
    expect(byAgent("data-analyst")).toEqual([0, 1]);
    expect(byAgent("game-master")).toEqual([0, 1]);
    expect(byAgent("level-builder")).toEqual([0, 1, 2, 3]);

    // They ran concurrently: both tools started before either finished, and
    // both finished (run one after the other, the first would time out).
    expect(toolLog).toHaveLength(4);
    expect(toolLog.slice(0, 2).sort()).toEqual(["get_building:start", "list_missions:start"]);
    expect(toolLog.slice(2).sort()).toEqual(["get_building:end", "list_missions:end"]);

    // Each `task` result is that subagent's own final answer.
    const taskResults = result.messages
      .filter((m) => m.getType() === "tool" && (m as { name?: string }).name === "task")
      .map((m) => String(m.content));
    expect(taskResults.sort()).toEqual([
      "Mission: romaine-1974, The Romaine Street Papers.",
      "Profile: built 1974, analog era; Class A, four guards.",
    ]);
    expect(result.messages.at(-1)?.content).toBe(
      "Level built for F1: analog era, four guards, mission romaine-1974.",
    );
  });
});
