// Live mode's turn clock (issue 99) under fake timers: which turn the clock
// plays, when the countdown runs out, and what holds it. The engine half is on
// the cached F1 level placed on the F1 fixture floor, as the Run screen places
// it. The hook that mounts the clock is walked in tests/smoke/live.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { F1_DEMO, FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import { LevelManifest } from "@/domain";
import { act, applyChiefOrders, createRun, type Action, type RunState } from "@/engine";
import { placeLevel } from "@/level/placer";
import cached from "../../../data/levels/F1.romaine-1974.json";
import { choices } from "./board";
import { RUN_SEED } from "./run-screen";
import { FP_TURN_MS } from "./fp/tuning";
import { RADIO_HOLD_MS } from "./radio";
import {
  ALARM_BEAT_MS,
  alarmBeat,
  awaitingMove,
  clockAction,
  clockState,
  createTurnClock,
  followRun,
  LIVE_TURN_MS,
  NO_FIRST_MOVE,
  pressKey,
  sameTurn,
  turnLength,
} from "./turn-clock";

const manifest = LevelManifest.parse(structuredClone(cached));
const placed = placeLevel(manifest, structuredClone(FIXTURE_FLOORS.F1), RUN_SEED);
const start = () => createRun(placed.level);
const wait: Action = { kind: "wait" };
const move = (to: string): Action => ({ kind: "move", to });

function play(run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action, i) => {
    const result = act(state, action);
    if (!result.ok) throw new Error(`action ${i} (${JSON.stringify(action)}) refused: ${result.reason}`);
    return result.run;
  }, run);
}

/** The crew's quiet way to the records room door, which is locked and takes two picks. */
const toTheDoor = [move(F1_DEMO.freightLiftWait), wait, move("dc-west"), move("dc-mid"), move("dc-east")];
const DOOR = "d-records-room";
const pickOf = (run: RunState): Action => {
  const pick = choices(run).find((c) => c.kind === "pick");
  if (!pick) throw new Error(`no locked door beside ${run.playerNode}`);
  return pick.action;
};
const kinds = (run: RunState) => run.turns.map((t) => t.player.kind);

/**
 * The clock wired to the engine the way the Run screen wires it: a timeout
 * plays `clockAction` on the run as it stands, every turn played (the clock's
 * or the player's) starts the countdown over (for the alarm beat after a
 * sighting that raised the alarm), and a run that has ended holds it. The
 * Chief's orders land mid-turn through `land`, as `applyChiefOrders` on the run.
 */
function liveTable(from: RunState, turnMs: number = LIVE_TURN_MS) {
  let run = from;
  const turn = (action: Action) => {
    const result = act(run, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    run = result.run;
    clock.restart(turnLength(run, turnMs));
    if (run.status !== "playing") clock.hold(true);
  };
  const clock = createTurnClock(() => turn(clockAction(run)), turnMs);
  clock.hold(false);
  const land = (orders: Parameters<typeof applyChiefOrders>[1]) => {
    const applied = applyChiefOrders(run, orders);
    run = applied.run;
    return applied;
  };
  return { clock, act: turn, land, run: () => run };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the turn the clock plays", () => {
  it("is a wait when no lock is being picked", () => {
    expect(clockAction(start())).toEqual(wait);
    expect(clockAction(play(start(), toTheDoor))).toEqual(wait);
  });

  it("is the next pick of the lock the player is part-way through", () => {
    const atDoor = play(start(), toTheDoor);
    const pick = pickOf(atDoor);
    const picking = play(atDoor, [pick]);
    expect(picking.picking).toEqual({ doorId: DOOR, progress: 1 });
    expect(clockAction(picking)).toEqual(pick);
    // The pick that opens the door ends it: the clock goes back to waiting.
    const open = play(picking, [clockAction(picking)]);
    expect(open.locked).not.toContain(DOOR);
    expect(clockAction(open)).toEqual(wait);
  });

  it("is a wait again once any other action has ended the pick, as on the board", () => {
    const atDoor = play(start(), toTheDoor);
    for (const other of [wait, move("dc-mid")]) {
      const after = play(atDoor, [pickOf(atDoor), other]);
      expect(after.picking, JSON.stringify(other)).toBeNull();
      expect(clockAction(after), JSON.stringify(other)).toEqual(wait);
    }
  });

  it("is a wait when the door being picked has come unlocked, so the engine never refuses the clock", () => {
    const atDoor = play(start(), toTheDoor);
    const picking = play(atDoor, [pickOf(atDoor)]);
    const unlocked: RunState = { ...picking, locked: picking.locked.filter((d) => d !== DOOR) };
    expect(act(unlocked, { kind: "pick", doorId: DOOR }).ok).toBe(false);
    expect(clockAction(unlocked)).toEqual(wait);
    expect(act(unlocked, clockAction(unlocked)).ok).toBe(true);
  });
});

