// The Chief's request on a board over its limits (#97): it is clamped as it is
// built, and what still cannot fit fails with a plain message the Run screen
// shows as the panel's error, never a parse thrown out of the key handler.
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { ChiefRequest } from "@/agents/chief/request";
import { LevelManifest } from "@/domain";
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { chiefRequest, chiefZones, toEngineOrders } from "./chief-request";
import { RUN_SEED } from "./run-screen";

const base = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const LONG_ID = `zone-${"x".repeat(95)}`;

/** F1 with a zone whose id and name are over the limits, and 70 more zones: 64 is the most a request carries. */
function oversized(): PlacedLevel {
  const nodes = base.level.floor.nodes.map((n) => n.id);
  const extra = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`extra-${i}`, [nodes[i % nodes.length]]]));
  return { ...base, level: { ...base.level, zones: { ...base.level.zones, [LONG_ID]: [nodes[0]], ...extra } } };
}

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}
const tripped = (placed: PlacedLevel) =>
  play(createRun(placed.level), [{ kind: "move", to: F1_DEMO.freightLiftWait }, { kind: "move", to: "dc-west" }]);
const lastEvent = (run: RunState) => run.alarmEvents[run.alarmEvents.length - 1];

describe("the Chief's request over its limits (#97)", () => {
  it("names an over-long zone by an opaque id and clamps its name, and still maps orders back", () => {
    const zones = chiefZones(oversized());
    const id = zones.toChief.get(LONG_ID)!;
    expect(id).toMatch(/^zone-\d+$/);
    expect(zones.toEngine.get(id)).toBe(LONG_ID);
    for (const z of zones.zones) {
      expect(z.id.length, z.id).toBeLessThanOrEqual(64);
      expect(z.name.length, z.name).toBeLessThanOrEqual(80);
      expect(z.name.length).toBeGreaterThan(0);
    }
    expect(zones.zones.find((z) => z.id === id)!.name).toMatch(/…$/);
    const orders = toEngineOrders({ orders: [{ guardId: "G1", intent: "block", zoneId: id }], lockZones: [id], rationale: "x" }, zones);
    expect(orders.orders[0].zoneId).toBe(LONG_ID);
    expect(orders.lockZones).toEqual([LONG_ID]);
  });

  it("carries at most 64 zones, keeping every zone a guard or the last sighting names", () => {
    const placed = oversized();
    const zones = chiefZones(placed);
    expect(zones.zones.length).toBeGreaterThan(64);
    const run = tripped(placed);
    const request = chiefRequest("F1", placed, zones, run, lastEvent(run));
    expect(ChiefRequest.safeParse(request).success).toBe(true);
    expect(request.zones).toHaveLength(64);
    const offered = new Set(request.zones.map((z) => z.id));
    for (const g of request.guards) expect(offered.has(g.zoneId), g.zoneId).toBe(true);
    if (request.lastKnownZone !== null) expect(offered.has(request.lastKnownZone)).toBe(true);
  });

  it("leaves a board within its limits as it was", () => {
    const zones = chiefZones(base);
    const run = tripped(base);
    const request = chiefRequest("F1", base, zones, run, lastEvent(run));
    expect(request.zones).toEqual(zones.zones);
    expect(request.lastKnownZone).toBe("dock-corridor");
  });

  it("carries the mission when given with the building, and none from a bare building id (issue 119)", () => {
    const zones = chiefZones(base);
    const run = tripped(base);
    expect(chiefRequest({ buildingId: "F1", missionId: "romaine-1974" }, base, zones, run, lastEvent(run)).missionId).toBe(
      "romaine-1974",
    );
    expect(chiefRequest({ buildingId: "F1", missionId: null }, base, zones, run, lastEvent(run))).not.toHaveProperty("missionId");
    expect(chiefRequest("F1", base, zones, run, lastEvent(run))).not.toHaveProperty("missionId");
  });

  it("fails with a plain message, not a schema dump, when the request still cannot fit", () => {
    const zones = chiefZones(base);
    const run = tripped(base);
    expect(() => chiefRequest("B".repeat(100), base, zones, run, lastEvent(run))).toThrow(
      "this board doesn't fit the Chief's request (buildingId)",
    );
  });
});
