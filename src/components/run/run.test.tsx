// The run board's model and render on the cached F1 level (data/levels/F1.romaine-1974.json)
// placed on the F1 fixture floor, as the Run screen places it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type AlarmState } from "@/domain";
import { act, createRun, moveGuards, type Action, type RunState } from "@/engine";
import { sightingsAt } from "@/engine/vision";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { ALARM_STYLE, AlarmBanner } from "./alarm-banner";
import {
  actionForKey,
  cameraMount,
  choices,
  cones,
  coverage,
  describeTurn,
  guardOrders,
  planSteps,
} from "./board";
import { BoardView } from "./board-view";
import { frameOf, hull, project } from "./iso";
import { RUN_SEED, RunScreen } from "./run-screen";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const start = () => createRun(placed.level);

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action, i) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`action ${i} (${JSON.stringify(action)}) refused: ${result.reason}`);
    return result.run;
  }, run);
}

/** Presses `keys` in turn, as the Run screen does; a key that does nothing fails the test. */
function press(run: RunState, keys: readonly string[]): RunState {
  return keys.reduce((state, key) => {
    const action = actionForKey(key, state);
    if (!action) throw new Error(`key "${key}" does nothing at ${state.playerNode} on turn ${state.turn}`);
    return play(state, [action]);
  }, run);
}

/** The number key for the neighbour `nodeId`. */
const keyFor = (run: RunState, nodeId: string) => {
  const choice = choices(run).find((c) => c.nodeId === nodeId);
  if (!choice) throw new Error(`${nodeId} is not a neighbour of ${run.playerNode}`);
  return String(choice.key);
};

/** The crew's quiet route on F1 (as in placer.test.ts), as the nodes and keys a player uses. */
const QUIET_ROUTE: readonly (string | Action["kind"])[] = [
  F1_DEMO.freightLiftWait,
  "wait",
  "dc-west",
  "dc-mid",
  "dc-east",
  "pick",
  "pick",
  "rr-door",
  F1_DEMO.objective,
  "take",
  "rr-door",
  "dc-east",
  "wait",
  "dc-mid",
  "dc-west",
  F1_DEMO.freightLiftWait,
  F1_DEMO.dockEntry,
];

function keyOf(run: RunState, step: string): string {
  if (step === "wait") return "w";
  if (step === "take") return " ";
  if (step === "pick") return String(choices(run).find((c) => c.kind === "pick")!.key);
  return keyFor(run, step);
}

describe("the projection", () => {
  it("puts the floor's x axis down-right and its y axis down-left, and frames every node", () => {
    expect(project(0, 0)).toEqual({ x: 0, y: 0 });
    const east = project(1, 0);
    const south = project(0, 1);
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeGreaterThan(0);
    expect(south.x).toBeLessThan(0);
    expect(south.y).toBeGreaterThan(0);
    const frame = frameOf(placed.level.floor);
    for (const n of placed.level.floor.nodes) {
      const p = project(n.x, n.y);
      expect(p.x).toBeGreaterThan(frame.minX);
      expect(p.x).toBeLessThan(frame.minX + frame.width);
      // Room above each node for a standing piece.
      expect(p.y - 48).toBeGreaterThanOrEqual(frame.minY);
    }
  });

  it("hulls a set of points", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 1, y: 1 },
    ];
    expect(hull(square)).toHaveLength(4);
    expect(hull(square)).not.toContainEqual({ x: 1, y: 1 });
  });
});

