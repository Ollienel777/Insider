// `npm run record:builds` saves a live run as a ScriptedChatModel script
// (#31). These tests run keyless: a recording made from a run replays to the
// same manifest, and so does the live F1 recording committed in
// fixtures/llm/recorded/.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadScript, ScriptedChatModel } from "@/adapters/llm";
import { BuildTrace, LevelManifest } from "@/domain";
import { buildLevel, scriptedLabel } from "./builder";
import { RECORDED_DIR, scriptFromTurns, SYSTEM_INCLUDES } from "./record";

beforeAll(() => {
  vi.stubEnv("HEIST_MODE", "fake");
  vi.stubEnv("LLM_MODE", "fake");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const toolSequence = (trace: BuildTrace) =>
  trace.events.filter((e) => e.kind !== "todo").map((e) => `${e.kind}:${e.agent}/${e.label}:${e.status}`);

describe("scriptFromTurns", () => {
  it("records a run as a script that replays to the same manifest, trace and answer", async () => {
    const original = await buildLevel("F1", { model: new ScriptedChatModel({ script: await loadScript("builder-F1") }) });
    const script = scriptFromTurns("builder-F1", original.turns, {
      model: "anthropic claude-sonnet-4-6",
      recordedAt: "2026-11-14T00:00:00.000Z",
    });
    expect(script.agents.map((a) => [a.agent, a.turns.length])).toEqual([
      ["level-builder", 6],
      ["data-analyst", 3],
      ["game-master", 2],
    ]);

    const replayed = await buildLevel("F1", { model: new ScriptedChatModel({ script }) });
    expect(replayed.manifest).toEqual(original.manifest);
    expect(toolSequence(replayed.trace)).toEqual(toolSequence(original.trace));
    expect(replayed.summary).toBe(original.summary);
    expect(replayed.turns).toEqual(original.turns);
  }, 30_000); // two full deep-agent runs

  it("tells apart the tasks of a subagent dispatched more than once", () => {
    const script = scriptFromTurns("two-tasks", [
      { agent: "data-analyst", task: "Read F1", content: "a", toolCalls: [] },
      { agent: "data-analyst", task: "Derive F1", content: "b", toolCalls: [] },
      { agent: "game-master", task: "Pick", content: "c", toolCalls: [] },
    ]);
    expect(script.recorded).toBeUndefined();
    expect(script.agents).toEqual([
      { agent: "data-analyst", systemIncludes: SYSTEM_INCLUDES["data-analyst"], task: "Read F1", turns: [{ content: "a", toolCalls: [] }] },
      { agent: "data-analyst", systemIncludes: SYSTEM_INCLUDES["data-analyst"], task: "Derive F1", turns: [{ content: "b", toolCalls: [] }] },
      { agent: "game-master", systemIncludes: SYSTEM_INCLUDES["game-master"], turns: [{ content: "c", toolCalls: [] }] },
    ]);
  });
});

describe("the live F1 recording in fixtures/llm/recorded/", () => {
  const read = (file: string): unknown => JSON.parse(readFileSync(path.join(RECORDED_DIR, file), "utf8"));

  it("replays in fake mode to the manifest the live run wrote, and says whose turns it replays", async () => {
    const script = await loadScript("builder-F1", RECORDED_DIR);
    expect(script.recorded?.model).toMatch(/^anthropic claude-/);
    const replayed = await buildLevel("F1", { model: new ScriptedChatModel({ script }) });
    expect(replayed.manifest).toEqual(LevelManifest.parse(read("F1.json")));

    const live = BuildTrace.parse(read("F1.trace.json"));
    expect(live.model).toBe(script.recorded?.model);
    expect(toolSequence(replayed.trace)).toEqual(toolSequence(live));
  }, 30_000);

  it("is labelled, when replayed, with the model whose turns it holds and when they were recorded", async () => {
    const script = await loadScript("builder-F1", RECORDED_DIR);
    expect(scriptedLabel(script)).toBe(
      `ScriptedChatModel (script builder-F1, replaying ${script.recorded?.model}'s turns recorded ${script.recorded?.recordedAt})`,
    );
    expect(scriptedLabel(await loadScript("builder-F1"))).toBe("ScriptedChatModel (script builder-F1, no LLM)");
  });

  it("has a live trace with todos and both subagents", () => {
    const live = BuildTrace.parse(read("F1.trace.json"));
    expect(live.events.some((e) => e.kind === "todo")).toBe(true);
    expect(new Set(live.events.filter((e) => e.kind === "subagent").map((e) => e.agent))).toEqual(
      new Set(["data-analyst", "game-master"]),
    );
  });

  it("holds no API key", () => {
    for (const file of ["builder-F1.json", "F1.json", "F1.trace.json"]) {
      expect(readFileSync(path.join(RECORDED_DIR, file), "utf8"), file).not.toMatch(/sk-ant-/);
    }
  });
});
