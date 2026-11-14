// Detection, noise and the alarm states (#12, D10): beat 5 on the real F1
// floor, and the rules on small hand-made floors.
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import type { FloorGraph } from "@/domain";
import {
  act,
  createRun,
  LevelError,
  orderGuard,
  setAlarm,
  toRunLog,
  watched,
  type Action,
  type AlarmEvent,
  type Level,
  type RunState,
} from "@/engine";

const F1 = FIXTURE_FLOORS.F1;

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}

const wait: Action = { kind: "wait" };
const waits = (n: number): Action[] => Array.from({ length: n }, () => wait);
const alarms = (run: RunState) => run.turns.map((t) => t.alarm);

/** Hop distance from each node to the nearest of `goals`, ignoring doors, as guards move. */
function hopsTo(floor: FloorGraph, goals: readonly string[]): Map<string, number> {
  const dist = new Map(goals.map((g) => [g, 0]));
  const queue = [...goals];
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

/**
 * The events must chain (each starts where the last ended, from Calm, and
 * the last ends at the run's alarm), and every change of alarm between
 * logged turns must have an event on that turn.
 */
function expectEventsMatchLog(run: RunState) {
  const events = run.alarmEvents;
  let at = "calm";
  for (const e of events) {
    expect(e.from).toBe(at);
    expect(e.to).not.toBe(e.from);
    at = e.to;
  }
  expect(at).toBe(run.alarm);
  run.turns.forEach((t, i) => {
    const before = i === 0 ? "calm" : run.turns[i - 1].alarm;
    if (t.alarm !== before) expect(events.some((e) => e.turn === t.turn)).toBe(true);
  });
}

// ---- beat 5 on F1 -----------------------------------------------------------

/** F1's floor 22 for beat 5: C2 sweeps the dock corridor, dc-west on odd turns. */
function beat5Level(overrides: Partial<Level> = {}): Level {
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
      { id: "G3", patrol: ["s1-w", "s1-sw", "s1-se", "s1-ne"] },
    ],
    zones: {
      records: ["rr-door", "rr-files"],
      dock: [...F1_DEMO.c2Cover],
      "east-stair": [F1_DEMO.roofEntry],
    },
    // Halves [dc-west] and [dc-mid, dc-east]; phase 1 watches dc-west on odd turns.
    cameras: [{ id: "C2", kind: "analog-sweep", cover: F1_DEMO.c2Cover, phase: 1 }],
    ...overrides,
  };
}

describe("beat 5 on F1: the judge trips C2", () => {
  const toLobby: Action = { kind: "move", to: F1_DEMO.freightLiftWait };
  const intoCorridor: Action = { kind: "move", to: "dc-west" };

  it("puts C2's nearest cover node 2 moves from the dock entry", () => {
    expect(hopsTo(F1, [F1_DEMO.dockEntry]).get("dc-west")).toBe(2);
  });

  it("raises Alert on the turn the player steps into C2's watched cover, with one event", () => {
    const before = play(createRun(beat5Level()), [toLobby]);
    expect(before.alarm).toBe("calm");
    const run = play(before, [intoCorridor]);
    expect(alarms(run)).toEqual(["calm", "alert"]);
    expect(run.alarmEvents).toEqual<AlarmEvent[]>([
      { turn: 1, from: "calm", to: "alert", lastKnownZone: "dock", cause: { kind: "camera", id: "C2" } },
    ]);
    expect(run.status).toBe("playing");
  });

  it("stays Calm when the player waits one turn at the freight lift first, as the crew says", () => {
    const run = play(createRun(beat5Level()), [toLobby, wait, intoCorridor]);
    expect(alarms(run)).toEqual(["calm", "calm", "calm"]);
    expect(run.alarmEvents).toEqual([]);
  });

  it("sends every guard toward the dock on its very next move, with no Chief order", () => {
    const before = play(createRun(beat5Level()), [toLobby]);
    const run = play(before, [intoCorridor]);
    const toDock = hopsTo(F1, F1_DEMO.c2Cover);
    for (const guard of run.guards) {
      const was = before.guards.find((g) => g.id === guard.id)!;
      expect(guard.target).toEqual({ zoneId: "dock", nodes: F1_DEMO.c2Cover });
      expect(toDock.get(guard.nodeId), guard.id).toBe(toDock.get(was.nodeId)! - 1);
    }
    // They keep converging on the turns after, still with no order given.
    const later = play(run, [{ kind: "move", to: F1_DEMO.freightLiftWait }]);
    for (const guard of later.guards) {
      const was = run.guards.find((g) => g.id === guard.id)!;
      expect(toDock.get(guard.nodeId), guard.id).toBe(Math.max(0, toDock.get(was.nodeId)! - 1));
    }
  });

  it("lets a Chief order replace the convergence afterwards", () => {
    const run = play(createRun(beat5Level()), [toLobby, intoCorridor]);
    const ordered = orderGuard(run, "G2", "records");
    if (!ordered.ok) throw new Error(ordered.reason);
    expect(ordered.run.guards.map((g) => g.target?.zoneId)).toEqual(["dock", "records", "dock"]);
  });

  it("plays the same way twice, events included", () => {
    const actions = [toLobby, intoCorridor, toLobby, wait, wait, wait];
    const a = play(createRun(beat5Level()), actions);
    const b = play(createRun(beat5Level()), actions);
    expect(toRunLog(b)).toEqual(toRunLog(a));
    expect(b.alarmEvents).toEqual(a.alarmEvents);
    expectEventsMatchLog(a);
  });
});

