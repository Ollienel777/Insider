// Where the corner map sends the player next (issue 115), on F1 as the Run
// screen places it: the level's own plan, and the crew's briefed one.
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { CrewPlan, LevelManifest } from "@/domain";
import { act, createRun, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../../data/levels/F1.romaine-1974.json";
import crewF1 from "../../../../fixtures/llm/crew-F1.json";
import { RUN_SEED } from "../run-screen";
import { routePoints } from "./minimap";
import { nextWaypoint } from "./waypoint";
import { buildWorld, groundOf } from "./world";

const placed = placeLevel(LevelManifest.parse(structuredClone(cached)), structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const demo = CrewPlan.parse(crewF1.replies.find((r) => r.id === "dock-wait")!.plan);
/** Plays `actions` in order, stopping where the run ends; a refused action fails the test. */
function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    if (state.status !== "playing") return state;
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}
const wait: Action = { kind: "wait" };
const last = <T>(xs: readonly T[]) => xs[xs.length - 1];

/** F1's quiet route (run.spec.ts) up to the files, taken. */
const QUIET_IN: Action[] = [
  { kind: "move", to: "fl-lobby" },
  wait,
  { kind: "move", to: "dc-west" },
  { kind: "move", to: "dc-mid" },
  { kind: "move", to: "dc-east" },
  { kind: "pick", doorId: "d-records-room" },
  { kind: "pick", doorId: "d-records-room" },
  { kind: "move", to: "rr-door" },
  { kind: "move", to: "rr-files" },
  { kind: "take" },
];

describe("the next waypoint in first person (issue 115)", () => {
  it("heads for the objective through its locked door, then for the nearest exit once it is taken", () => {
    const start = createRun(placed.level);
    const before = nextWaypoint(placed, start)!;
    expect(before.kind).toBe("objective");
    expect(before.route[0]).toBe(start.playerNode);
    expect(last(before.route)).toBe(placed.level.objective);
    // Locks are ignored: the way in is through the records room's door, which is the one to pick.
    expect(before.route).toContain("rr-door");

    const taken = play(start, QUIET_IN);
    expect(taken.carrying).toBe(true);
    const out = nextWaypoint(placed, taken)!;
    expect(out.kind).toBe("exit");
    expect(placed.level.exits).toContain(last(out.route));
  });

  it("has nothing to point at once the run is over", () => {
    const caught = play(createRun(placed.level), [{ kind: "move", to: F1_DEMO.freightLiftWait }, { kind: "move", to: "dc-west" }, ...Array(12).fill(wait)]);
    expect(caught.status).not.toBe("playing");
    expect(nextWaypoint(placed, caught)).toBeNull();
  });

  it("follows the crew's plan: its wait keeps the player where they are, its objective step heads for the files", () => {
    const start = createRun(placed.level);
    // The plan's next step is the wait at the freight lift: the route is the node the player is on.
    const waiting = nextWaypoint(placed, start, demo)!;
    expect(waiting.kind).toBe("step");
    expect(placed.level.zones?.[demo.steps[1].zoneId]).toContain(last(waiting.route));
    // Once waited, the objective step: the files themselves, not just their zone.
    const waited = play(start, [{ kind: "move", to: F1_DEMO.freightLiftWait }, wait]);
    const toFiles = nextWaypoint(placed, waited, demo)!;
    expect(toFiles.kind).toBe("objective");
    expect(last(toFiles.route)).toBe(placed.level.objective);
    // The last step is out, by the nearest exit.
    const out = nextWaypoint(placed, play(start, QUIET_IN), demo)!;
    expect(out.kind).toBe("exit");
  });

  it("draws the route through each doorway, from the player's node to the goal", () => {
    const ground = groundOf(buildWorld(placed.level.floor));
    const route = nextWaypoint(placed, createRun(placed.level))!.route;
    const points = routePoints(ground, route);
    const at = (id: string) => ground.nodes.get(id)!;
    expect(points[0]).toEqual({ x: at(route[0]).x, y: at(route[0]).y });
    expect(last(points)).toEqual({ x: at(last(route)).x, y: at(last(route)).y });
    // Every node on the route is a point of it, and doorways add points between rooms.
    for (const id of route) expect(points).toContainEqual({ x: at(id).x, y: at(id).y });
    expect(points.length).toBeGreaterThan(route.length);
    expect(routePoints(ground, [])).toEqual([]);
  });
});
