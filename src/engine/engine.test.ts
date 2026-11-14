// The turn engine on the real F1 floor (fixtures/floors/F1.json) and on a
// small hand-made floor for the corner cases.
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { RunLog, type FloorGraph } from "@/domain";
import {
  act,
  createRun,
  LevelError,
  orderGuard,
  setAlarm,
  shortestPath,
  toRunLog,
  type Action,
  type Level,
  type RunState,
} from "@/engine";

const F1 = FIXTURE_FLOORS.F1;

/** F1's floor 22 as the placer might set it: dock in, records room, two guards. */
function f1Level(overrides: Partial<Level> = {}): Level {
  return {
    buildingId: "F1",
    missionId: "romaine-1974",
    seed: 42,
    floor: F1,
    start: F1_DEMO.dockEntry,
    objective: F1_DEMO.objective,
    exits: [F1_DEMO.dockEntry, F1_DEMO.roofEntry],
    lockedDoors: [F1_DEMO.recordsDoor],
    pickTurns: 2,
    patrolTempo: 1,
    guards: [
      { id: "G1", patrol: ["mc-w", "mc-e"] },
      { id: "G2", patrol: ["o-west", "o-north", "o-east", "o-southeast", "o-south"] },
    ],
    zones: {
      records: ["rr-door", "rr-files"],
      dock: [...F1_DEMO.c2Cover],
      "east-stair": [F1_DEMO.roofEntry],
    },
    ...overrides,
  };
}

/** Plays every action, failing the test on the first refusal. */
function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}

/** The reason `action` is refused; fails the test if it is accepted. */
function refusal(run: RunState, action: Action): string {
  const result = act(run, action);
  if (result.ok) throw new Error(`${JSON.stringify(action)} was accepted`);
  return result.reason;
}

const where = (run: RunState, guardId: string) => run.guards.find((g) => g.id === guardId)!.nodeId;

/** Hop distances from `from` by breadth-first search, independent of the engine. */
function bfs(floor: FloorGraph, from: string): Map<string, number> {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const e of floor.edges) {
      const to = e.a === at ? e.b : e.b === at ? e.a : null;
      if (to !== null && !dist.has(to)) {
        dist.set(to, dist.get(at)! + 1);
        queue.push(to);
      }
    }
  }
  return dist;
}

/** The demo heist on F1: in by the dock, pick the records door, take the files, out by the dock. */
const HEIST: readonly Action[] = [
  { kind: "move", to: "fl-lobby" },
  { kind: "sprint", to: "dc-mid", via: "dc-west" },
  { kind: "move", to: "dc-east" },
  { kind: "pick", doorId: F1_DEMO.recordsDoor },
  { kind: "pick", doorId: F1_DEMO.recordsDoor },
  { kind: "move", to: "rr-door" },
  { kind: "move", to: F1_DEMO.objective },
  { kind: "take" },
  { kind: "move", to: "rr-door" },
  { kind: "move", to: "dc-east" },
  { kind: "sprint", to: "dc-west" },
  { kind: "wait" },
  { kind: "move", to: "fl-lobby" },
  { kind: "move", to: F1_DEMO.dockEntry },
];

describe("determinism", () => {
  it("gives identical logs for the same seed and actions", () => {
    const first = toRunLog(play(createRun(f1Level()), HEIST));
    const second = toRunLog(play(createRun(f1Level()), HEIST));
    expect(second).toEqual(first);
    expect(first.turns).toHaveLength(HEIST.length);
  });

  it("writes a log that parses as a RunLog, one entry per turn", () => {
    const run = play(createRun(f1Level()), HEIST.slice(0, 3));
    const log = RunLog.parse(toRunLog(run));
    expect(log.seed).toBe(42);
    expect(log.turns.map((t) => t.player)).toEqual([
      { kind: "move", nodeId: "fl-lobby" },
      { kind: "sprint", nodeId: "dc-mid" },
      { kind: "move", nodeId: "dc-east" },
    ]);
    expect(log.turns[0].guards).toEqual([
      { guardId: "G1", nodeId: "mc-1" },
      { guardId: "G2", nodeId: "o-north" },
    ]);
    expect(log.turns.every((t) => t.alarm === "calm")).toBe(true);
  });

  it("never changes the state it is given", () => {
    const start = createRun(f1Level());
    const snapshot = structuredClone(start);
    play(start, HEIST);
    expect(start).toEqual(snapshot);
  });
});