// ---- small floors -------------------------------------------------------------

/** Nodes n0…n(k-1) in a line along x, one room, every node in sight of every other. */
function lineFloor(k: number, door?: { between: [number, number]; id: string }): FloorGraph {
  const ids = Array.from({ length: k }, (_, i) => `n${i}`);
  return {
    nodes: ids.map((id, i) => ({ id, x: i, y: 0, roomId: "hall", tags: [] })),
    edges: ids.slice(1).map((id, i) => {
      const edge = { a: ids[i], b: id };
      return door && door.between[0] === i && door.between[1] === i + 1
        ? { ...edge, door: { id: door.id, lockable: true } }
        : edge;
    }),
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: k, h: 1 } }],
    sightlines: Object.fromEntries(ids.map((id) => [id, ids.filter((o) => o !== id)])),
    source: "fixture",
  };
}

function lineLevel(k: number, overrides: Partial<Level> = {}): Level {
  return {
    buildingId: "T",
    missionId: "t",
    seed: 1,
    floor: lineFloor(k),
    start: "n0",
    objective: `n${k - 1}`,
    exits: ["n0"],
    lockedDoors: [],
    pickTurns: 2,
    patrolTempo: 1,
    guards: [],
    ...overrides,
  };
}

describe("cameras", () => {
  it("an analog camera alternates between the halves of its cover every turn", () => {
    const { cameras } = createRun(lineLevel(5, { cameras: [{ id: "C1", kind: "analog-sweep", cover: ["n1", "n2", "n3", "n4"] }] })).board;
    expect([0, 1, 2, 3].map((t) => watched(cameras[0], t))).toEqual([
      ["n1", "n2"],
      ["n3", "n4"],
      ["n1", "n2"],
      ["n3", "n4"],
    ]);
  });

  it("an analog camera sees a player on its first half on even turns and its second half on odd turns", () => {
    const level = lineLevel(4, { cameras: [{ id: "C1", kind: "analog-sweep", cover: ["n1", "n2"] }] });
    // Turn 0 watches n1: stepping onto it is seen at once.
    expect(alarms(play(createRun(level), [{ kind: "move", to: "n1" }]))).toEqual(["alert"]);
    // Turn 1 watches n2, so n1 is safe; turn 2 watches n1 again.
    const late = play(createRun(level), [wait, { kind: "move", to: "n1" }, wait]);
    expect(alarms(late)).toEqual(["calm", "calm", "alert"]);
    // A sprint through the watched half is seen on the node it passes.
    const sprint = play(createRun(level), [{ kind: "sprint", to: "n2" }]);
    expect(sprint.alarmEvents[0]).toMatchObject({ turn: 0, cause: { kind: "camera", id: "C1" } });
  });

  it("a PTZ camera cycles through thirds of its cover over 3 turns, and an IP camera watches it all", () => {
    const cover = ["n1", "n2", "n3"];
    const { cameras } = createRun(
      lineLevel(4, {
        cameras: [
          { id: "P", kind: "ptz", cover, phase: 1 },
          { id: "F", kind: "fixed-ip", cover },
        ],
      }),
    ).board;
    expect([0, 1, 2, 3].map((t) => watched(cameras[0], t))).toEqual([["n2"], ["n3"], ["n1"], ["n2"]]);
    expect([0, 1, 2].map((t) => watched(cameras[1], t))).toEqual([cover, cover, cover]);
  });

  it("a camera with analytics raises the alarm one extra step, in one transition", () => {
    const level = lineLevel(3, { cameras: [{ id: "C1", kind: "ip-analytics", cover: ["n1"] }] });
    const run = play(createRun(level), [{ kind: "move", to: "n1" }]);
    expect(run.alarmEvents).toEqual([
      { turn: 0, from: "calm", to: "lockdown", lastKnownZone: "hall", cause: { kind: "camera", id: "C1" } },
    ]);
  });

  it("counts a turn's sightings as one step, however many cameras see the player", () => {
    const cameras = [
      { id: "C1", kind: "fixed-ip", cover: ["n1"] },
      { id: "C2", kind: "fixed-ip", cover: ["n1"] },
    ] as const;
    const run = play(createRun(lineLevel(3, { cameras })), [{ kind: "move", to: "n1" }]);
    expect(run.alarm).toBe("alert");
    expect(run.alarmEvents).toHaveLength(1);
  });
});

