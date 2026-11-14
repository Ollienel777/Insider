// The run's sound cues (issue 101): every cue on the event that calls for it,
// on small hand-made floors where each event can be set up exactly, and the
// crew's quiet route on the real F1 board as the Run screen places it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest, type FloorGraph } from "@/domain";
import { act, applyChiefOrders, createRun, setAlarm, type Action, type Level, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { choices } from "./board";
import { RUN_SEED } from "./run-screen";
import { cuesFor, hopsToNearestGuard, PULSE_RANGE, sameRun, type Cue } from "./sound";

/** Nodes n0…n(k-1) in a line, one room. With `sightlines`, every node sees every other. */
function lineFloor(k: number, opts: { sightlines?: boolean; door?: [number, string] } = {}): FloorGraph {
  const ids = Array.from({ length: k }, (_, i) => `n${i}`);
  return {
    nodes: ids.map((id, i) => ({ id, x: i, y: 0, roomId: "hall", tags: [] })),
    edges: ids.slice(1).map((id, i) =>
      opts.door?.[0] === i ? { a: ids[i], b: id, door: { id: opts.door[1], lockable: true } } : { a: ids[i], b: id },
    ),
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: k, h: 1 } }],
    sightlines: opts.sightlines ? Object.fromEntries(ids.map((id) => [id, ids.filter((o) => o !== id)])) : {},
    source: "fixture",
  };
}

/** A level on a line of `k` nodes: in at n0, no guards, nothing locked, unless `overrides` says so. */
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

const wait: Action = { kind: "wait" };
const move = (to: string): Action => ({ kind: "move", to });

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    return result.run;
  }, run);
}

/** The cues of one more turn. */
const turn = (run: RunState, action: Action): Cue[] => cuesFor(run, play(run, [action]));

/** A guard that stands on `nodeId`: with no sightlines on the floor, it sees its own node only. */
const post = (id: string, nodeId: string) => ({ id, patrol: [nodeId] });

describe("footsteps", () => {
  it("one step for a move", () => {
    expect(turn(createRun(lineLevel(8)), move("n1"))).toEqual<Cue[]>([{ kind: "step", hops: 1, sprint: false }]);
  });

  it("two heavier steps for a sprint", () => {
    expect(turn(createRun(lineLevel(8)), { kind: "sprint", to: "n2" })).toEqual<Cue[]>([
      { kind: "step", hops: 2, sprint: true },
    ]);
  });

  it("one heavy step for a sprint a guard stops on its first hop", () => {
    const alert = setAlarm(createRun(lineLevel(8, { guards: [post("G1", "n1")] })), "alert");
    const after = play(alert, [{ kind: "sprint", to: "n2" }]);
    expect(after.playerNode).toBe("n1");
    expect(cuesFor(alert, after)).toEqual<Cue[]>([{ kind: "step", hops: 1, sprint: true }, { kind: "caught" }]);
  });

  it("none for a wait", () => {
    expect(turn(createRun(lineLevel(8)), wait)).toEqual([]);
  });
});

describe("the guard pulse", () => {
  it("carries the hops to the guard, turn by turn, as the player closes on it", () => {
    let run = createRun(lineLevel(8, { guards: [post("G1", "n5")] }));
    const heard: (number | null)[] = [];
    for (const to of ["n1", "n2", "n3", "n4"]) {
      const next = play(run, [move(to)]);
      const pulse = cuesFor(run, next).find((cue) => cue.kind === "pulse");
      heard.push(pulse ? pulse.hops : null);
      run = next;
    }
    expect(heard).toEqual([4, 3, 2, 1]);
  });

  it("plays on a wait too: it is the guard's distance, not the player's move", () => {
    const run = play(createRun(lineLevel(8, { guards: [post("G1", "n3")] })), [move("n1")]);
    expect(turn(run, wait)).toEqual<Cue[]>([{ kind: "pulse", hops: 2 }]);
  });

  it("stops at its range", () => {
    const level = (guardAt: number) => lineLevel(8, { guards: [post("G1", `n${guardAt}`)] });
    expect(turn(createRun(level(PULSE_RANGE)), wait)).toEqual<Cue[]>([{ kind: "pulse", hops: PULSE_RANGE }]);
    expect(turn(createRun(level(PULSE_RANGE + 1)), wait)).toEqual([]);
  });

  it("follows the nearest guard of several, where it stands after its move", () => {
    // G1 walks n6 → n5 this turn; G2 stays on n7.
    const run = createRun(lineLevel(8, { guards: [post("G2", "n7"), { id: "G1", patrol: ["n6", "n2"] }] }));
    const next = play(run, [move("n1")]);
    expect(next.guards.find((g) => g.id === "G1")!.nodeId).toBe("n5");
    expect(cuesFor(run, next)).toEqual<Cue[]>([
      { kind: "step", hops: 1, sprint: false },
      { kind: "pulse", hops: 4 },
    ]);
  });

  it("counts through a locked door, since guards carry keys, and ignores cleaners", () => {
    const level = lineLevel(8, {
      floor: lineFloor(8, { door: [1, "d1"] }),
      lockedDoors: ["d1"],
      guards: [post("G1", "n3")],
      cleaners: [post("K1", "n1")],
    });
    const run = createRun(level);
    expect(hopsToNearestGuard(run)).toBe(3);
    expect(turn(run, wait)).toEqual<Cue[]>([{ kind: "pulse", hops: 3 }]);
  });

  it("is silent with no guards", () => {
    expect(hopsToNearestGuard(createRun(lineLevel(8)))).toBeNull();
  });
});

