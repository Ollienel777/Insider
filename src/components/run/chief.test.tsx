// Beat 5's re-plan on the Run screen's side (#20), on the cached F1 level
// placed on the F1 fixture floor: what the browser sends the Chief, how the
// answer is clamped and applied, what the board then previews, and the
// Chief's panel. The server half is src/agents/chief/chief.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ScriptedChatModel, type ChatModelSelection } from "@/adapters/llm";
import { CHIEF_PROMPT_HEAD, replanChief } from "@/agents/chief";
import { CrewPlan, LevelManifest, type ChiefOrders } from "@/domain";
import { act, applyChiefOrders, createRun, plannedPath, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.json";
import crewF1 from "../../../fixtures/llm/crew-F1.json";
import { crewPlanSteps, guardOrders, zoneName } from "./board";
import { ChiefPanel, chiefSourceNote, hiddenRoutes, LATE_NOTE, type ChiefState, type Revealed } from "./chief-panel";
import { askChief, chiefRequest, chiefZones, toEngineOrders, type ChiefAnswer } from "./chief-request";
import { crewPlanKey, loadCrewPlan, saveCrewPlan } from "./crew-plan-store";
import { RUN_SEED } from "./run-screen";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const zones = chiefZones(placed);

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}
const wait: Action = { kind: "wait" };

/** The judge's two keys on beat 5: to the freight lift lobby, then straight into C2's half of the corridor. */
const tripped = () => play(createRun(placed.level), [{ kind: "move", to: F1_DEMO.freightLiftWait }, { kind: "move", to: "dc-west" }]);
const lastEvent = (run: RunState) => run.alarmEvents[run.alarmEvents.length - 1];

/** The Chief's answer for the run's last alarm event, as the Run screen gets it, applied as it applies it. */
async function replan(run: RunState) {
  const request = chiefRequest("F1", placed, zones, run, lastEvent(run));
  const answer = (await replanChief(request))!;
  return { request, answer, result: applyChiefOrders(run, toEngineOrders(answer.orders, zones)) };
}

beforeEach(() => {
  vi.stubEnv("HEIST_MODE", "fake");
  vi.stubEnv("LLM_MODE", "fake");
});
afterEach(() => vi.unstubAllEnvs());

describe("what the browser sends the Chief", () => {
  it("names zones, guards and the transition, and carries no node, coordinate or adjacency", () => {
    const run = tripped();
    const request = chiefRequest("F1", placed, zones, run, lastEvent(run));
    expect(Object.keys(request).sort()).toEqual(["buildingId", "guards", "lastKnownZone", "transition", "zones"]);
    expect(request.transition).toEqual({ turn: 1, from: "calm", to: "alert", cause: { kind: "camera", id: "C2" } });
    expect(request.lastKnownZone).toBe("dock-corridor");
    expect(request.guards.map((g) => g.id)).toEqual(["G1", "G2", "G3", "G4"]);
    const text = JSON.stringify(request);
    for (const node of placed.level.floor.nodes) expect(text, node.id).not.toMatch(new RegExp(`"${node.id}"`));
    for (const key of ['"x"', '"y"', '"rect"', "edges", "sightlines", "adjacen", '"nodes"', '"a"', '"b"']) expect(text, key).not.toContain(key);
    // Every zone a guard stands in, and the last-known zone, is one the Chief may name.
    const named = new Set(request.zones.map((z) => z.id));
    expect(named.has(request.lastKnownZone!)).toBe(true);
    for (const g of request.guards) expect(named.has(g.zoneId), g.zoneId).toBe(true);
  });

  it("offers every zone the recorded F1 turns name", () => {
    const recording = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures/llm/chief-F1.json"), "utf8")) as {
      turns: { orders: ChiefOrders }[];
    };
    const named = new Set(zones.zones.map((z) => z.id));
    for (const turn of recording.turns) {
      for (const id of [...turn.orders.orders.map((o) => o.zoneId), ...turn.orders.lockZones]) expect(named.has(id), id).toBe(true);
    }
  });

  it("on a scanned floor, names the rooms outside every zone by opaque area ids, never by the scan's ids or labels", () => {
    const scanned = { ...structuredClone(FIXTURE_FLOORS.F1), source: "matterport" as const };
    const live = chiefZones(placeLevel(manifest, scanned, RUN_SEED));
    const areas = live.zones.filter((z) => z.id.startsWith("area-"));
    expect(areas.length).toBeGreaterThan(0);
    const text = JSON.stringify(live.zones);
    for (const room of scanned.rooms) {
      expect(text).not.toContain(`"${room.id}"`);
      expect(text).not.toContain(room.label);
    }
    // And the orders map back to the rooms.
    const dock = live.toChief.get("dock-corridor")!;
    expect(dock).toMatch(/^area-\d+$/);
    expect(toEngineOrders({ orders: [{ guardId: "G1", intent: "converge", zoneId: dock }], lockZones: [], rationale: "x" }, live).orders[0].zoneId).toBe(
      "dock-corridor",
    );
  });

  it("posts exactly the request and reads the answer back", async () => {
    const run = tripped();
    const request = chiefRequest("F1", placed, zones, run, lastEvent(run));
    const answer: ChiefAnswer = { orders: { orders: [], lockZones: [], rationale: "Hold." }, recorded: true, reason: "fake mode", source: "template" };
    const fetch = vi.fn(async () => Response.json(answer));
    expect(await askChief(request, { fetch })).toEqual(answer);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual(request);
    const failing = vi.fn(async () => Response.json({ error: "no cached level" }, { status: 404 }));
    await expect(askChief(request, { fetch: failing })).rejects.toThrow("no cached level");
  });

  it("reads an answer with no source, or one it does not know, as recorded, never as live", async () => {
    const run = tripped();
    const request = chiefRequest("F1", placed, zones, run, lastEvent(run));
    const orders = { orders: [], lockZones: [], rationale: "Hold." };
    for (const source of [undefined, "bogus"]) {
      const fetch = vi.fn(async () => Response.json({ orders, recorded: false, ...(source && { source }) }));
      const answer = await askChief(request, { fetch });
      expect(answer, String(source)).toMatchObject({ source: "recorded", recorded: true });
      expect(chiefSourceNote(answer)).toBe("Recorded orders: no model was called.");
    }
    // A live answer still reads as live.
    const live = vi.fn(async () => Response.json({ orders, recorded: false, source: "model" }));
    const answer = await askChief(request, { fetch: live });
    expect(answer).toMatchObject({ source: "model", recorded: false });
    expect(chiefSourceNote(answer)).toBe("Live orders: the model wrote these.");
  });
});

