// The Security Chief's one call on the cached F1 level (#20): the recorded
// turns per transition, the deterministic template, the live path on a
// stubbed model and its fallback, what the prompt may carry, and the route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ScriptedChatModel } from "@/adapters/llm";
import { CHIEF_RATIONALE_MAX, LevelManifest } from "@/domain";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { POST } from "../../app/api/chief/route";
import { CHIEF_PROMPT_HEAD, chiefMessages, chiefTemplate, ChiefRequest, loadChiefRecording, matchTurn, replanChief } from "./index";

const manifest = LevelManifest.parse(structuredClone(cached));

/** The zones the Run screen sends for F1 (chief-request.ts builds the same list from the placed level). */
const ZONES = [
  { id: "quiet-2210", name: "Suite 2210 (vacant)" },
  { id: "secure", name: "Secure room" },
  { id: "objective", name: "Records room" },
  { id: "dock-N", name: "Loading dock" },
  { id: "roof", name: "Roof hatch" },
  { id: "freight-lobby", name: "Freight Lift Lobby" },
  { id: "dock-corridor", name: "Dock Corridor" },
  { id: "elevator-lobby", name: "Elevator Lobby" },
  { id: "main-corridor", name: "Main Corridor" },
];

/** Beat 5: C2 sees the player in the dock corridor on turn 1. */
const trip = (overrides: Partial<ChiefRequest> = {}): ChiefRequest =>
  ChiefRequest.parse({
    buildingId: "F1",
    transition: { turn: 1, from: "calm", to: "alert", cause: { kind: "camera", id: "C2" } },
    lastKnownZone: "dock-corridor",
    guards: [
      { id: "G1", zoneId: "main-corridor", intent: "converge" },
      { id: "G2", zoneId: "quiet-2210", intent: "converge" },
      { id: "G3", zoneId: "main-corridor", intent: "converge" },
      { id: "G4", zoneId: "main-corridor", intent: "converge" },
    ],
    zones: ZONES,
    ...overrides,
  });

const ids = (request: ChiefRequest) => ({
  guards: new Set(request.guards.map((g) => g.id)),
  zones: new Set(request.zones.map((z) => z.id)),
});

describe("the recorded turns", () => {
  it("answer beat 5's trip with a rationale that names a guard and a zone, in the request's ids only", async () => {
    const recording = (await loadChiefRecording("F1"))!;
    const turn = matchTurn(recording, trip())!;
    expect(turn.id).toBe("c2-trip");
    expect(turn.orders.rationale).toMatch(/\bG\d\b/);
    expect(turn.orders.rationale.toLowerCase()).toContain("dock corridor");
    const known = ids(trip());
    for (const recorded of recording.turns) {
      for (const o of recorded.orders.orders) {
        expect(known.guards.has(o.guardId), `${recorded.id} ${o.guardId}`).toBe(true);
        expect(known.zones.has(o.zoneId), `${recorded.id} ${o.zoneId}`).toBe(true);
      }
      for (const z of recorded.orders.lockZones) expect(known.zones.has(z)).toBe(true);
    }
  });

  it("match on the transition, and leave a transition with no recording to the template", async () => {
    const recording = (await loadChiefRecording("F1"))!;
    expect(matchTurn(recording, trip({ transition: { turn: 3, from: "alert", to: "lockdown", cause: { kind: "camera", id: "C2" } } }))?.id).toBe(
      "c2-second-contact",
    );
    expect(matchTurn(recording, trip({ lastKnownZone: "main-corridor" }))).toBeNull();
    expect(await loadChiefRecording("F9")).toBeNull();
  });
});

describe("the template", () => {
  it("closes on the last-known zone, covers the way out and the objective, locks it, and is the same every time", () => {
    const request = trip({ lastKnownZone: "main-corridor", transition: { turn: 4, from: "calm", to: "alert", cause: { kind: "guard", id: "G1" } } });
    const orders = chiefTemplate(manifest, request);
    expect(orders).toEqual(chiefTemplate(manifest, request));
    expect(orders.orders).toEqual([
      { guardId: "G1", intent: "converge", zoneId: "main-corridor" },
      { guardId: "G2", intent: "converge", zoneId: "main-corridor" },
      { guardId: "G3", intent: "block", zoneId: "dock-N" },
      { guardId: "G4", intent: "hold", zoneId: "objective" },
    ]);
    expect(orders.lockZones).toEqual(["objective"]);
    expect(orders.rationale).toBe(
      "G1 has eyes on them in the Main Corridor. G1 and G2 converge on it. G3 blocks the Loading dock. G4 holds the Records room. Lock the Records room.",
    );
  });

  it("speaks a suite by its number, without the board's (vacant) tag, as on a kit building's floor (issue 140)", () => {
    const orders = chiefTemplate(manifest, trip({ lastKnownZone: "quiet-2210" }));
    expect(orders.rationale).toMatch(/^C2 has them in Suite 2210\. /);
    expect(orders.rationale).not.toMatch(/\(vacant\)|the Suite/);
    // Names that aren't a numbered suite keep their article.
    expect(orders.rationale).toContain("blocks the Loading dock.");
  });

  it("sweeps where they were lost on the way down, stands down at Calm, and stays within the rationale's length", () => {
    const down = chiefTemplate(manifest, trip({ transition: { turn: 5, from: "alert", to: "suspicious", cause: { kind: "decay" } } }));
    expect(down.orders.map((o) => [o.guardId, o.intent, o.zoneId])).toEqual([
      ["G1", "sweep", "dock-corridor"],
      ["G2", "sweep", "dock-corridor"],
    ]);
    expect(down.rationale).toMatch(/^Lost them in the Dock Corridor\./);
    const calm = chiefTemplate(manifest, trip({ transition: { turn: 8, from: "suspicious", to: "calm", cause: { kind: "decay" } } }));
    expect(calm).toEqual({ orders: [], lockZones: [], rationale: "All quiet. Everyone back on rounds." });
    const long = trip({ zones: ZONES.map((z) => ({ ...z, name: `${z.name} ${"x".repeat(70)}`.slice(0, 80) })) });
    expect(chiefTemplate(manifest, long).rationale.length).toBeLessThanOrEqual(CHIEF_RATIONALE_MAX);
  });
});