describe("the alarm", () => {
  it("rises when a guard hears a sprint, which is not a sighting", () => {
    // G1 on n4 hears a sprint that ends on n2, two hops away.
    const run = createRun(lineLevel(8, { guards: [post("G1", "n4")] }));
    const next = play(run, [{ kind: "sprint", to: "n2" }]);
    expect(next.alarmEvents.map((e) => e.cause.kind)).toEqual(["noise"]);
    expect(cuesFor(run, next)).toEqual<Cue[]>([
      { kind: "step", hops: 2, sprint: true },
      { kind: "alarm-rise", to: "suspicious" },
      { kind: "pulse", hops: 2 },
    ]);
  });

  it("falls a step at a time once nothing holds it, with the softer cue", () => {
    let run = setAlarm(createRun(lineLevel(8)), "alert");
    const heard: Cue[][] = [];
    for (let i = 0; i < 6; i++) {
      const next = play(run, [wait]);
      heard.push(cuesFor(run, next));
      run = next;
    }
    expect(heard).toEqual<Cue[][]>([
      [],
      [],
      [{ kind: "alarm-fall", to: "suspicious" }],
      [],
      [],
      [{ kind: "alarm-fall", to: "calm" }],
    ]);
  });

  it("rises when it is set between turns, with no footstep or pulse", () => {
    const run = play(createRun(lineLevel(8, { guards: [post("G1", "n3")] })), [move("n1")]);
    expect(cuesFor(run, setAlarm(run, "lockdown"))).toEqual<Cue[]>([{ kind: "alarm-rise", to: "lockdown" }]);
  });
});

describe("being seen", () => {
  it("by a camera: the cue, then the alarm's", () => {
    const run = createRun(lineLevel(8, { cameras: [{ id: "C1", kind: "fixed-ip", cover: ["n1"] }] }));
    expect(turn(run, move("n1"))).toEqual<Cue[]>([
      { kind: "step", hops: 1, sprint: false },
      { kind: "spotted" },
      { kind: "alarm-rise", to: "alert" },
    ]);
  });

  it("by a guard", () => {
    // On a floor with sightlines, G1 on n6 watches all around and sees the player at once.
    const level = lineLevel(8, { floor: lineFloor(8, { sightlines: true }), guards: [post("G1", "n6")] });
    const run = createRun(level);
    const next = play(run, [wait]);
    expect(next.alarmEvents.map((e) => e.cause.kind)).toEqual(["guard"]);
    expect(cuesFor(run, next)).toEqual<Cue[]>([{ kind: "spotted" }, { kind: "alarm-rise", to: "alert" }]);
  });

  it("not by a cleaner, whose sighting only raises Suspicious", () => {
    const level = lineLevel(8, { floor: lineFloor(8, { sightlines: true }), cleaners: [post("K1", "n6")] });
    const run = createRun(level);
    const next = play(run, [wait]);
    expect(next.alarmEvents.map((e) => e.cause.kind)).toEqual(["cleaner"]);
    expect(cuesFor(run, next)).toEqual<Cue[]>([{ kind: "alarm-rise", to: "suspicious" }]);
  });

  it("again at Lockdown, where the alarm cannot rise and no event is logged", () => {
    // An analytics camera takes Calm straight to Lockdown; it sees the player again on every turn they stay.
    const level = lineLevel(8, { cameras: [{ id: "C1", kind: "ip-analytics", cover: ["n1"] }] });
    const seen = play(createRun(level), [move("n1")]);
    expect(seen.alarm).toBe("lockdown");
    const again = play(seen, [wait]);
    expect(again.alarmEvents).toHaveLength(seen.alarmEvents.length);
    expect(cuesFor(seen, again)).toEqual<Cue[]>([{ kind: "spotted" }]);
    // Off the camera's node, nothing sees them, and nothing says it did.
    expect(turn(again, move("n2"))).toEqual<Cue[]>([{ kind: "step", hops: 1, sprint: false }]);
  });
});