describe("beat 5's re-plan, applied", () => {
  it("keeps every recorded order, locks the records room, and changes each ordered guard's route to match", async () => {
    const run = tripped();
    const { answer, result } = await replan(run);
    expect(answer.source).toBe("recorded");
    expect(answer.orders.rationale).toMatch(/\bG\d\b/);
    expect(result.dropped).toEqual([]);
    expect(result.applied.map((o) => o.guardId)).toEqual(["G1", "G4", "G2", "G3"]);
    // The records room door is still locked at the trip, so it stays locked.
    expect(result.locked).toEqual([{ zoneId: "objective", doors: [] }]);
    expect(result.run.locked).toContain(F1_DEMO.recordsDoor);

    const routes = guardOrders(placed, result.run);
    for (const order of result.applied) {
      const route = routes.find((r) => r.guardId === order.guardId)!;
      const guard = result.run.guards.find((g) => g.id === order.guardId)!;
      expect(route.intent).toBe(order.intent);
      expect(route.zoneId).toBe(order.zoneId);
      expect(route.path).toEqual(plannedPath(result.run.board, guard));
      expect(route.path.length, order.guardId).toBeGreaterThan(1);
    }
    // G2 now heads for the records room instead of the corridor, by the route the board draws.
    const before = guardOrders(placed, run).find((r) => r.guardId === "G2")!;
    const after = routes.find((r) => r.guardId === "G2")!;
    expect(after.path).not.toEqual(before.path);
    expect(placed.level.zones!.objective).toContain(after.path[after.path.length - 1]);

    // The next turn, every ordered guard steps onto the second node of its preview.
    const next = play(result.run, [wait]);
    for (const r of routes) expect(next.guards.find((g) => g.id === r.guardId)!.nodeId, r.guardId).toBe(r.path[1]);
    expect(next.turns.at(-1)!.chief?.rationale).toBe(answer.orders.rationale);
  });

  it("closes the gap: a player who stays where C2 saw them is caught, on their node", async () => {
    let run = (await replan(tripped())).result.run;
    for (let i = 0; i < 10 && run.status === "playing"; i++) {
      const events = run.alarmEvents.length;
      run = play(run, [wait]);
      // Each new alarm event gets its re-plan, as on the Run screen.
      if (run.alarmEvents.length > events && run.status === "playing") run = (await replan(run)).result.run;
    }
    expect(run.status).toBe("caught");
    expect(run.guards.some((g) => g.nodeId === run.playerNode)).toBe(true);
  });

  it("drops an order naming a guard or zone the board does not have, without an error", () => {
    const run = tripped();
    const bogus: ChiefOrders = {
      orders: [
        { guardId: "G7", intent: "hold", zoneId: "objective" },
        { guardId: "G1", intent: "sweep", zoneId: "the vault" },
        { guardId: "G2", intent: "hold", zoneId: "objective" },
      ],
      lockZones: ["the vault"],
      rationale: "G7 holds the vault.",
    };
    const result = applyChiefOrders(run, toEngineOrders(bogus, zones));
    expect(result.applied).toEqual([{ guardId: "G2", intent: "hold", zoneId: "objective" }]);
    expect(result.dropped.map((d) => d.reason)).toEqual(['no guard "G7"', 'no zone "the vault"', 'no zone "the vault"']);
  });
});