describe("illegal actions are refused with a reason", () => {
  const start = createRun(f1Level());
  const atRecordsDoor = play(start, HEIST.slice(0, 3)); // on dc-east, records door locked

  it("refuses a move to a node that is not a neighbour", () => {
    expect(refusal(start, { kind: "move", to: "dc-mid" })).toBe('"dc-mid" is not a neighbour of "fl-car"');
  });

  it("refuses a move through a locked door", () => {
    expect(refusal(atRecordsDoor, { kind: "move", to: "rr-door" })).toBe(
      'door "d-records-room" is locked; pick it first',
    );
  });

  it("opens the door after pickTurns consecutive picks, not before", () => {
    const once = play(atRecordsDoor, [{ kind: "pick", doorId: F1_DEMO.recordsDoor }]);
    expect(refusal(once, { kind: "move", to: "rr-door" })).toMatch(/locked/);
    const twice = play(once, [{ kind: "pick", doorId: F1_DEMO.recordsDoor }]);
    expect(play(twice, [{ kind: "move", to: "rr-door" }]).playerNode).toBe("rr-door");
  });

  it("restarts the pick when another action interrupts it", () => {
    const interrupted = play(atRecordsDoor, [
      { kind: "pick", doorId: F1_DEMO.recordsDoor },
      { kind: "wait" },
      { kind: "pick", doorId: F1_DEMO.recordsDoor },
    ]);
    expect(refusal(interrupted, { kind: "move", to: "rr-door" })).toMatch(/locked/);
  });

  it("refuses to pick a door that is not here, or not locked", () => {
    expect(refusal(start, { kind: "pick", doorId: F1_DEMO.recordsDoor })).toBe(
      'door "d-records-room" is not on an edge out of "fl-car"',
    );
    const lobby = play(start, [{ kind: "move", to: "fl-lobby" }]);
    expect(refusal(lobby, { kind: "pick", doorId: "d-freight-lobby" })).toBe('door "d-freight-lobby" is not locked');
  });

  it("refuses a sprint that is not two open hops", () => {
    expect(refusal(start, { kind: "sprint", to: "fl-lobby" })).toMatch(/is a neighbour.*move there instead/);
    expect(refusal(start, { kind: "sprint", to: "dc-mid" })).toBe('"dc-mid" is not two open hops from "fl-car"');
    expect(refusal(start, { kind: "sprint", to: "dc-west", via: "dc-mid" })).toMatch(/cannot be reached through/);
    const dcMid = play(start, HEIST.slice(0, 2));
    expect(refusal(dcMid, { kind: "sprint", to: "rr-door" })).toMatch(/not two open hops/);
  });

  it("refuses to take the objective from the wrong node, or twice", () => {
    expect(refusal(start, { kind: "take" })).toBe('the objective is not at "fl-car"');
    const taken = play(start, HEIST.slice(0, 8));
    expect(refusal(taken, { kind: "take" })).toBe("the objective is already taken");
  });

  it("refuses an action kind it does not know", () => {
    expect(refusal(start, { kind: "teleport" } as unknown as Action)).toBe('unknown action "teleport"');
  });
});

describe("guards", () => {
  it("walk their patrol loop one hop per turn at tempo 1", () => {
    let run = createRun(f1Level());
    const g2: string[] = [];
    for (let i = 0; i < 6; i++) {
      run = play(run, [{ kind: "wait" }]);
      g2.push(where(run, "G2"));
    }
    expect(g2).toEqual(["o-north", "o-east", "o-southeast", "o-south", "o-west", "o-north"]);
  });

  it("walk the shortest path between waypoints that are not neighbours, and back", () => {
    let run = createRun(f1Level());
    const g1: string[] = [];
    for (let i = 0; i < 8; i++) {
      run = play(run, [{ kind: "wait" }]);
      g1.push(where(run, "G1"));
    }
    expect(g1).toEqual(["mc-1", "mc-2", "mc-3", "mc-4", "mc-e", "mc-4", "mc-3", "mc-2"]);
  });

  it("hop once every patrolTempo turns", () => {
    let run = createRun(f1Level({ patrolTempo: 2 }));
    const g2: string[] = [];
    for (let i = 0; i < 6; i++) {
      run = play(run, [{ kind: "wait" }]);
      g2.push(where(run, "G2"));
    }
    expect(g2).toEqual(["o-west", "o-north", "o-north", "o-east", "o-east", "o-southeast"]);
  });

  it("reach an ordered zone by a shortest path, one hop per turn, and hold there", () => {
    const ordered = orderGuard(createRun(f1Level()), "G1", "records");
    if (!ordered.ok) throw new Error(ordered.reason);
    const distance = bfs(F1, "mc-w");
    const hops = Math.min(distance.get("rr-door")!, distance.get("rr-files")!);

    let run = ordered.run;
    const route = ["mc-w"];
    for (let i = 0; i < hops + 2; i++) {
      run = play(run, [{ kind: "wait" }]);
      route.push(where(run, "G1"));
    }
    // Every hop is one step closer to the zone: a shortest path.
    const toZone = bfs(F1, "rr-door");
    route.slice(0, hops + 1).forEach((node, i) => expect(toZone.get(node)).toBe(hops - i));
    expect(route.slice(hops)).toEqual(["rr-door", "rr-door", "rr-door"]);
  });

  it("go back to their patrol when the order is cleared", () => {
    const sent = orderGuard(createRun(f1Level()), "G1", "records");
    if (!sent.ok) throw new Error(sent.reason);
    const away = play(sent.run, [{ kind: "wait" }, { kind: "wait" }]);
    const cleared = orderGuard(away, "G1", null);
    if (!cleared.ok) throw new Error(cleared.reason);
    expect(cleared.run.guards[0].target).toBeNull();
    expect(where(play(cleared.run, [{ kind: "wait" }]), "G1")).toBe("mc-1");
  });

  it("refuse an order naming an unknown guard or zone", () => {
    const run = createRun(f1Level());
    expect(orderGuard(run, "G9", "records")).toEqual({ ok: false, reason: 'no guard "G9"' });
    expect(orderGuard(run, "G1", "vault")).toEqual({ ok: false, reason: 'no zone "vault"' });
  });
});