describe("the Chief's prompt", () => {
  it("carries the transition, the roster and the zones, and nothing of the floor", () => {
    const text = JSON.stringify(chiefMessages(manifest, trip()));
    expect(text).toContain(CHIEF_PROMPT_HEAD);
    expect(text).toContain("calm -> alert (camera C2)");
    expect(text).toContain("G2 in quiet-2210 (converge)");
    for (const node of FIXTURE_FLOORS.F1.nodes) expect(text, node.id).not.toMatch(new RegExp(`\\b${node.id}\\b`));
    for (const word of ["sightline", "adjacen", "edges", '"x"', '"y"']) expect(text).not.toContain(word);
  });
});

describe("replanChief", () => {
  beforeEach(() => {
    vi.stubEnv("HEIST_MODE", "fake");
    vi.stubEnv("LLM_MODE", "fake");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers the trip with the recorded turn in fake mode, and says it is recorded", async () => {
    const answer = (await replanChief(trip()))!;
    expect(answer).toMatchObject({ recorded: true, reason: "fake mode", source: "recorded", recording: "c2-trip" });
    expect(answer.orders.lockZones).toEqual(["objective"]);
  });

  it("answers a transition with no recording from the template, and is null for a building with no level", async () => {
    const answer = (await replanChief(trip({ lastKnownZone: "main-corridor" })))!;
    expect(answer).toMatchObject({ recorded: true, source: "template" });
    expect(answer.recording).toBeUndefined();
    expect(await replanChief(trip({ buildingId: "F9" }))).toBeNull();
  });

  it("live, uses the model's orders and says so", async () => {
    const orders = { orders: [{ guardId: "G2", intent: "block", zoneId: "objective" }], lockZones: [], rationale: "G2, sit on the records room." };
    const model = new ScriptedChatModel({
      script: {
        id: "chief-live",
        agents: [{ agent: "chief", systemIncludes: CHIEF_PROMPT_HEAD, turns: [{ toolCalls: [{ name: "chief_orders", args: orders }] }] }],
      },
    });
    const answer = (await replanChief(trip(), { selection: { model, mode: "live", provider: "anthropic", reason: "test" } }))!;
    expect(answer).toEqual({ orders, recorded: false, source: "model" });
  });

  it("live, falls back to the recorded turn when the model fails", async () => {
    const model = new ScriptedChatModel({ script: { id: "empty", agents: [{ agent: "other", systemIncludes: "nobody", turns: [{ content: "" }] }] } });
    const answer = (await replanChief(trip(), { selection: { model, mode: "live", provider: "anthropic", reason: "test" } }))!;
    expect(answer).toMatchObject({ recorded: true, reason: "error", source: "recorded", recording: "c2-trip" });
  });
});

describe("POST /api/chief", () => {
  const post = (body: unknown) =>
    POST(new Request("http://localhost/api/chief", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("answers beat 5's trip with the recorded orders", async () => {
    const response = await post(trip());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { orders: { rationale: string }; source: string; recorded: boolean };
    expect(body.source).toBe("recorded");
    expect(body.orders.rationale).toMatch(/G1/);
  });

  it("refuses a body that carries floor data, or is malformed, and answers 404 for a building with no level", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ ...trip(), nodes: [{ id: "dc-west", x: 12, y: 2 }] })).status).toBe(400);
    expect((await post({ ...trip(), zones: [{ id: "dock-corridor", name: "Dock Corridor", nodes: ["dc-west"] }] })).status).toBe(400);
    expect((await post({ ...trip(), guards: [{ id: "G1", zoneId: "dock-corridor", intent: "converge", x: 12 }] })).status).toBe(400);
    expect((await post({ ...trip(), guards: [] })).status).toBe(400);
    expect((await post({ ...trip(), buildingId: "F9" })).status).toBe(404);
  });
});