describe("the same turn", () => {
  it("is the same board and turn number: the Chief's orders make a new state of it, a played turn or a new run does not", () => {
    const run = start();
    expect(sameTurn(run, { ...run, chief: { orders: [], lockZones: [], rationale: "Hold." } })).toBe(true);
    expect(sameTurn(run, play(run, [wait]))).toBe(false);
    expect(sameTurn(run, start())).toBe(false);
    expect(sameTurn(run, null)).toBe(false);
    expect(sameTurn(null, null)).toBe(false);
  });
});

describe("the clock's state", () => {
  const playing = start();
  const caught = play(start(), [move(F1_DEMO.freightLiftWait), wait, move("dc-west"), wait, wait, wait]);
  const on = { live: true, run: playing, paused: false, held: false };

  it("is off in Tactical whatever else is true, and off with no run on the board", () => {
    expect(caught.status).toBe("caught");
    for (const run of [playing, caught, null]) {
      for (const paused of [false, true]) {
        for (const held of [false, true]) expect(clockState({ live: false, run, paused, held })).toBe("off");
      }
    }
    expect(clockState({ ...on, run: null })).toBe("off");
  });

  it("runs in Live on a run being played", () => {
    expect(clockState(on)).toBe("running");
  });

  it("is paused by the player, and held by a Why card, a hidden tab or the caller; the pause shows over a hold", () => {
    expect(clockState({ ...on, paused: true })).toBe("paused");
    expect(clockState({ ...on, held: true })).toBe("held");
    expect(clockState({ ...on, paused: true, held: true })).toBe("paused");
  });

  it("is over once the run has ended, paused or held or not", () => {
    for (const paused of [false, true]) {
      for (const held of [false, true]) expect(clockState({ ...on, run: caught, paused, held })).toBe("over");
    }
  });
});

