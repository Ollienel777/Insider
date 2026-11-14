// `npm run record:builds` saves a live run as a ScriptedChatModel script
// (#31). These tests run keyless: a recording made from a run replays to the
// same manifest. The live F1 recording committed in
// fixtures/llm/recorded/pre-119/ predates the mission input and the briefing
// rules (#119): it is kept as the run those rules catch, and no longer
// replays to a manifest (see the README there).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadScript, ScriptedChatModel } from "@/adapters/llm";
import { BRIEFING_MAX_WORDS, briefingProblems, briefingWords, BuildTrace } from "@/domain";
import { buildLevel, LevelBuildError, scriptedLabel } from "./builder";
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
    const original = await buildLevel("F1", "romaine-1974", {
      model: new ScriptedChatModel({ script: await loadScript("builder-F1-romaine-1974") }),
    });
    const script = scriptFromTurns("builder-F1-romaine-1974", original.turns, {
      model: "anthropic claude-sonnet-4-6",
      recordedAt: "2026-11-14T00:00:00.000Z",
    });
    expect(script.agents.map((a) => [a.agent, a.turns.length])).toEqual([
      ["level-builder", 6],
      ["data-analyst", 3],
      ["game-master", 2],
    ]);

    const replayed = await buildLevel("F1", "romaine-1974", { model: new ScriptedChatModel({ script }) });
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

// The re-record deletes the folder, and these with it.
const STALE = path.join(RECORDED_DIR, "pre-119");
describe.skipIf(!existsSync(STALE))("the stale pre-#119 F1 recording in fixtures/llm/recorded/pre-119/", () => {
  const read = (file: string): unknown => JSON.parse(readFileSync(path.join(STALE, file), "utf8"));

  // The recorded write_manifest call and the game master's last answer.
  const recorded = async () => {
    const script = await loadScript("builder-F1", STALE);
    const calls = script.agents.flatMap((a) => a.turns.flatMap((t) => t.toolCalls));
    const written = calls.find((c) => c.name === "write_manifest")!.args.briefing as string;
    const gm = script.agents.find((a) => a.agent === "game-master")!.turns.at(-1)!.content;
    return { script, calls, written, gm };
  };

  it("is the run the briefing rules catch: the builder dropped the game-fiction line, and the length was self-reported", async () => {
    const { written, gm } = await recorded();
    // The game master wrote the game-fiction line; the builder's copy lost it (R1-M1).
    expect(gm).toMatch(/game-fiction security elements/);
    expect(written).not.toMatch(/game[- ]fiction/i);
    // The game master reported 118 words; counted, its briefing is longer than the limit.
    expect(gm).toMatch(/Word count:\*\* 118/);
    const gmBriefing = /> You're going into[\s\S]*?game-fiction security elements\.\*/.exec(gm)![0];
    expect(briefingWords(gmBriefing)).toBeGreaterThan(BRIEFING_MAX_WORDS);
    expect(briefingWords(written)).toBeGreaterThan(BRIEFING_MAX_WORDS);
    expect(briefingProblems(written)).toEqual([
      `the briefing is ${briefingWords(written)} words; the limit is ${BRIEFING_MAX_WORDS}`,
      'the briefing must say its security is game fiction (the words "game fiction")',
    ]);
  });

  it("no longer replays to a manifest: write_manifest refuses its briefing (re-record with npm run record:builds -- F1:romaine-1974)", async () => {
    const { script, calls } = await recorded();
    expect(script.recorded?.model).toMatch(/^anthropic claude-/);
    // Recorded before #119, its game master reads the library with list_missions.
    expect(calls.some((c) => c.name === "list_missions")).toBe(true);
    const error = await buildLevel("F1", "romaine-1974", { model: new ScriptedChatModel({ script }) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LevelBuildError);
    const write = (error as LevelBuildError).trace.events.find((e) => e.label === "write_manifest")!;
    expect(write.status).toBe("failed");
    expect(write.output).toMatch(/the briefing is \d+ words; the limit is 120/);

    const live = BuildTrace.parse(read("F1.trace.json"));
    expect(live.model).toBe(script.recorded?.model);
  }, 30_000);

  it("is labelled, when replayed, with the model whose turns it holds and when they were recorded", async () => {
    const script = await loadScript("builder-F1", STALE);
    expect(scriptedLabel(script)).toBe(
      `scripted (builder-F1), replaying ${script.recorded?.model}'s turns recorded ${script.recorded?.recordedAt}; no LLM ran`,
    );
    expect(scriptedLabel(await loadScript("builder-F1-romaine-1974"))).toBe("scripted (builder-F1-romaine-1974), no LLM ran");
  });

  it("has a live trace with todos and both subagents", () => {
    const live = BuildTrace.parse(read("F1.trace.json"));
    expect(live.events.some((e) => e.kind === "todo")).toBe(true);
    expect(new Set(live.events.filter((e) => e.kind === "subagent").map((e) => e.agent))).toEqual(
      new Set(["data-analyst", "game-master"]),
    );
  });

  it("says in its own README that it is stale, does not replay, and how to re-record", () => {
    const readme = readFileSync(path.join(STALE, "README.md"), "utf8");
    expect(readme).toMatch(/do not replay/);
    expect(readme).toContain("npm run record:builds -- F1:romaine-1974");
  });

  it("holds no API key", () => {
    for (const file of ["builder-F1.json", "F1.json", "F1.trace.json"]) {
      expect(readFileSync(path.join(STALE, file), "utf8"), file).not.toMatch(/sk-ant-/);
    }
  });
});
