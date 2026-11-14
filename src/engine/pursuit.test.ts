// Pursuit and the Chief's orders (#20): guards close on the player instead
// of stopping beside them, a sighting at Lockdown re-targets them and is an
// event the Chief sees, the last-known zone can always be ordered to, and
// Chief orders are clamped to the board. Plus the two alarm rules the
// detection review found untested (PR #58, R1-M4).
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import type { ChiefOrders, FloorGraph } from "@/domain";
import {
  act,
  applyChiefOrders,
  createRun,
  orderGuard,
  plannedPath,
  setAlarm,
  type Action,
  type Level,
  type RunState,
} from "@/engine";

const F1 = FIXTURE_FLOORS.F1;
const wait: Action = { kind: "wait" };
const waits = (n: number): Action[] => Array.from({ length: n }, () => wait);

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}

const where = (run: RunState, guardId: string) => run.guards.find((g) => g.id === guardId)!.nodeId;

/** F1 for beat 5 with no level zone on the dock corridor, as the placer leaves it: its room is the last-known zone. */
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
      { id: "G1", patrol: ["mc-2", "mc-w"] },
      { id: "G2", patrol: ["o-west", "o-north", "o-east", "o-southeast", "o-south"] },
    ],
    zones: { objective: ["rr-door", "rr-files"], "dock-N": [F1_DEMO.dockEntry], "quiet-2210": ["o-west", "o-north", "o-east", "o-south", "o-southeast"] },
    cameras: [{ id: "C2", kind: "analog-sweep", cover: F1_DEMO.c2Cover, phase: 1 }],
    ...overrides,
  };
}

/** Into C2's watched half on turn 1: Alert, with the dock corridor as the last-known zone. */
const tripped = () => play(createRun(f1Level()), [{ kind: "move", to: F1_DEMO.freightLiftWait }, { kind: "move", to: "dc-west" }]);