describe("the lock", () => {
  const level = lineLevel(8, { floor: lineFloor(8, { door: [0, "d0"] }), lockedDoors: ["d0"], pickTurns: 3 });
  const pick: Action = { kind: "pick", doorId: "d0" };

  it("ticks on every pick that leaves the door locked, and clicks when it opens", () => {
    let run = createRun(level);
    const heard: Cue[][] = [];
    for (let i = 0; i < 3; i++) {
      const next = play(run, [pick]);
      heard.push(cuesFor(run, next));
      run = next;
    }
    expect(heard).toEqual<Cue[][]>([[{ kind: "pick" }], [{ kind: "pick" }], [{ kind: "unlock" }]]);
    expect(run.locked).toEqual([]);
  });

  it("clicks for the picked door only, not for a door the alarm's decay unlocks", () => {
    // The Chief locks d4 at Suspicious; the alarm then decays to Calm on the turn of a first pick at d0.
    const floor: FloorGraph = lineFloor(8, { door: [0, "d0"] });
    floor.edges[4] = { ...floor.edges[4], door: { id: "d4", lockable: true } };
    const start = setAlarm(createRun({ ...level, floor, zones: { far: ["n5", "n6", "n7"] } }), "suspicious");
    const locked = applyChiefOrders(start, { orders: [], lockZones: ["far"], rationale: "Seal the far end." }).run;
    expect(locked.locked).toEqual(["d0", "d4"]);
    const quiet = play(locked, [wait, wait]);
    const next = play(quiet, [pick]);
    expect(next.locked).toEqual(["d0"]);
    expect(cuesFor(quiet, next)).toEqual<Cue[]>([{ kind: "pick" }, { kind: "alarm-fall", to: "calm" }]);
  });
});

describe("the objective and the way out", () => {
  const level = lineLevel(8, { objective: "n1", exits: ["n0"] });

  it("a cue for taking the objective", () => {
    const run = play(createRun(level), [move("n1")]);
    expect(turn(run, { kind: "take" })).toEqual<Cue[]>([{ kind: "take" }]);
  });

  it("a cue for getting out with it, and none for passing the exit without it", () => {
    const carrying = play(createRun(level), [move("n1"), { kind: "take" }]);
    const out = play(carrying, [move("n0")]);
    expect(out.status).toBe("won");
    expect(cuesFor(carrying, out)).toEqual<Cue[]>([{ kind: "step", hops: 1, sprint: false }, { kind: "escape" }]);

    const emptyHanded = play(createRun(level), [move("n1")]);
    expect(turn(emptyHanded, move("n0"))).toEqual<Cue[]>([{ kind: "step", hops: 1, sprint: false }]);
  });
});

describe("being caught", () => {
  it("a cue when a guard at Alert reaches the player, and no pulse once the run has ended", () => {
    // The camera watches n1 on even turns only. Seen there on turn 0, the player stays; G1
    // converges from n3 and stands on them on turn 1, when nothing sees them a second time.
    const level = lineLevel(8, {
      guards: [post("G1", "n3")],
      cameras: [{ id: "C1", kind: "analog-sweep", cover: ["n1", "n2"] }],
    });
    const start = createRun(level);
    const seen = play(start, [move("n1")]);
    expect(cuesFor(start, seen)).toEqual<Cue[]>([
      { kind: "step", hops: 1, sprint: false },
      { kind: "spotted" },
      { kind: "alarm-rise", to: "alert" },
      { kind: "pulse", hops: 1 },
    ]);
    const caught = play(seen, [wait]);
    expect(caught.status).toBe("caught");
    expect(cuesFor(seen, caught)).toEqual<Cue[]>([{ kind: "caught" }]);
  });

  it("walking into a guard at Calm: the step, the sighting, the alarm and the catch, in that order", () => {
    const run = createRun(lineLevel(8, { guards: [post("G1", "n1")] }));
    expect(turn(run, move("n1"))).toEqual<Cue[]>([
      { kind: "step", hops: 1, sprint: false },
      { kind: "spotted" },
      { kind: "alarm-rise", to: "alert" },
      { kind: "caught" },
    ]);
  });
});