describe("guard vision", () => {
  it("sees the nodes ahead of the guard, not behind it", () => {
    // G1 starts on n3 facing n4 (+x). The player on n1 is behind it until it turns back.
    const level = lineLevel(5, { guards: [{ id: "G1", patrol: ["n3", "n4"] }] });
    const run = play(createRun(level), [{ kind: "move", to: "n1" }, wait]);
    // Turn 0: G1 n3 → n4, still facing +x. Turn 1: G1 n4 → n3, now facing -x, and sees n1.
    expect(alarms(run)).toEqual(["calm", "alert"]);
    expect(run.alarmEvents[0]).toMatchObject({ turn: 1, cause: { kind: "guard", id: "G1" } });
  });

  it("raises Lockdown when a guard sights the player again during Alert", () => {
    const level = lineLevel(5, { guards: [{ id: "G1", patrol: ["n3", "n4"] }] });
    // Turn 1 raised Alert; on turn 2 the guard, converging on n3 → n2, sees the player again.
    const run = play(createRun(level), [{ kind: "move", to: "n1" }, wait, wait]);
    expect(run.alarmEvents.map((e) => [e.turn, e.from, e.to])).toEqual([
      [1, "calm", "alert"],
      [2, "alert", "lockdown"],
    ]);
    expectEventsMatchLog(run);
  });
});

describe("noise", () => {
  // A guard posted on n4, two hops from n2; with no sightlines it sees only its own node.
  const deaf = (overrides: Partial<Level> = {}) =>
    lineLevel(7, {
      floor: { ...lineFloor(7, { between: [2, 3], id: "d-23" }), sightlines: {} },
      guards: [{ id: "G1", patrol: ["n4"] }],
      zones: { dark: ["n1", "n2"], far: ["n5", "n6"] },
      ...overrides,
    });
  const sprintTo2: Action = { kind: "sprint", to: "n2" };

  it("raises Suspicious when a guard is within hearing range of a sprint", () => {
    const run = play(createRun(deaf({ hearing: 2 })), [sprintTo2]);
    expect(run.alarmEvents).toEqual([
      { turn: 0, from: "calm", to: "suspicious", lastKnownZone: "dark", cause: { kind: "noise", id: "G1" } },
    ]);
  });

  it("is not heard one hop beyond the range, unless made in a quiet zone", () => {
    expect(play(createRun(deaf({ hearing: 1 })), [sprintTo2]).alarm).toBe("calm");
    expect(play(createRun(deaf({ hearing: 1, quietZones: ["dark"] })), [sprintTo2]).alarm).toBe("suspicious");
    // One hop further only: a quiet zone does not carry it two.
    expect(play(createRun(deaf({ hearing: 0, quietZones: ["dark"] })), [sprintTo2]).alarm).toBe("calm");
  });

  it("is made by picking a lock, not by walking or waiting", () => {
    const level = deaf({ hearing: 2, lockedDoors: ["d-23"] });
    const atDoor = play(createRun(level), [{ kind: "move", to: "n1" }, { kind: "move", to: "n2" }, wait]);
    expect(atDoor.alarm).toBe("calm");
    expect(play(atDoor, [{ kind: "pick", doorId: "d-23" }]).alarm).toBe("suspicious");
  });
});