describe("the Chief's panel", () => {
  const html = (state: ChiefState, revealed: Revealed = { words: 999, rows: 999, done: true }) =>
    renderToStaticMarkup(<ChiefPanel state={state} revealed={revealed} zoneName={(id) => zoneName(placed, id)} onRetry={() => {}} />);

  it("waits with its label and a one-line skeleton while a call is out", () => {
    expect(html({ status: "idle" })).toContain("Re-plans the guards each time the alarm changes.");
    const pending = html({ status: "pending", seq: 0 });
    expect(pending).toContain('data-testid="chief-skeleton"');
    expect(pending).toContain("Re-planning");
  });

  it("shows the rationale, the orders and the lock, says the orders are recorded, and lists a dropped order", async () => {
    const run = tripped();
    const { answer, result } = await replan(run);
    const dropped = { ...result, dropped: [{ order: { guardId: "G7", intent: "hold" as const, zoneId: "objective" }, reason: 'no guard "G7"' }] };
    const out = html({ status: "ready", seq: 0, answer, applied: dropped });
    expect(out).toContain(answer.orders.rationale);
    expect(out).toContain('data-testid="chief-recorded-chip"');
    expect(out).toContain("Recorded orders: no model was called.");
    expect(out.split('data-testid="chief-order"').length - 1).toBe(4);
    expect(out).toMatch(/data-testid="chief-order" data-guard="G2" data-intent="hold"[^>]*>(?:(?!<\/li>).)*Records room/s);
    expect(out).toMatch(/data-testid="chief-lock"[^>]*>(?:(?!<\/li>).)*Records room/s);
    expect(out).toContain('Dropped: no guard &quot;G7&quot;');
  });

  it("streams: only the words and rows revealed so far are on screen, and an ordered guard's route waits for its row", async () => {
    const { answer, result } = await replan(tripped());
    const state: ChiefState = { status: "ready", seq: 0, answer, applied: result };
    const out = html(state, { words: 3, rows: 1, done: false });
    const first3 = answer.orders.rationale.split(/\s+/).slice(0, 3).join(" ");
    expect(out).toContain(`data-done="false" class="text-base text-text-1">${first3}<span`);
    expect(out.split('data-testid="chief-order"').length - 1).toBe(1);
    expect([...hiddenRoutes(state, { words: 99, rows: 1, done: false })]).toEqual(["G4", "G2", "G3"]);
    expect(hiddenRoutes(state, { words: 99, rows: 99, done: true }).size).toBe(0);
  });

  it("marks an answer that landed after the run ended as late: muted orders, and no guard waits on them", async () => {
    const { answer, result } = await replan(tripped());
    const state: ChiefState = { status: "ready", seq: 1, answer, applied: result, late: true };
    const out = html(state);
    expect(out).toContain('data-testid="chief-panel" data-state="ready" data-seq="1" data-source="recorded" data-late="true"');
    expect(out).toContain('data-testid="chief-late-chip"');
    expect(out).toContain(`data-testid="chief-late" class="text-sm text-text-2">${LATE_NOTE}<`);
    expect(LATE_NOTE).toBe("Arrived after the run ended. None of these orders reached the guards.");
    // Every row is still listed, but none in the colour of an order that moved a guard.
    expect(out.split('data-testid="chief-order"').length - 1).toBe(result.applied.length);
    expect(out).not.toContain("text-danger");
    expect(hiddenRoutes(state, { words: 0, rows: 0, done: false }).size).toBe(0);

    const onTime = html({ ...state, late: false });
    expect(onTime).not.toContain("chief-late");
    expect(onTime).not.toContain("data-late");
    expect(onTime).toContain("text-danger");
  });

  describe("says truly where the orders came from (#30, R1-M2)", () => {
    const live = (model: ScriptedChatModel): ChatModelSelection => ({ model, mode: "live", provider: "anthropic", reason: "test" });
    const note = (out: string) => out.match(/data-testid="chief-source-note"[^>]*>([^<]*)</)?.[1];
    const ready = async (selection?: ChatModelSelection) => {
      const run = tripped();
      const request = chiefRequest("F1", placed, zones, run, lastEvent(run));
      const answer = (await replanChief(request, selection ? { selection } : {}))!;
      return { answer, out: html({ status: "ready", seq: 0, answer, applied: applyChiefOrders(run, toEngineOrders(answer.orders, zones)) }) };
    };

    it("fake mode: recorded, and no model was called", async () => {
      const { answer, out } = await ready();
      expect(answer).toMatchObject({ source: "recorded", reason: "fake mode" });
      expect(note(out)).toBe("Recorded orders: no model was called.");
      expect(out).toContain('data-testid="chief-recorded-chip"');
    });

    it("a live answer: the model wrote the orders, and there is no recorded chip", async () => {
      const orders = { orders: [{ guardId: "G2", intent: "block", zoneId: "objective" }], lockZones: [], rationale: "G2, sit on the records room." };
      const model = new ScriptedChatModel({
        script: { id: "chief-live", agents: [{ agent: "chief", systemIncludes: CHIEF_PROMPT_HEAD, turns: [{ toolCalls: [{ name: "chief_orders", args: orders }] }] }] },
      });
      const { answer, out } = await ready(live(model));
      expect(answer).toMatchObject({ source: "model", recorded: false });
      expect(note(out)).toBe("Live orders: the model wrote these.");
      expect(out).not.toContain("chief-recorded-chip");
      expect(out).not.toContain("no model was called");
    });

    it("a live call that failed: the model was called, and the recorded orders stand in", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const model = new ScriptedChatModel({ script: { id: "empty", agents: [{ agent: "other", systemIncludes: "nobody", turns: [{ content: "" }] }] } });
      const { answer, out } = await ready(live(model));
      expect(answer).toMatchObject({ source: "recorded", reason: "error" });
      expect(note(out)).toBe("The model was called but the call failed, so recorded orders stand in.");
      expect(out).toContain('data-testid="chief-recorded-chip"');
      expect(out).not.toContain("no model was called");
    });

    it("a live call that timed out, or failed where no recording exists: says so for the rule-based orders too", () => {
      expect(chiefSourceNote({ source: "recorded", reason: "timeout" })).toBe(
        "The model was called but didn't answer in time, so recorded orders stand in.",
      );
      expect(chiefSourceNote({ source: "template", reason: "timeout" })).toBe(
        "The model was called but didn't answer in time, so rule-based orders stand in.",
      );
      expect(chiefSourceNote({ source: "template", reason: "error" })).toBe(
        "The model was called but the call failed, so rule-based orders stand in.",
      );
      expect(chiefSourceNote({ source: "template", reason: "fake mode" })).toBe(
        "Rule-based orders: no recording for this moment, and no model was called.",
      );
    });
  });

  it("says when the Chief did not answer, and offers a retry", () => {
    const out = html({ status: "error", seq: 0, message: "HTTP 500" });
    expect(out).toContain("The Chief didn&#x27;t answer: HTTP 500");
    expect(out).toContain(">Retry<");
  });
});