/** Nodes n0…n(k-1) in a line along x, one room. */
function lineFloor(k: number, opts: { sightlines?: boolean; door?: [number, string] } = {}): FloorGraph {
  const ids = Array.from({ length: k }, (_, i) => `n${i}`);
  return {
    nodes: ids.map((id, i) => ({ id, x: i, y: 0, roomId: i < k / 2 ? "west" : "east", tags: [] })),
    edges: ids.slice(1).map((id, i) =>
      opts.door?.[0] === i ? { a: ids[i], b: id, door: { id: opts.door[1], lockable: true } } : { a: ids[i], b: id },
    ),
    rooms: [
      { id: "west", label: "West hall", rect: { x: 0, y: 0, w: k / 2, h: 1 } },
      { id: "east", label: "East hall", rect: { x: k / 2, y: 0, w: k / 2, h: 1 } },
    ],
    sightlines: opts.sightlines ? Object.fromEntries(ids.map((id) => [id, ids.filter((o) => o !== id)])) : {},
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

describe("guards close on the player (PR #62: they stopped beside them)", () => {
  it("catch a player who stays where C2 saw them on F1, standing on their node", () => {
    let run = tripped();
    for (let i = 0; i < 8 && run.status === "playing"; i++) run = play(run, [wait]);
    expect(run.status).toBe("caught");
    expect(run.guards.some((g) => g.nodeId === "dc-west")).toBe(true);
    expect(run.playerNode).toBe("dc-west");
  });

  it("follow each new sighting at Alert onto the node it was made on", () => {
    // A fixed camera watches n2 and n3; the guard starts at the far end, n7.
    const level = lineLevel(8, {
      guards: [{ id: "G1", patrol: ["n7"] }],
      cameras: [{ id: "C1", kind: "fixed-ip", cover: ["n1", "n2"] }],
      patrolTempo: 2,
    });
    const seen = play(createRun(level), [{ kind: "move", to: "n1" }]);
    expect(seen.guards[0].target).toMatchObject({ intent: "converge", nodes: ["n1"] });
    const again = play(seen, [{ kind: "move", to: "n2" }]);
    expect(again.alarm).toBe("lockdown");
    expect(again.guards[0].target).toMatchObject({ intent: "converge", nodes: ["n2"] });
  });
});

describe("a sighting at Lockdown (PR #58, R1-M1)", () => {
  // Two rooms, west (n0–n3) and east (n4–n7); a fixed camera watches n2 and n5.
  const level = () =>
    lineLevel(8, {
      guards: [{ id: "G1", patrol: ["n7"] }],
      cameras: [{ id: "C1", kind: "fixed-ip", cover: ["n2", "n5"] }],
      patrolTempo: 3,
    });

  it("re-targets the converging guards on the new node, and is an event when it finds the player in another zone", () => {
    const locked = setAlarm(play(createRun(level()), [{ kind: "move", to: "n1" }, { kind: "move", to: "n2" }]), "lockdown");
    expect(locked.guards[0].target).toMatchObject({ zoneId: "west", nodes: ["n2"] });
    const before = locked.alarmEvents.length;
    const run = play(locked, [{ kind: "move", to: "n3" }, { kind: "move", to: "n4" }, { kind: "move", to: "n5" }]);
    expect(run.alarm).toBe("lockdown");
    expect(run.alarmEvents.slice(before)).toEqual([
      { turn: 4, from: "lockdown", to: "lockdown", lastKnownZone: "east", cause: { kind: "camera", id: "C1" } },
    ]);
    expect(run.guards[0].target).toMatchObject({ intent: "converge", zoneId: "east", nodes: ["n5"] });
  });

  it("is not an event while the player stays in sight in the same zone, but is one when they are found again after a turn unseen", () => {
    const locked = setAlarm(play(createRun(level()), [{ kind: "move", to: "n1" }, { kind: "move", to: "n2" }]), "lockdown");
    const before = locked.alarmEvents.length;
    const stays = play(locked, waits(2));
    expect(stays.alarmEvents).toHaveLength(before);
    const back = play(stays, [{ kind: "move", to: "n1" }, { kind: "move", to: "n2" }]);
    expect(back.alarmEvents.slice(before)).toEqual([
      { turn: 5, from: "lockdown", to: "lockdown", lastKnownZone: "west", cause: { kind: "camera", id: "C1" } },
    ]);
  });

  it("is still an event after a turn unseen when noise was heard in between (#94)", () => {
    // A locked door between n0 and n1; a deaf guard on n3 that never moves hears a pick on n1.
    const noisy = lineLevel(8, {
      floor: lineFloor(8, { door: [0, "d-01"] }),
      guards: [{ id: "G1", patrol: ["n3"] }],
      cameras: [{ id: "C1", kind: "fixed-ip", cover: ["n2"] }],
      lockedDoors: ["d-01"],
      pickTurns: 9,
      patrolTempo: 99,
      start: "n1",
    });
    const locked = setAlarm(play(createRun(noisy), [{ kind: "move", to: "n2" }]), "lockdown");
    const before = locked.alarmEvents.length;
    const heard = play(locked, [{ kind: "move", to: "n1" }, wait, { kind: "pick", doorId: "d-01" }]);
    expect(heard.alarmEvents).toHaveLength(before);
    const run = play(heard, [{ kind: "move", to: "n2" }]);
    expect(run.alarmEvents.slice(before)).toEqual([
      { turn: 4, from: "lockdown", to: "lockdown", lastKnownZone: "west", cause: { kind: "camera", id: "C1" } },
    ]);
  });

  it("leaves a guard on a Chief's hold where it is", () => {
    const locked = setAlarm(play(createRun(level()), [{ kind: "move", to: "n1" }, { kind: "move", to: "n2" }]), "lockdown");
    const held = orderGuard(locked, "G1", "east", "hold");
    if (!held.ok) throw new Error(held.reason);
    const run = play(held.run, [{ kind: "move", to: "n3" }, { kind: "move", to: "n4" }, { kind: "move", to: "n5" }]);
    expect(run.guards[0].target).toMatchObject({ intent: "hold", zoneId: "east" });
  });
});

describe("the last-known zone as an order's zone (PR #58, R1-M2)", () => {
  it("is the dock corridor's room on F1, and a converge order there is kept and goes onto the sighting", () => {
    const run = tripped();
    expect(run.lastKnown?.zoneId).toBe("dock-corridor");
    const ordered = orderGuard(run, "G2", "dock-corridor", "converge");
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    expect(ordered.run.guards[1].target).toEqual({ zoneId: "dock-corridor", nodes: ["dc-west"], intent: "converge", visit: 0 });
    // Every room of the floor can be ordered to; anything else is refused.
    expect(orderGuard(run, "G2", "main-corridor", "hold").ok).toBe(true);
    expect(orderGuard(run, "G2", "vault", "hold")).toEqual({ ok: false, reason: 'no zone "vault"' });
  });
});

describe("the alarm rules the detection review found untested (PR #58, R1-M4)", () => {
  it("checks capture before sighting: stepping onto a guard at Alert catches, and the guard's sighting raises nothing", () => {
    // The guard on n1 sees the whole line. Seen first, it would raise Lockdown before the capture.
    const level = lineLevel(4, { floor: lineFloor(4, { sightlines: true }), guards: [{ id: "G1", patrol: ["n1"] }] });
    const alert = setAlarm({ ...createRun(level), playerNode: "n0" }, "alert");
    const run = play(alert, [{ kind: "sprint", to: "n2" }]);
    expect(run.status).toBe("caught");
    expect(run.playerNode).toBe("n1");
    expect(run.alarm).toBe("alert");
    expect(run.alarmEvents).toEqual(alert.alarmEvents);
  });

  it("lets noise hold Suspicious but never Alert: picking in earshot at Alert decays it on schedule", () => {
    // A deaf guard on n4 hears a pick on n2 (two hops); it sees only its own node.
    const level = lineLevel(6, {
      floor: lineFloor(6, { door: [2, "d-23"] }),
      guards: [{ id: "G1", patrol: ["n4"] }],
      lockedDoors: ["d-23"],
      pickTurns: 9,
      start: "n2",
    });
    const pick: Action = { kind: "pick", doorId: "d-23" };
    const run = play(setAlarm(createRun(level), "alert"), [pick, pick, pick, pick, pick, pick]);
    expect(run.turns.map((t) => t.alarm)).toEqual(["alert", "alert", "suspicious", "suspicious", "suspicious", "suspicious"]);
  });
});

describe("applyChiefOrders", () => {
  const orders = (o: Partial<ChiefOrders>): ChiefOrders => ({ orders: [], lockZones: [], rationale: "Test.", ...o });

  it("drops an order naming an unknown guard or zone without an error, and keeps the rest", () => {
    const run = tripped();
    const result = applyChiefOrders(
      run,
      orders({
        orders: [
          { guardId: "G9", intent: "hold", zoneId: "objective" },
          { guardId: "G1", intent: "hold", zoneId: "the vault" },
          { guardId: "G2", intent: "block", zoneId: "dock-N" },
        ],
        lockZones: ["nowhere"],
      }),
    );
    expect(result.applied).toEqual([{ guardId: "G2", intent: "block", zoneId: "dock-N" }]);
    expect(result.dropped).toEqual([
      { order: { guardId: "G9", intent: "hold", zoneId: "objective" }, reason: 'no guard "G9"' },
      { order: { guardId: "G1", intent: "hold", zoneId: "the vault" }, reason: 'no zone "the vault"' },
      { order: { lockZone: "nowhere" }, reason: 'no zone "nowhere"' },
    ]);
    // G1 keeps the alarm's converge order; G2 takes the Chief's.
    expect(result.run.guards[0].target).toMatchObject({ intent: "converge", nodes: ["dc-west"] });
    expect(result.run.guards[1].target).toMatchObject({ intent: "block", nodes: [F1_DEMO.dockEntry] });
  });

  it("moves an ordered guard one hop per turn along the path the board previews", () => {
    // At Lockdown with no contact: no guard converges, and the alarm never decays while it walks.
    const { run } = applyChiefOrders(setAlarm(createRun(f1Level()), "lockdown"), orders({ orders: [{ guardId: "G2", intent: "sweep", zoneId: "quiet-2210" }] }));
    const guard = run.guards[1];
    const preview = plannedPath(run.board, guard);
    expect(preview).toHaveLength(4);
    let state = run;
    const walked = [where(state, "G2")];
    for (let i = 0; i < 3; i++) {
      state = play(state, [wait]);
      walked.push(where(state, "G2"));
    }
    expect(walked).toEqual(preview);
    // A sweep goes round the whole zone.
    state = play(state, waits(12));
    const zone = new Set(run.board.level.zones!["quiet-2210"]);
    expect(zone.has(where(state, "G2"))).toBe(true);
  });

  it("locks every open lockable door on a locked zone's edge, and logs the orders on the next turn", () => {
    const opened = { ...tripped(), locked: [] };
    const result = applyChiefOrders(opened, orders({ lockZones: ["objective"], rationale: "Lock the records room." }));
    expect(result.locked).toEqual([{ zoneId: "objective", doors: [F1_DEMO.recordsDoor] }]);
    expect(result.run.locked).toEqual([F1_DEMO.recordsDoor]);
    const next = play(result.run, [wait]);
    expect(next.turns.at(-1)!.chief?.rationale).toBe("Lock the records room.");
    expect(play(next, [wait]).turns.at(-1)!.chief).toBeUndefined();
  });

  it("drops every order and lock given at Calm, leaving the guards and doors as they were (#94)", () => {
    const calm = { ...createRun(f1Level()), locked: [] };
    const result = applyChiefOrders(
      calm,
      orders({ orders: [{ guardId: "G2", intent: "hold", zoneId: "quiet-2210" }], lockZones: ["objective"] }),
    );
    expect(result.applied).toEqual([]);
    expect(result.locked).toEqual([]);
    expect(result.dropped).toEqual([
      { order: { guardId: "G2", intent: "hold", zoneId: "quiet-2210" }, reason: "the alarm is calm" },
      { order: { lockZone: "objective" }, reason: "the alarm is calm" },
    ]);
    expect(result.run.guards).toEqual(calm.guards);
    expect(result.run.locked).toEqual([]);
  });

  it("ends the Chief's targets and unlocks the Chief's doors when the alarm decays to Calm, but not the level's own (#94)", () => {
    // Alert with no contact, so the guards walk only on the Chief's orders.
    const alert = setAlarm(createRun(f1Level()), "alert");
    const ordered = applyChiefOrders(
      { ...alert, locked: [] },
      orders({ orders: [{ guardId: "G2", intent: "hold", zoneId: "quiet-2210" }], lockZones: ["objective"] }),
    ).run;
    expect(ordered.locked).toEqual([F1_DEMO.recordsDoor]);
    const calm = play(ordered, waits(6));
    expect(calm.alarm).toBe("calm");
    expect(calm.guards.map((g) => g.target)).toEqual([null, null]);
    expect(calm.locked).toEqual([]);
    // The level's own locked door stays locked through a decay.
    const own = play(applyChiefOrders(alert, orders({ lockZones: ["objective"] })).run, waits(6));
    expect(own.alarm).toBe("calm");
    expect(own.locked).toEqual([F1_DEMO.recordsDoor]);
  });

  it("never changes the run it is given", () => {
    const run = tripped();
    const copy = structuredClone({ guards: run.guards, locked: run.locked });
    applyChiefOrders(run, orders({ orders: [{ guardId: "G1", intent: "sweep", zoneId: "quiet-2210" }], lockZones: ["objective"] }));
    expect({ guards: run.guards, locked: run.locked }).toEqual(copy);
  });
});