describe("cones", () => {
  it("show exactly the nodes on which the engine would see the player this turn, after the guards' move included", () => {
    let run = start();
    const route = QUIET_ROUTE.slice(0, 9);
    for (let i = 0; i <= route.length; i++) {
      const covered = coverage(run);
      // The engine's two looks (actions.ts): as the player lands, then once the guards have moved.
      const moved = { guards: moveGuards(run.board, run.guards), cleaners: moveGuards(run.board, run.cleaners) };
      for (const node of placed.level.floor.nodes) {
        const engine = new Set([
          ...sightingsAt(run.board, run, node.id, run.turn).map((s) => s.id),
          ...sightingsAt(run.board, moved, node.id, null).map((s) => s.id),
        ]);
        expect([...(covered.get(node.id) ?? [])].sort(), `turn ${run.turn} ${node.id}`).toEqual([...engine].sort());
      }
      if (i < route.length) run = press(run, [keyOf(run, route[i])]);
    }
  });

  it("are right about every step: a neighbour drawn as safe is never seen, and one drawn as covered always is", () => {
    // Every move and wait from every node the player can reach unseen in 20 turns, played for real by the
    // engine. Unseen, the guards' moves depend only on the turn, so one run per node per turn covers them all.
    let frontier = [start()];
    let checked = 0;
    let seen = 0;
    for (let depth = 0; depth < 20; depth++) {
      const next: RunState[] = [];
      const reached = new Set<string>();
      for (const run of frontier) {
        const covered = coverage(run);
        const steps = [...choices(run).filter((c) => c.kind === "move").map((c) => c.action), { kind: "wait" } as Action];
        for (const action of steps) {
          const after = play(run, [action]);
          const nodeId = action.kind === "move" ? action.to : run.playerNode;
          const detected = after.lastSeen?.turn === run.turn;
          expect(detected, `turn ${run.turn}: ${run.playerNode} → ${nodeId}`).toBe(covered.has(nodeId));
          checked += 1;
          if (detected) seen += 1;
          else if (!reached.has(after.playerNode)) {
            reached.add(after.playerNode);
            next.push(after);
          }
        }
      }
      frontier = next;
    }
    expect(checked).toBeGreaterThan(100);
    expect(seen).toBeGreaterThan(0);
  });

  it("draw a guard's after-move look as its own wedge from the node it moves to", () => {
    const run = start();
    const g2 = cones(run).find((c) => c.id === "G2")!;
    const next = moveGuards(run.board, run.guards).find((g) => g.id === "G2")!;
    expect(g2.after).not.toBeNull();
    const at = run.board.nodes.get(next.nodeId)!;
    expect(g2.after!.origin).toEqual({ x: at.x, y: at.y });
    const out = renderToStaticMarkup(<BoardView placed={placed} run={run} choices={choices(run)} onChoose={() => {}} />);
    expect(out).toMatch(/data-watcher="G2"[^>]*data-after-nodes="[^"]+"/);
    expect(out).toContain('data-testid="cone-after"');
  });

  it("give C2's cone the dock corridor's west node on the turn walking straight in meets it", () => {
    const lobby = press(start(), [keyFor(start(), F1_DEMO.freightLiftWait)]);
    const c2 = cones(lobby).find((c) => c.id === "C2")!;
    expect(c2.kind).toBe("camera");
    expect(c2.nodes).toEqual(["dc-west"]);
    expect(c2.next).toEqual(["dc-mid"]);
    // A cone per camera and guard, and every guard's cone starts on its node.
    expect(cones(lobby).filter((c) => c.kind !== "cleaner").map((c) => c.id)).toEqual(["C1", "C2", "G1", "G2", "G3", "G4"]);
    for (const guard of lobby.guards) {
      const cone = cones(lobby).find((c) => c.id === guard.id)!;
      const node = lobby.board.nodes.get(guard.nodeId)!;
      expect(cone.origin).toEqual({ x: node.x, y: node.y });
    }
  });

  it("hang C2 on the dock corridor's west end wall, looking along it", () => {
    expect(cameraMount(placed.level.floor, F1_DEMO.c2Cover)).toEqual({ x: 9, y: 2 });
  });
});