describe("shortestPath", () => {
  it("matches the breadth-first distance between every pair of F1 nodes, for several seeds", () => {
    for (const seed of [0, 1, 42, -7]) {
      const board = createRun(f1Level({ seed })).board;
      for (const a of F1.nodes) {
        const distance = bfs(F1, a.id);
        for (const b of F1.nodes) {
          const path = shortestPath(board, a.id, [b.id])!;
          expect(path.length - 1).toBe(distance.get(b.id));
          expect(path[0]).toBe(a.id);
          expect(path.at(-1)).toBe(b.id);
        }
      }
    }
  });

  it("returns null when no goal can be reached", () => {
    const board = createRun(f1Level()).board;
    expect(shortestPath(board, "dc-east", ["rr-door"], (e) => e.doorId !== F1_DEMO.recordsDoor)).toBeNull();
  });
});

describe("win and lose", () => {
  it("ends as a win when the player takes the objective and reaches an exit", () => {
    const run = play(createRun(f1Level()), HEIST);
    expect(run.status).toBe("won");
    expect(run.carrying).toBe(true);
    expect(refusal(run, { kind: "wait" })).toBe("the run is over: won");
  });

  it("does not win on an exit without the objective", () => {
    const run = play(createRun(f1Level()), [{ kind: "move", to: "fl-lobby" }, { kind: "move", to: "fl-car" }]);
    expect(run.status).toBe("playing");
  });

  // A floor of four nodes in a line, with one guard pacing n2 ↔ n3.
  const line: FloorGraph = {
    nodes: ["n0", "n1", "n2", "n3"].map((id, i) => ({ id, x: i, y: 0, roomId: "hall", tags: [] })),
    edges: [
      { a: "n0", b: "n1" },
      { a: "n1", b: "n2" },
      { a: "n2", b: "n3" },
    ],
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: 4, h: 1 } }],
    sightlines: {},
    source: "fixture",
  };
  const lineLevel = (): Level => ({
    buildingId: "T",
    missionId: "t",
    seed: 1,
    floor: line,
    start: "n0",
    objective: "n3",
    exits: ["n0"],
    lockedDoors: [],
    pickTurns: 2,
    patrolTempo: 1,
    guards: [{ id: "G1", patrol: ["n2", "n3"] }],
  });

  it("ends as caught when a guard steps onto the player during Alert", () => {
    // Turn 1: the player reaches n1, the guard goes n2 → n3. Turn 2: the guard comes back to n2.
    const alert = setAlarm(play(createRun(lineLevel()), [{ kind: "move", to: "n1" }]), "alert");
    const run = play(alert, [{ kind: "move", to: "n2" }]);
    expect(where(run, "G1")).toBe("n2");
    expect(run.status).toBe("caught");
    expect(run.turns.at(-1)!.alarm).toBe("alert");
  });

  it("ends as caught when the player steps onto a guard during Alert", () => {
    const run = play(setAlarm(createRun(lineLevel()), "alert"), [{ kind: "sprint", to: "n2" }]);
    expect(run.status).toBe("caught");
  });

  it("is not caught on a guard's node while the alarm is below Alert", () => {
    const suspicious = setAlarm(createRun(lineLevel()), "suspicious");
    expect(play(suspicious, [{ kind: "sprint", to: "n2" }]).status).toBe("playing");
  });

  it("ends as caught when the alarm reaches Alert with the player on a guard's node", () => {
    const together = play(createRun(lineLevel()), [{ kind: "sprint", to: "n2" }, { kind: "wait" }]);
    expect(where(together, "G1")).toBe("n2");
    expect(setAlarm(together, "alert").status).toBe("caught");
  });
});

describe("level checks", () => {
  it("rejects a level that names a node or door the floor does not have", () => {
    expect(() => createRun(f1Level({ start: "vault" }))).toThrow(LevelError);
    expect(() => createRun(f1Level({ lockedDoors: ["d-nowhere"] }))).toThrow(/not a door of the floor/);
    expect(() => createRun(f1Level({ lockedDoors: ["d-freight-lobby"] }))).toThrow(/not lockable/);
    expect(() => createRun(f1Level({ guards: [{ id: "G1", patrol: [] }] }))).toThrow(/empty patrol/);
    expect(() => createRun(f1Level({ patrolTempo: 0 }))).toThrow(/patrolTempo/);
  });
});
