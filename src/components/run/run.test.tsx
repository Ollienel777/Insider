// The run board's model and render on the cached F1 level (data/levels/F1.romaine-1974.json)
// placed on the F1 fixture floor, as the Run screen places it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type AlarmState } from "@/domain";
import { act, createRun, moveGuards, neighbours, type Action, type RunState } from "@/engine";
import { sightingsAt } from "@/engine/vision";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import cachedF2 from "../../../data/levels/F2.sunset-1986.json";
import cachedF3 from "../../../data/levels/F3.night-desk.json";
import { ALARM_STYLE, AlarmBanner } from "./alarm-banner";
import {
  actionForKey,
  cameraMount,
  choices,
  cones,
  coverage,
  describeTurn,
  guardOrders,
  NO_SPRINT_STATUS,
  planSteps,
  SPRINT_STATUS,
  sprintChoices,
  toggleSprint,
  WALK_STATUS,
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

  it("offer, in sprint mode, every node two open hops away and no neighbour, each a sprint the engine takes (#121)", () => {
    // From the start the one neighbour is the freight lift lobby, so the only sprint is on to the dock corridor.
    expect(sprintChoices(start()).map((c) => [c.key, c.nodeId, c.kind, c.via])).toEqual([[1, "dc-west", "sprint", F1_DEMO.freightLiftWait]]);
    expect(choices(start(), "sprint")).toEqual(sprintChoices(start()));

    // From every node on F1, as the board stands at the start (both doors locked) and with both picked.
    const base = start();
    const states = [base, { ...base, locked: [] }].flatMap((s) => [...s.board.nodes.keys()].map((id) => ({ ...s, playerNode: id })));
    const offered = { locked: 0, open: 0 };
    for (const state of states) {
      const here = state.board.nodes.get(state.playerNode)!;
      const adjacent = new Set(neighbours(state.board, state.playerNode).map((e) => e.to));
      const sprints = sprintChoices(state);
      offered[state.locked.length > 0 ? "locked" : "open"] += sprints.length;
      expect(sprints.map((c) => c.key)).toEqual(sprints.map((_, i) => i + 1));
      // Clockwise on screen from twelve o'clock, as moves are numbered.
      const bearing = (id: string) => {
        const from = project(here.x, here.y);
        const n = state.board.nodes.get(id)!;
        const to = project(n.x, n.y);
        const a = Math.atan2(to.x - from.x, -(to.y - from.y));
        return a < 0 ? a + 2 * Math.PI : a;
      };
      const bearings = sprints.map((c) => bearing(c.nodeId));
      expect(bearings, `order from ${state.playerNode}`).toEqual([...bearings].sort((a, b) => a - b));
      for (const c of sprints) {
        expect(adjacent.has(c.nodeId), `${c.nodeId} from ${state.playerNode} is a neighbour`).toBe(false);
        expect(c.nodeId).not.toBe(state.playerNode);
        expect(adjacent.has(c.via!), `${c.via} is a neighbour of ${state.playerNode}`).toBe(true);
        const result = act(state, c.action);
        expect(result.ok, `${state.playerNode} → ${c.nodeId}: ${result.ok ? "" : result.reason}`).toBe(true);
        if (!result.ok) continue;
        expect(result.run.turns.at(-1)!.player.kind).toBe("sprint");
        // Being seen on the way can raise the alarm to Alert within the turn, and a guard at Alert catches
        // the player on the middle node (the sprint stops there) or on the target; otherwise it lands.
        if (result.run.status === "caught") expect([c.via, c.nodeId]).toContain(result.run.playerNode);
        else expect(result.run.playerNode, `${state.playerNode} → ${c.nodeId}`).toBe(c.nodeId);
        // The way runs through the first open neighbour, clockwise from twelve o'clock, that leads to the target.
        const opens = (doorId: string | undefined) => doorId === undefined || !state.locked.includes(doorId);
        const leads = neighbours(state.board, state.playerNode)
          .filter((e) => opens(e.doorId) && neighbours(state.board, e.to).some((f) => f.to === c.nodeId && opens(f.doorId)))
          .map((e) => e.to);
        const firstClockwise = [...leads].sort((a, b) => bearing(a) - bearing(b) || a.localeCompare(b))[0];
        expect(c.via, `via for ${state.playerNode} → ${c.nodeId}`).toBe(firstClockwise);
      }
    }
    // 84 sprints from F1's 30 nodes with both doors locked (the PR 123 review's count), and 94 with them open.
    expect(offered).toEqual({ locked: 84, open: 94 });
  });

  it("leave out a neighbour that is also two hops away, as in a triangle", () => {
    // S2's three nodes form a triangle: from s2-e, s2-s is two hops through s2-nw, but it is a neighbour.
    const run = { ...start(), playerNode: "s2-e" };
    expect(choices(run).map((c) => c.nodeId)).toContain("s2-s");
    expect(sprintChoices(run).map((c) => c.nodeId)).toEqual(["mc-3"]);
    // The Open Office: o-north, o-south and o-west form one too.
    const office = { ...start(), playerNode: "o-north" };
    expect(sprintChoices(office).length).toBeGreaterThan(0);
    expect(sprintChoices(office).map((c) => c.nodeId)).not.toContain("o-south");
    expect(sprintChoices(office).map((c) => c.nodeId)).not.toContain("o-west");
  });

  it("number the sprints clockwise, as moves are", () => {
    const run = { ...start(), playerNode: "mc-3" };
    expect(sprintChoices(run).map((c) => [c.key, c.nodeId, c.via])).toEqual([
      [1, "o-south", "mc-4"],
      [2, "mc-e", "mc-4"],
      [3, "s2-e", "s2-nw"],
      [4, "s2-s", "s2-nw"],
      [5, "s1-ne", "mc-2"],
      [6, "mc-1", "mc-2"],
      [7, "el-south", "mc-2"],
    ]);
  });

  it.each([
    ["F1", cached],
    ["F2", cachedF2],
    ["F3", cachedF3],
  ] as const)("label every sprint badge on %s truthfully: \"within\" a room only when all three nodes are in it", (id, level) => {
    const floorPlaced = placeLevel(LevelManifest.parse(structuredClone(level)), structuredClone(FIXTURE_FLOORS[id]), RUN_SEED);
    const { floor } = floorPlaced.level;
    const roomOf = (nodeId: string) => floor.nodes.find((n) => n.id === nodeId)!.roomId;
    const label = (roomId: string) => floor.rooms.find((r) => r.id === roomId)!.label;
    const base = createRun(floorPlaced.level);
    const states = [base, { ...base, locked: [] }].flatMap((s) => [...s.board.nodes.keys()].map((n) => ({ ...s, playerNode: n })));
    const unescape = (t: string) => t.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
    let checked = 0;
    for (const state of states) {
      const sprints = choices(state, "sprint");
      if (sprints.length === 0) continue;
      const out = renderToStaticMarkup(<BoardView placed={floorPlaced} run={state} choices={sprints} onChoose={() => {}} />);
      for (const c of sprints) {
        const m = out.match(new RegExp(`aria-label="([^"]*)" data-testid="choice" data-key="${c.key}" data-node="${c.nodeId}"`));
        expect(m, `badge for ${state.playerNode} → ${c.nodeId}`).not.toBeNull();
        const text = unescape(m![1]);
        const [h, v, t] = [roomOf(state.playerNode), roomOf(c.via!), roomOf(c.nodeId)];
        const why = `${state.playerNode} (${h}) → ${c.via} (${v}) → ${c.nodeId} (${t}): ${text}`;
        expect(text.startsWith(`Sprint to ${label(t)}, `), why).toBe(true);
        if (h === v && v === t) expect(text, why).toContain(`two hops within ${label(t)}`);
        else expect(text, why).not.toContain("within");
        if (v !== t) expect(text, why).toContain(`, through ${label(v)}, `);
        else if (h !== t) expect(text, why).toContain(`, two hops from ${label(h)}, `);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    // It draws the board once for every node of the floor, twice over: about 4 s on its own on a
    // laptop, and past the default 5 s when the whole suite runs beside it. The budget is for that.
  }, 30_000);

  it("make S sprint, S again walk, and S with nowhere to sprint stay walking and say why", () => {
    expect(toggleSprint(start(), "walk")).toEqual({ mode: "sprint", status: SPRINT_STATUS });
    expect(toggleSprint(start(), "sprint")).toEqual({ mode: "walk", status: WALK_STATUS });
    // The server rack's one way out is through the locked server closet door.
    const shut = { ...start(), playerNode: "sc-rack" };
    expect(sprintChoices(shut)).toEqual([]);
    expect(toggleSprint(shut, "walk")).toEqual({ mode: "walk", status: NO_SPRINT_STATUS });
    let won = start();
    for (const step of QUIET_ROUTE) won = press(won, [keyOf(won, step)]);
    expect(toggleSprint(won, "walk")).toBeNull();
  });

  // The real one-line check is the sprint smoke test at 1440×900; this keeps the text from growing past it.
  it("keep the sprint status line true for every sprint, and short enough for one line", () => {
    expect(SPRINT_STATUS).not.toMatch(/room/i);
    expect(SPRINT_STATUS.length).toBeLessThanOrEqual(60);
    expect(SPRINT_STATUS).toContain("S or Esc to walk");
  });

  it("make a sprint a guard can hear raise Suspicious, as noise, and log it as a sprint for the Debrief", () => {
    // Along the quiet route, the first offered sprint a guard is close enough to hear.
    let run = start();
    let heard: RunState | null = null;
    for (const step of QUIET_ROUTE) {
      for (const c of sprintChoices(run)) {
        const result = act(run, c.action);
        if (result.ok && result.run.alarmEvents.some((e) => e.cause.kind === "noise")) {
          heard = result.run;
          break;
        }
      }
      if (heard || run.status !== "playing") break;
      run = press(run, [keyOf(run, step)]);
    }
    expect(heard, "some sprint on the quiet route is within a guard's hearing").not.toBeNull();
    const event = heard!.alarmEvents.find((e) => e.cause.kind === "noise")!;
    expect(event.to).toBe("suspicious");
    expect(heard!.turns.at(-1)!.player.kind).toBe("sprint");
  });

  it("leave a node behind a locked door out of the sprints until the door is open", () => {
    let run = start();
    for (const step of QUIET_ROUTE.slice(0, 4)) run = press(run, [keyOf(run, step)]);
    expect(run.playerNode).toBe("dc-mid");
    expect(sprintChoices(run).map((c) => c.nodeId)).not.toContain("rr-door");
    run = press(run, [keyFor(run, "dc-east")]);
    const pick = String(choices(run).find((c) => c.kind === "pick")!.key);
    run = press(run, [pick, pick, keyFor(run, "dc-mid")]);
    expect(sprintChoices(run).map((c) => c.nodeId)).toContain("rr-door");
  });

  it("map a number in sprint mode to that sprint, and say so in the turn's line", () => {
    const run = start();
    const action = actionForKey("1", run, "sprint");
    expect(action).toEqual({ kind: "sprint", to: "dc-west", via: F1_DEMO.freightLiftWait });
    expect(actionForKey("2", run, "sprint")).toBeNull();
    const after = play(run, [action!]);
    expect(after.playerNode).toBe("dc-west");
    expect(describeTurn(placed, run, after)).toBe("You sprint to the Dock Corridor.");
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
    const out = renderToStaticMarkup(<RunScreen building={{ id: "F1", name: "Halvorsen Tower" }} manifest={manifest} source="fixture" />);
    expect(out).toContain('data-testid="board-skeleton"');
    expect(out).toContain('data-testid="panel-skeleton"');
  });

  it("says when a building has no level yet", () => {
    const out = renderToStaticMarkup(<RunScreen building={{ id: "F2", name: "Figueroa Exchange" }} manifest={null} source="fixture" />);
    expect(out).toContain('data-testid="board-empty"');
    expect(out).toContain("Back to the map");
  });

  it("pulses nothing when no board is coming: the panel says what would be there (#68)", () => {
    const out = renderToStaticMarkup(<RunScreen building={{ id: "F2", name: "Figueroa Exchange" }} manifest={null} source="fixture" />);
    expect(out).not.toContain("animate-pulse");
    expect(out).not.toContain('data-testid="panel-skeleton"');
    expect(out).toContain('data-testid="panel-empty"');
  });
});
