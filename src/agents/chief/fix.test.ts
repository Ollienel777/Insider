// The Chief's suggested fix (issue 127): the clamp to the level's roster and the
// summary's zones, the template, the recorded answer keyless, the live path
// on a stubbed model, the prompt's limits (SPEC §4.5) and the route's input
// discipline.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ScriptedChatModel } from "@/adapters/llm";
import { ChiefFix, LevelManifest, type FixSummary } from "@/domain";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { POST } from "../../app/api/chief/fix/route";
import { clampFix, FIX_PROMPT_HEAD, fixMessages, fixRoster, fixTemplate, loadFixRecording, suggestFix } from "./index";

const manifest = LevelManifest.parse(structuredClone(cached));

const summary: FixSummary = {
  total: 50,
  escaped: 17,
  byStrategy: [
    { strategyId: "dock-patient", runs: 10, escaped: 9 },
    { strategyId: "roof-quiet", runs: 10, escaped: 0 },
  ],
  topRoute: { zones: ["dock-N", "freight-lobby", "dock-corridor", "objective", "dock-corridor", "freight-lobby", "dock-N"], count: 14 },
  detectors: [
    { kind: "guard", id: "G2", count: 10, turns: [0, 3, 7] },
    { kind: "camera", id: "C1", count: 9, turns: [0, 1, 2] },
    { kind: "camera", id: "C2", count: 7, turns: [1, 3] },
  ],
  zones: [
    { id: "dock-N", name: "Freight lift" },
    { id: "objective", name: "Records room" },
    { id: "freight-lobby", name: "Freight Lift Lobby" },
    { id: "dock-corridor", name: "Dock Corridor" },
    { id: "main-corridor", name: "Main Corridor" },
  ],
};