describe("what plays nothing", () => {
  const level = lineLevel(8, { guards: [post("G1", "n1")], objective: "n0", exits: ["n7"] });

  it("the first run on the board, and the board being cleared", () => {
    const run = createRun(level);
    expect(cuesFor(null, run)).toEqual([]);
    expect(cuesFor(run, null)).toEqual([]);
    expect(cuesFor(null, null)).toEqual([]);
  });

  it("a restart, even from a run that ended caught at Alert with the objective in hand", () => {
    const caught = play(createRun(level), [{ kind: "take" }, move("n1")]);
    expect(caught).toMatchObject({ status: "caught", alarm: "alert", carrying: true });
    const fresh = createRun(level);
    expect(sameRun(caught, fresh)).toBe(false);
    expect(cuesFor(caught, fresh)).toEqual([]);
    // The fresh run's own first turn plays as usual.
    expect(turn(fresh, wait)).toEqual<Cue[]>([{ kind: "pulse", hops: 1 }]);
  });

  it("the same state twice", () => {
    const run = play(createRun(lineLevel(8, { guards: [post("G1", "n3")] })), [move("n1")]);
    expect(cuesFor(run, run)).toEqual([]);
  });

  it("the Chief's orders landing between turns: no second footstep, no second pulse", () => {
    const run = play(setAlarm(createRun(lineLevel(8, { guards: [post("G1", "n3")] })), "alert"), [move("n1")]);
    const ordered = applyChiefOrders(run, {
      orders: [{ guardId: "G1", zoneId: "hall", intent: "sweep" }],
      lockZones: [],
      rationale: "Sweep the hall.",
    });
    expect(ordered.applied).toHaveLength(1);
    expect(ordered.run.turn).toBe(run.turn);
    expect(cuesFor(run, ordered.run)).toEqual([]);
  });
});

describe("on the F1 board, as the Run screen places it", () => {
  const manifest = LevelManifest.parse(structuredClone(cached));
  const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);

  /** The crew's quiet route (as in run.test.tsx): each step a node to move to, or an action. */
  const QUIET_ROUTE = [
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

  function actionFor(run: RunState, step: string): Action {
    if (step === "wait") return wait;
    if (step === "take") return { kind: "take" };
    if (step === "pick") return choices(run).find((c) => c.kind === "pick")!.action;
    return move(step);
  }

  it("the quiet route sounds like one: steps, the lock, the take and the way out, and never an alarm", () => {
    let run = createRun(placed.level);
    const heard: Cue[][] = [];
    for (const step of QUIET_ROUTE) {
      const next = play(run, [actionFor(run, step)]);
      heard.push(cuesFor(run, next));
      run = next;
    }
    expect(run.status).toBe("won");
    // The pulse comes and goes with the guards' rounds; everything else is the route itself.
    const withoutPulse = heard.map((cues) => cues.filter((cue) => cue.kind !== "pulse").map((cue) => cue.kind));
    expect(withoutPulse).toEqual(
      QUIET_ROUTE.map((step, i) => {
        if (step === "wait") return [];
        if (step === "take") return ["take"];
        if (step === "pick") return [QUIET_ROUTE[i + 1] === "pick" ? "pick" : "unlock"];
        return i === QUIET_ROUTE.length - 1 ? ["step", "escape"] : ["step"];
      }),
    );
    const pulses = heard.flat().filter((cue) => cue.kind === "pulse");
    expect(pulses.length).toBeGreaterThan(0);
    expect(pulses.every((cue) => cue.hops >= 1 && cue.hops <= PULSE_RANGE)).toBe(true);
    expect(heard.at(-1)!.some((cue) => cue.kind === "pulse")).toBe(false);
  });

  it("the wow beat: stepping into C2's cover without waiting is seen, and the alarm rises to Alert", () => {
    const run = play(createRun(placed.level), [move(F1_DEMO.freightLiftWait)]);
    const cues = turn(run, move("dc-west")).filter((cue) => cue.kind !== "pulse");
    expect(cues).toEqual<Cue[]>([
      { kind: "step", hops: 1, sprint: false },
      { kind: "spotted" },
      { kind: "alarm-rise", to: "alert" },
    ]);
  });
});

describe("cuesFor is the mapping only", () => {
  it("runs where Web Audio does not exist", () => {
    expect(typeof globalThis.AudioContext).toBe("undefined");
  });

  it("names no browser API", () => {
    const source = readFileSync(path.join(import.meta.dirname, "sound.ts"), "utf8");
    expect(source).not.toMatch(/\b(AudioContext|window|document|localStorage|navigator)\s*[.([]/);
    expect(source).not.toMatch(/from\s+["'](react|\.\/sound-synth|\.\/sound-player)["']/);
  });
});