describe("the crew's plan on the run (#19 into #20)", () => {
  const demo = CrewPlan.parse(crewF1.replies.find((r) => r.id === "dock-wait")!.plan);

  it("is carried from the Plan screen through storage, and refused when it no longer parses", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveCrewPlan("F1", { plan: demo, recorded: true }, storage);
    expect(loadCrewPlan("F1", storage)).toEqual({ plan: demo, recorded: true });
    store.set(crewPlanKey("F1"), JSON.stringify({ plan: { steps: [] } }));
    expect(loadCrewPlan("F1", storage)).toBeNull();
    expect(loadCrewPlan("F2", storage)).toBeNull();
  });

  it("marks the crew's steps as the run follows them, and shows the skipped wait as next on beat 5's trip", () => {
    const labels = (run: RunState) => crewPlanSteps(placed, run, demo).map((s) => s.state);
    const run = createRun(placed.level);
    expect(crewPlanSteps(placed, run, demo).map((s) => s.label)).toEqual(demo.steps.map((s) => s.action));
    expect(labels(run)).toEqual(["done", "next", "todo", "todo"]);
    // The judge walks straight in, skipping the wait: the wait is still the next step.
    expect(labels(tripped())).toEqual(["done", "next", "todo", "todo"]);
    const waited = play(run, [{ kind: "move", to: F1_DEMO.freightLiftWait }, wait]);
    expect(labels(waited)).toEqual(["done", "done", "next", "todo"]);
  });
});