describe("cleaners", () => {
  it("see like guards but only raise Suspicious, and never catch the player", () => {
    const level = lineLevel(4, { cleaners: [{ id: "K1", patrol: ["n2"] }] });
    const run = play(createRun(level), [{ kind: "sprint", to: "n2" }, wait]);
    expect(run.status).toBe("playing");
    expect(run.alarm).toBe("suspicious");
    expect(run.alarmEvents).toEqual([
      { turn: 0, from: "calm", to: "suspicious", lastKnownZone: "hall", cause: { kind: "cleaner", id: "K1" } },
    ]);
    // At Alert, standing with a cleaner is still not capture.
    expect(play(setAlarm(run, "alert"), [wait]).status).toBe("playing");
  });
});

describe("the alarm states", () => {
  const fixed = lineLevel(3, { cameras: [{ id: "C1", kind: "fixed-ip", cover: ["n1"] }] });
  const tripped = () => play(createRun(fixed), [{ kind: "move", to: "n1" }, { kind: "move", to: "n0" }]);

  it("holds Alert 3 turns after the last sighting, then decays a step at a time back to Calm", () => {
    const run = play(tripped(), waits(5));
    expect(alarms(run)).toEqual(["alert", "alert", "alert", "suspicious", "suspicious", "suspicious", "calm"]);
    expect(run.alarmEvents).toEqual([
      { turn: 0, from: "calm", to: "alert", lastKnownZone: "hall", cause: { kind: "camera", id: "C1" } },
      { turn: 3, from: "alert", to: "suspicious", lastKnownZone: "hall", cause: { kind: "decay" } },
      { turn: 6, from: "suspicious", to: "calm", lastKnownZone: "hall", cause: { kind: "decay" } },
    ]);
    expectEventsMatchLog(run);
  });

  it("does not decay from Lockdown", () => {
    const run = play(setAlarm(createRun(fixed), "lockdown"), waits(10));
    expect(run.alarm).toBe("lockdown");
    expect(run.alarmEvents).toHaveLength(1);
  });

  it("emits one event per transition with from, to, turn and lastKnownZone, setAlarm included", () => {
    const run = setAlarm(tripped(), "lockdown");
    const event = run.alarmEvents.at(-1)!;
    expect(event).toEqual({ turn: 2, from: "alert", to: "lockdown", lastKnownZone: "hall", cause: { kind: "set" } });
    expect(setAlarm(run, "lockdown").alarmEvents).toHaveLength(run.alarmEvents.length);
    expect(setAlarm(createRun(fixed), "suspicious").alarmEvents).toEqual([
      { turn: 0, from: "calm", to: "suspicious", lastKnownZone: null, cause: { kind: "set" } },
    ]);
  });

  it("sends the guards back to their patrols when it decays to Calm", () => {
    const level = { ...fixed, floor: { ...fixed.floor, sightlines: {} }, guards: [{ id: "G1", patrol: ["n2"] }] };
    const run = play(createRun(level), [{ kind: "move", to: "n1" }, { kind: "move", to: "n0" }]);
    expect(run.guards[0].target?.zoneId).toBe("hall");
    const calm = play(run, waits(5));
    expect(calm.alarm).toBe("calm");
    expect(calm.guards[0].target).toBeNull();
  });
});

describe("level checks for detection", () => {
  it("rejects cameras, cleaners and quiet zones that do not fit the floor", () => {
    const level = (o: Partial<Level>) => () => createRun(lineLevel(3, o));
    expect(level({ cameras: [{ id: "C1", kind: "ptz", cover: ["vault"] }] })).toThrow(/camera "C1" cover node/);
    expect(level({ cameras: [{ id: "C1", kind: "ptz", cover: [] }] })).toThrow(/covers no nodes/);
    expect(
      level({
        cameras: [
          { id: "C1", kind: "ptz", cover: ["n1"] },
          { id: "C1", kind: "ptz", cover: ["n2"] },
        ],
      }),
    ).toThrow(/duplicate camera/);
    expect(level({ cameras: [{ id: "C1", kind: "ptz", cover: ["n1"], phase: -1 }] })).toThrow(/phase/);
    expect(level({ cleaners: [{ id: "K1", patrol: [] }] })).toThrow(/cleaner "K1" has an empty patrol/);
    expect(level({ quietZones: ["dark"] })).toThrow(LevelError);
    expect(level({ hearing: -1 })).toThrow(/hearing/);
  });
});