describe("the countdown", () => {
  it("is one named number, 1100 ms", () => {
    expect(LIVE_TURN_MS).toBe(1100);
  });

  it("is made held, and once released runs out after a turn, and again after every turn", () => {
    const onTimeout = vi.fn();
    const clock = createTurnClock(onTimeout);
    vi.advanceTimersByTime(LIVE_TURN_MS * 3);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(clock.left()).toBe(LIVE_TURN_MS);

    clock.hold(false);
    vi.advanceTimersByTime(LIVE_TURN_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(clock.left()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LIVE_TURN_MS * 2);
    expect(onTimeout).toHaveBeenCalledTimes(3);
  });

  it("starts over with a whole turn when it is restarted", () => {
    const onTimeout = vi.fn();
    const clock = createTurnClock(onTimeout);
    clock.hold(false);
    vi.advanceTimersByTime(800);
    clock.restart();
    expect(clock.left()).toBe(LIVE_TURN_MS);
    vi.advanceTimersByTime(LIVE_TURN_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("held, keeps the time it had left, and runs on from there", () => {
    const onTimeout = vi.fn();
    const clock = createTurnClock(onTimeout);
    clock.hold(false);
    vi.advanceTimersByTime(700);
    clock.hold(true);
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(clock.left()).toBe(LIVE_TURN_MS - 700);

    clock.hold(false);
    vi.advanceTimersByTime(LIVE_TURN_MS - 700 - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("restarted while held, stays held with a whole turn left", () => {
    const onTimeout = vi.fn();
    const clock = createTurnClock(onTimeout);
    clock.hold(false);
    vi.advanceTimersByTime(700);
    clock.hold(true);
    clock.restart();
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(clock.left()).toBe(LIVE_TURN_MS);
    clock.hold(false);
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("released twice, is still one countdown, not two", () => {
    const onTimeout = vi.fn();
    const clock = createTurnClock(onTimeout);
    clock.hold(false);
    vi.advanceTimersByTime(500);
    clock.hold(false);
    vi.advanceTimersByTime(LIVE_TURN_MS - 500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(onTimeout).toHaveBeenCalledTimes(2);
  });

  it("goes on after a timeout nobody could play, and fires nothing once stopped", () => {
    const onTimeout = vi.fn();
    const clock = createTurnClock(onTimeout);
    clock.hold(false);
    // Nothing restarts it between laps, as when the engine refuses the clock's turn.
    vi.advanceTimersByTime(LIVE_TURN_MS * 2);
    expect(onTimeout).toHaveBeenCalledTimes(2);
    clock.stop();
    clock.hold(false);
    clock.restart();
    vi.advanceTimersByTime(LIVE_TURN_MS * 5);
    expect(onTimeout).toHaveBeenCalledTimes(2);
  });
});

describe("the clock on a run", () => {
  it("with no input, plays one wait every LIVE_TURN_MS, each the turn a W would have played", () => {
    const table = liveTable(start());
    vi.advanceTimersByTime(LIVE_TURN_MS - 1);
    expect(table.run().turn).toBe(0);
    vi.advanceTimersByTime(1);
    expect(table.run().turn).toBe(1);
    vi.advanceTimersByTime(LIVE_TURN_MS * 2);
    expect(kinds(table.run())).toEqual(["wait", "wait", "wait"]);
    // The log, and so the Debrief's replay, is the one three waits by hand give.
    expect(table.run().turns).toEqual(play(start(), [wait, wait, wait]).turns);
  });

  it("starts the countdown over when the player acts", () => {
    const table = liveTable(start());
    vi.advanceTimersByTime(LIVE_TURN_MS - 100);
    table.act(move(F1_DEMO.freightLiftWait));
    vi.advanceTimersByTime(LIVE_TURN_MS - 1);
    expect(kinds(table.run())).toEqual(["move"]);
    vi.advanceTimersByTime(1);
    expect(kinds(table.run())).toEqual(["move", "wait"]);
  });

  it("paused, plays nothing; resumed, plays the turn when the time left has passed", () => {
    const table = liveTable(start());
    vi.advanceTimersByTime(400);
    table.clock.hold(true);
    vi.advanceTimersByTime(60_000);
    expect(table.run().turn).toBe(0);
    table.clock.hold(false);
    vi.advanceTimersByTime(LIVE_TURN_MS - 400 - 1);
    expect(table.run().turn).toBe(0);
    vi.advanceTimersByTime(1);
    expect(table.run().turn).toBe(1);
  });

  it("carries on a pick in progress, where a wait would have thrown it away", () => {
    const atDoor = play(start(), toTheDoor);
    const table = liveTable(atDoor);
    table.act(pickOf(atDoor));
    expect(table.run().locked).toContain(DOOR);
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(kinds(table.run()).slice(-2)).toEqual(["pick", "pick"]);
    expect(table.run().locked).not.toContain(DOOR);
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(kinds(table.run()).at(-1)).toBe("wait");
    // A wait in the clock's place loses the first pick: the door is still locked.
    const waited = play(atDoor, [pickOf(atDoor), wait]);
    expect(waited.picking).toBeNull();
    expect(waited.locked).toContain(DOOR);
  });

  it("can raise the alarm on its own turn, and stops when the run ends", () => {
    // In C2's half of the dock corridor on a turn it looks away: the clock's wait is the turn it looks back.
    const table = liveTable(play(start(), [move(F1_DEMO.freightLiftWait), wait, move("dc-west")]));
    expect(table.run().alarm).toBe("calm");
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(table.run().alarm).toBe("alert");
    expect(table.run().alarmEvents.at(-1)).toMatchObject({ from: "calm", to: "alert", cause: { kind: "camera", id: "C2" } });
    // The alarm beat, then one turn: the two turns that catch the player.
    vi.advanceTimersByTime(ALARM_BEAT_MS + LIVE_TURN_MS - 1);
    expect(table.run().status).toBe("playing");
    vi.advanceTimersByTime(1);
    expect(table.run().status).toBe("caught");
    const turns = table.run().turn;
    vi.advanceTimersByTime(LIVE_TURN_MS * 10);
    expect(table.run().turn).toBe(turns);
  });
});

/**
 * First person's clock (issue 171), wired as `useTurnClock` wires it: the
 * first move is one hold beside the caller's (`scanHold`, the hold first
 * person on a scan adds while its picture comes in), and a key counts only
 * once nothing else holds the clock.
 */
function firstPersonTable(from: RunState, { scanHold = false } = {}) {
  let run = from;
  let gate = followRun(NO_FIRST_MOVE, true, run);
  let held = scanHold;
  let paused = false;
  const sync = () => {
    gate = followRun(gate, true, run);
    clock.hold(paused || held || awaitingMove(gate) || run.status !== "playing");
  };
  const turn = (action: Action) => {
    const result = act(run, action);
    if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
    run = result.run;
    clock.restart(turnLength(run, LIVE_TURN_MS));
    sync();
  };
  const clock = createTurnClock(() => turn(clockAction(run)));
  sync();
  return {
    run: () => run,
    waiting: () => awaitingMove(gate),
    act: turn,
    key: (code: string) => {
      gate = pressKey(gate, code, held);
      sync();
    },
    hold: (on: boolean) => {
      held = on;
      sync();
    },
    pause: (on: boolean) => {
      paused = on;
      sync();
    },
    restart: () => {
      run = from;
      clock.restart();
      sync();
    },
  };
}

describe("first person's clock, which starts on the first move", () => {
  it("plays nothing while the player only looks, so the log holds no turns", () => {
    const table = firstPersonTable(start());
    expect(table.waiting()).toBe(true);
    // The mouse and ← → turn the view: neither is a move.
    table.key("ArrowLeft");
    table.key("ArrowRight");
    table.key("KeyP");
    vi.advanceTimersByTime(LIVE_TURN_MS * 10);
    expect(table.run().turn).toBe(0);
    expect(table.run().turns).toEqual([]);
    expect(table.waiting()).toBe(true);
  });

  it("ticks once the player moves, each turn the wait it would have been on the board", () => {
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "KeyE"]) {
      const table = firstPersonTable(start());
      vi.advanceTimersByTime(LIVE_TURN_MS * 3);
      table.key(code);
      expect(table.waiting(), code).toBe(false);
      vi.advanceTimersByTime(LIVE_TURN_MS * 3);
      expect(table.run().turn, code).toBeGreaterThanOrEqual(2);
      expect(kinds(table.run()).every((k) => k === "wait"), code).toBe(true);
    }
  });

  it("counts a turn the player plays while it waits (a number key, a walk into the next node) as the first move", () => {
    const table = firstPersonTable(start());
    table.act(move(F1_DEMO.freightLiftWait));
    expect(table.waiting()).toBe(false);
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(kinds(table.run())).toEqual(["move", "wait"]);
  });

  it("waits behind another hold: a key while that hold is on is not the first move, and the wait starts when it lifts", () => {
    const table = firstPersonTable(start(), { scanHold: true });
    table.key("KeyW");
    expect(table.waiting()).toBe(true);
    table.hold(false);
    vi.advanceTimersByTime(LIVE_TURN_MS * 5);
    expect(table.run().turn).toBe(0);
    table.key("KeyW");
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(table.run().turn).toBe(1);
    // The other hold still holds the clock after the first move, and keeps the time left.
    table.hold(true);
    vi.advanceTimersByTime(LIVE_TURN_MS * 5);
    expect(table.run().turn).toBe(1);
    table.hold(false);
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(table.run().turn).toBe(2);
  });

  it("still pauses: paused, plays nothing; resumed, runs on; a move while paused is the first move", () => {
    const table = firstPersonTable(start());
    table.pause(true);
    table.key("KeyW");
    vi.advanceTimersByTime(LIVE_TURN_MS * 5);
    expect(table.run().turn).toBe(0);
    table.pause(false);
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(table.run().turn).toBe(1);
    table.pause(true);
    vi.advanceTimersByTime(LIVE_TURN_MS * 5);
    expect(table.run().turn).toBe(1);
    table.pause(false);
    vi.advanceTimersByTime(LIVE_TURN_MS);
    expect(table.run().turn).toBe(2);
  });

  it("waits again after a restart, and on entering first person again; off it, never waits", () => {
    const table = firstPersonTable(start());
    table.key("KeyW");
    vi.advanceTimersByTime(LIVE_TURN_MS * 2);
    expect(table.run().turn).toBe(2);
    table.restart();
    expect(table.waiting()).toBe(true);
    vi.advanceTimersByTime(LIVE_TURN_MS * 5);
    expect(table.run().turn).toBe(0);

    const fresh = start();
    const moved = pressKey(followRun(NO_FIRST_MOVE, true, fresh), "KeyW", false);
    expect(awaitingMove(moved)).toBe(false);
    const board = followRun(moved, false, fresh);
    expect(awaitingMove(board)).toBe(false);
    expect(awaitingMove(followRun(board, true, fresh))).toBe(true);
    // Unchanged, the same object: the hook keeps it in state without a render loop.
    expect(followRun(moved, true, fresh)).toBe(moved);
    // A new run (a level placed again) waits again.
    expect(awaitingMove(followRun(moved, true, start()))).toBe(true);
  });
});

/**
 * The alarm beat (issue 222): seen by C2 in the dock corridor in first
 * person, the player used to be caught two 700 ms turns later, before the
 * radio had read the Chief's re-plan. The turn after the sighting now waits
 * `ALARM_BEAT_MS`, so the re-plan is on the air, and the guards move on it,
 * before the capture; the turns played are the same.
 */
describe("the alarm beat", () => {
  const inC2 = () => play(start(), [move(F1_DEMO.freightLiftWait), wait, move("dc-west")]);

  /** Lets first person's clock run in 10 ms steps until the run ends; when the alarm rose and when it ended. */
  function standInTheLight(onAir?: (table: ReturnType<typeof liveTable>) => void) {
    const table = liveTable(inC2(), FP_TURN_MS);
    let now = 0;
    let seenAt: number | null = null;
    let aired = false;
    while (table.run().status === "playing" && now < 20_000) {
      vi.advanceTimersByTime(10);
      now += 10;
      if (seenAt === null && table.run().alarm !== "calm") seenAt = now;
      // The radio reads the sighting's callout for its hold, then the Chief's re-plan: his orders land then at the latest.
      if (onAir && seenAt !== null && !aired && now >= seenAt + RADIO_HOLD_MS) {
        aired = true;
        onAir(table);
      }
    }
    return { run: table.run(), seenAt: seenAt!, caughtAt: now };
  }

  it("follows only the turn whose sighting raised the alarm into Alert or Lockdown", () => {
    const seen = play(inC2(), [wait]);
    expect(seen.alarmEvents.at(-1)).toMatchObject({ turn: seen.turn - 1, from: "calm", to: "alert" });
    expect(alarmBeat(seen)).toBe(true);
    expect(turnLength(seen, FP_TURN_MS)).toBe(ALARM_BEAT_MS);
    expect(alarmBeat(inC2())).toBe(false);
    expect(alarmBeat(null)).toBe(false);
    expect(turnLength(inC2(), FP_TURN_MS)).toBe(FP_TURN_MS);
  });

  it("gives the player 2 to 4 s between the sighting and the capture, the same turns as without it", () => {
    const { run, seenAt, caughtAt } = standInTheLight();
    expect(run.status).toBe("caught");
    expect(caughtAt - seenAt).toBeGreaterThanOrEqual(2000);
    expect(caughtAt - seenAt).toBeLessThanOrEqual(4000);
    // Time, not turns: the log (and so the Debrief and Owner Mode) is the one waits by hand give.
    const turns = run.turns.length - inC2().turns.length;
    expect(run.turns).toEqual(play(inC2(), Array.from({ length: turns }, () => wait)).turns);
  });

  it("has the Chief's re-plan event out on the sighting turn, and his orders move a guard before the capture", () => {
    let applied: ReturnType<ReturnType<typeof liveTable>["land"]> | null = null;
    const { run, seenAt, caughtAt } = standInTheLight((table) => {
      const now = table.run();
      // The re-plan the Chief is asked for: the event the sighting appended.
      expect(now.alarmEvents.at(-1)).toMatchObject({ from: "calm", to: "alert", cause: { kind: "camera", id: "C2" } });
      expect(now.status).toBe("playing");
      const zoneId = now.lastKnown!.zoneId;
      applied = table.land({ orders: now.guards.map((g) => ({ guardId: g.id, zoneId, intent: "converge" as const })), lockZones: [], rationale: "C2 has them." });
    });
    expect(applied!.applied.length).toBeGreaterThan(0);
    expect(run.status).toBe("caught");
    // A turn was played on his orders (its log entry carries them) before the run ended, a second or more after he went on air.
    expect(run.turns.some((t) => t.chief)).toBe(true);
    expect(caughtAt - (seenAt + RADIO_HOLD_MS)).toBeGreaterThanOrEqual(1000);
  });
});