describe("choices and keys", () => {
  it("number the start's one neighbour 1, and the lobby's two clockwise from twelve o'clock", () => {
    expect(choices(start()).map((c) => [c.key, c.nodeId, c.kind])).toEqual([[1, F1_DEMO.freightLiftWait, "move"]]);
    const lobby = press(start(), ["1"]);
    expect(choices(lobby).map((c) => c.key)).toEqual([1, 2]);
    expect(new Set(choices(lobby).map((c) => c.nodeId))).toEqual(new Set([F1_DEMO.dockEntry, "dc-west"]));
  });

  it("make the neighbour behind a locked door a pick of it, counting the picks", () => {
    const route = QUIET_ROUTE.slice(0, 5);
    let run = start();
    for (const step of route) run = press(run, [keyOf(run, step)]);
    expect(run.playerNode).toBe("dc-east");
    const pick = choices(run).find((c) => c.nodeId === "rr-door")!;
    expect(pick).toMatchObject({ kind: "pick", doorId: F1_DEMO.recordsDoor, progress: { done: 0, of: 2 } });
    run = press(run, [String(pick.key)]);
    expect(choices(run).find((c) => c.nodeId === "rr-door")!.progress).toEqual({ done: 1, of: 2 });
    run = press(run, [String(pick.key)]);
    expect(choices(run).find((c) => c.nodeId === "rr-door")!.kind).toBe("move");
  });

  it("map W to a wait, Space to a take only on the objective, and nothing else", () => {
    const run = start();
    expect(actionForKey("w", run)).toEqual({ kind: "wait" });
    expect(actionForKey("W", run)).toEqual({ kind: "wait" });
    expect(actionForKey(" ", run)).toBeNull();
    expect(actionForKey("9", run)).toBeNull();
    expect(actionForKey("x", run)).toBeNull();
    expect(actionForKey("Enter", run)).toBeNull();
  });

  it("play the crew's quiet route by keys alone, Calm all the way, to a win, and then take no keys", () => {
    let run = start();
    for (const step of QUIET_ROUTE) run = press(run, [keyOf(run, step)]);
    expect(run.status).toBe("won");
    expect(new Set(run.turns.map((t) => t.alarm))).toEqual(new Set<AlarmState>(["calm"]));
    expect(choices(run)).toEqual([]);
    expect(actionForKey("w", run)).toBeNull();
  });
});

describe("beat 5: the judge steps into C2", () => {
  const lobby = press(start(), ["1"]);
  const tripped = press(lobby, [keyFor(lobby, "dc-west")]);

  it("raises Alert on the second key, and says C2 saw them", () => {
    expect(tripped.alarm).toBe("alert");
    expect(tripped.alarmEvents.at(-1)?.cause).toEqual({ kind: "camera", id: "C2" });
    expect(describeTurn(placed, lobby, tripped)).toBe("C2 saw you in the Dock Corridor. The guards are converging.");
  });

  it("sends every guard converging on the corridor, with its next hops toward it", () => {
    const orders = guardOrders(placed, tripped);
    expect(orders.map((o) => o.guardId)).toEqual(["G1", "G2", "G3", "G4"]);
    for (const order of orders) {
      expect(order.intent).toBe("converge");
      expect(order.zone).toBe("Dock Corridor");
      expect(order.path[0]).toBe(tripped.guards.find((g) => g.id === order.guardId)!.nodeId);
      expect(order.path.length).toBeLessThanOrEqual(4);
    }
    expect(guardOrders(placed, lobby)).toEqual([]);
  });
});

describe("the plan", () => {
  it("marks the next step as the run goes", () => {
    const objective = manifest.mission.objective;
    const states = (run: RunState) => planSteps(placed, run, objective).map((s) => s.state);
    let run = start();
    expect(planSteps(placed, run, objective).map((s) => s.label)).toEqual([
      "In by the loading dock",
      "Pick the records room door, 2 turns",
      "Take the files from the records room",
      "Out by the loading dock or the roof hatch",
    ]);
    expect(states(run)).toEqual(["done", "next", "todo", "todo"]);
    for (const step of QUIET_ROUTE.slice(0, 7)) run = press(run, [keyOf(run, step)]);
    expect(states(run)).toEqual(["done", "done", "next", "todo"]);
    for (const step of QUIET_ROUTE.slice(7, 10)) run = press(run, [keyOf(run, step)]);
    expect(states(run)).toEqual(["done", "done", "done", "next"]);
    for (const step of QUIET_ROUTE.slice(10)) run = press(run, [keyOf(run, step)]);
    expect(states(run)).toEqual(["done", "done", "done", "done"]);
  });
});