const liveSelection = (fix: unknown) => ({
  model: new ScriptedChatModel({
    script: {
      id: "fix-live",
      agents: [{ agent: "chief", systemIncludes: FIX_PROMPT_HEAD, turns: [{ toolCalls: [{ name: "chief_fix", args: fix as Record<string, unknown> }] }] }],
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

describe("clampFix", () => {
  const roster = fixRoster(manifest, summary);
  const fix = (change: ChiefFix["change"]): ChiefFix => ({ change, rationale: "Because." });

  it("knows the profile's guards and cameras and the summary's zones", () => {
    expect(roster).toEqual({
      guards: ["G1", "G2", "G3", "G4"],
      cameras: ["C1", "C2"],
      zones: ["dock-N", "objective", "freight-lobby", "dock-corridor", "main-corridor"],
    });
  });

  it("keeps a change that fits, with only the fields its kind takes, and clamps a retime", () => {
    expect(clampFix(roster, fix({ kind: "move-camera", elementId: "C2", to: "dock-corridor", byTurns: 3 }))).toEqual({
      ok: true,
      fix: fix({ kind: "move-camera", elementId: "C2", to: "dock-corridor" }),
    });
    expect(clampFix(roster, fix({ kind: "retime-guard", elementId: "G1", byTurns: 40 }))).toEqual({
      ok: true,
      fix: fix({ kind: "retime-guard", elementId: "G1", byTurns: 6 }),
    });
    expect(clampFix(roster, fix({ kind: "add-guard", elementId: "G5", to: "objective" })).ok).toBe(true);
    expect(clampFix(roster, fix({ kind: "lock-door", elementId: "objective" })).ok).toBe(true);
  });

  it("drops an element or zone the level does not have, with the reason", () => {
    const reasons = [
      fix({ kind: "move-camera", elementId: "C7", to: "dock-corridor" }),
      fix({ kind: "move-camera", elementId: "C2", to: "fl-car" }),
      fix({ kind: "move-camera", elementId: "C2" }),
      fix({ kind: "retime-guard", elementId: "G9", byTurns: 1 }),
      fix({ kind: "retime-guard", elementId: "G1" }),
      fix({ kind: "lock-door", elementId: "vault" }),
      fix({ kind: "add-guard", elementId: "G2", to: "objective" }),
      fix({ kind: "add-guard", elementId: "Bob", to: "objective" }),
    ].map((f) => {
      const clamped = clampFix(roster, f);
      return clamped.ok ? null : clamped.reason;
    });
    expect(reasons).toEqual([
      '"C7" is not a camera of this level',
      '"fl-car" is not a zone of this level',
      "move-camera needs a zone to cover",
      '"G9" is not a guard of this level',
      "retime-guard needs a non-zero byTurns",
      '"vault" is not a zone of this level',
      '"G2" is already on this level',
      'a new guard\'s id is G and a number, not "Bob"',
    ]);
  });
});

describe("fixTemplate", () => {
  it("puts the least-used camera over the way to the objective the escapes took", () => {
    const fix = fixTemplate(manifest, summary);
    expect(ChiefFix.parse(fix)).toEqual(fix);
    expect(fix.change).toEqual({ kind: "move-camera", elementId: "C2", to: "dock-corridor" });
    expect(fix.rationale).toContain("Dock Corridor");
    expect(fixTemplate(manifest, summary)).toEqual(fix);
  });

  it("with no escape, retimes the guard that caught them most", () => {
    const fix = fixTemplate(manifest, { ...summary, escaped: 0, topRoute: null });
    expect(fix.change).toEqual({ kind: "retime-guard", elementId: "G2", byTurns: 1 });
    expect(clampFix(fixRoster(manifest, summary), fix).ok).toBe(true);
  });
});

describe("suggestFix", () => {
  it("answers with the recorded fix keyless", async () => {
    const answer = await suggestFix({ buildingId: "F1", summary });
    const recording = await loadFixRecording("F1");
    expect(answer).toMatchObject({ recorded: true, source: "recorded", reason: "fake mode" });
    expect(answer!.fix).toEqual(recording!.fix);
    expect(answer!.fix.change).toEqual({ kind: "move-camera", elementId: "C2", to: "dock-corridor" });
  });

  it("is null for a building with no cached level", async () => {
    expect(await suggestFix({ buildingId: "F9", summary })).toBeNull();
  });

  it("takes a live change that fits, and drops one that does not for the template", async () => {
    vi.stubEnv("LLM_MODE", "live");
    const good = { change: { kind: "add-guard", elementId: "G5", to: "dock-corridor" }, rationale: "Post one more in the corridor." };
    const live = await suggestFix({ buildingId: "F1", summary }, { selection: liveSelection(good) });
    expect(live).toMatchObject({ recorded: false, source: "model", fix: good });
    const bad = { change: { kind: "move-camera", elementId: "C9", to: "dock-corridor" }, rationale: "Move C9." };
    const dropped = await suggestFix({ buildingId: "F1", summary }, { selection: liveSelection(bad) });
    expect(dropped).toMatchObject({
      source: "template",
      fix: fixTemplate(manifest, summary),
      dropped: { change: bad.change, reason: '"C9" is not a camera of this level' },
    });
  });

  it("prompts with zone and element ids only, never the floor", () => {
    const text = fixMessages(manifest, summary)
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain("dock-corridor: Dock Corridor");
    expect(text).toContain("17 of 50");
    const f = FIXTURE_FLOORS.F1;
    for (const token of f.nodes.map((n) => n.id)) expect(text, token).not.toMatch(new RegExp(`\\b${token}\\b`));
    for (const word of ["sightline", "adjacen", "edges", '"x"', '"y"']) expect(text).not.toContain(word);
  });
});

describe("POST /api/chief/fix", () => {
  const post = (body: unknown) =>
    POST(new Request("http://localhost/api/chief/fix", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("answers with the fix and the recorded flag", async () => {
    const response = await post({ buildingId: "F1", summary });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ recorded: true, source: "recorded", fix: { change: { kind: "move-camera" } } });
  });

  it("takes only {buildingId, summary}: a floor, a route of nodes or a bad body is refused", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ buildingId: "../F1", summary })).status).toBe(400);
    const floor = await post({ buildingId: "F1", summary, floor: FIXTURE_FLOORS.F1 });
    expect(floor.status).toBe(400);
    expect(((await floor.json()) as { error: string }).error).toMatch(/not floor/);
    const nodes = await post({ buildingId: "F1", summary: { ...summary, topRoute: { ...summary.topRoute, nodes: ["fl-car"] } } });
    expect(nodes.status).toBe(400);
    expect((await post({ buildingId: "F1", summary: { ...summary, zones: [] } })).status).toBe(400);
    expect((await post({ buildingId: "F9", summary })).status).toBe(404);
  });
});