describe("the board render", () => {
  const html = (run: RunState) =>
    renderToStaticMarkup(<BoardView placed={placed} run={run} choices={choices(run)} onChoose={() => {}} />);

  it("draws every room, node, guard, camera, cone and the player, with the neighbour numbers", () => {
    const out = html(start());
    const count = (testId: string) => out.split(`data-testid="${testId}"`).length - 1;
    expect(count("board-node")).toBe(placed.level.floor.nodes.length);
    expect(count("room-label")).toBe(placed.level.floor.rooms.length);
    expect(count("guard-piece")).toBe(4);
    expect(count("camera-piece")).toBe(2);
    expect(count("player-piece")).toBe(1);
    expect(count("cone")).toBe(cones(start()).length);
    expect(count("choice")).toBe(1);
    expect(out).toContain('aria-label="Move to Freight Lift Lobby (1)"');
    expect(out).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("marks the watched nodes and draws the sighting on the turn C2 trips the alarm", () => {
    const lobby = press(start(), ["1"]);
    expect(html(lobby)).toMatch(/data-node="dc-west" data-watched-by="C2"/);
    expect(html(lobby)).not.toContain('data-testid="sighting"');
    const tripped = press(lobby, [keyFor(lobby, "dc-west")]);
    const out = html(tripped);
    expect(out).toContain('data-alarm="alert"');
    expect(out.split('data-testid="guard-route"').length - 1).toBeGreaterThan(0);
    expect(out).toMatch(/data-watcher="C2"[^>]*>(?:(?!data-testid="cone").)*data-testid="sighting"/s);
  });
});

describe("the alarm banner", () => {
  it.each([
    ["calm", "Calm", "text-text-2"],
    ["suspicious", "Suspicious", "text-warning"],
    ["alert", "Alert", "text-danger"],
    ["lockdown", "Lockdown", "text-danger"],
  ] as const)("shows %s as %s in %s", (alarm, label, colour) => {
    const out = renderToStaticMarkup(<AlarmBanner alarm={alarm} turn={3} />);
    expect(out).toContain(`data-state="${alarm}"`);
    expect(out).toMatch(new RegExp(`class="[^"]*${colour}[^"]*"[^>]*>${label}<`));
    expect(ALARM_STYLE[alarm].text).not.toContain("accent");
  });
});

describe("RunScreen", () => {
  it("renders its loading skeleton before the floor arrives", () => {
    const out = renderToStaticMarkup(<RunScreen building={{ id: "F1", name: "Halvorsen Tower" }} manifest={manifest} />);
    expect(out).toContain('data-testid="board-skeleton"');
    expect(out).toContain('data-testid="panel-skeleton"');
  });

  it("says when a building has no level yet", () => {
    const out = renderToStaticMarkup(<RunScreen building={{ id: "F2", name: "Figueroa Exchange" }} manifest={null} />);
    expect(out).toContain('data-testid="board-empty"');
    expect(out).toContain("Back to the map");
  });

  it("pulses nothing when no board is coming: the panel says what would be there (#68)", () => {
    const out = renderToStaticMarkup(<RunScreen building={{ id: "F2", name: "Figueroa Exchange" }} manifest={null} />);
    expect(out).not.toContain("animate-pulse");
    expect(out).not.toContain('data-testid="panel-skeleton"');
    expect(out).toContain('data-testid="panel-empty"');
  });
});
