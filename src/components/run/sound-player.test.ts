// The sound player (issue 101) on a stand-in audio context: when the context
// is opened, what a change of run schedules, what ends it, and that a browser
// with no Web Audio, or one that throws, costs the run nothing.
import { describe, expect, it, vi } from "vitest";
import type { FloorGraph } from "@/domain";
import { act, applyChiefOrders, createRun, setAlarm, type Action, type Level, type RunState } from "@/engine";
import { FakeAudioContext } from "./sound-fake-audio";
import { createSoundPlayer, openAudio, type SoundPlayer } from "./sound-player";

/** Nodes n0…n7 in a line, one room, no sightlines: a guard sees its own node only. */
function lineFloor(): FloorGraph {
  const ids = Array.from({ length: 8 }, (_, i) => `n${i}`);
  return {
    nodes: ids.map((id, i) => ({ id, x: i, y: 0, roomId: "hall", tags: [] })),
    edges: ids.slice(1).map((id, i) => ({ a: ids[i], b: id })),
    rooms: [{ id: "hall", label: "Hall", rect: { x: 0, y: 0, w: 8, h: 1 } }],
    sightlines: {},
    source: "fixture",
  };
}

/** In at n0, with a guard standing on n3: every turn has its pulse, and walking onto n3 is the end. */
function level(): Level {
  return {
    buildingId: "T",
    missionId: "t",
    seed: 1,
    floor: lineFloor(),
    start: "n0",
    objective: "n7",
    exits: ["n0"],
    lockedDoors: [],
    pickTurns: 2,
    patrolTempo: 1,
    guards: [{ id: "G1", patrol: ["n3"] }],
  };
}

const wait: Action = { kind: "wait" };
const move = (to: string): Action => ({ kind: "move", to });

function play(run: RunState, action: Action): RunState {
  const result = act(run, action);
  if (!result.ok) throw new Error(`${JSON.stringify(action)} refused: ${result.reason}`);
  return result.run;
}

/** A player over one stand-in context, which `open` hands out and counts. */
function setup(state: "suspended" | "running" = "running") {
  const ctx = new FakeAudioContext(state);
  const open = vi.fn(() => ctx.asContext());
  return { ctx, open, player: createSoundPlayer(open) };
}

/** A player that has had its gesture and been shown a fresh run. */
function playing() {
  const made = setup();
  const run = createRun(level());
  made.player.wake();
  made.player.follow(run);
  return { ...made, run };
}

/** Plays `actions` in turn, showing the player each state. */
function turns(player: SoundPlayer, run: RunState, actions: readonly Action[]): RunState {
  return actions.reduce((state, action) => {
    const next = play(state, action);
    player.follow(next);
    return next;
  }, run);
}

describe("when audio starts", () => {
  it("not before the first click or key press, however much the run changes", () => {
    const { ctx, open, player } = setup();
    const run = createRun(level());
    player.follow(null);
    player.follow(run);
    turns(player, run, [move("n1"), wait]);
    player.setMuted(false);
    expect(open).not.toHaveBeenCalled();
    expect(ctx.started).toEqual([]);
  });

  it("on the first one, once; and the turn that follows is heard", () => {
    const { ctx, open, player } = setup();
    const run = createRun(level());
    player.follow(run);
    player.wake();
    player.wake();
    expect(open).toHaveBeenCalledTimes(1);
    expect(ctx.started).toEqual([]);
    turns(player, run, [move("n1")]);
    expect(ctx.started.length).toBeGreaterThan(0);
  });

  it("resumes a context the browser holds suspended, on each gesture until it runs", () => {
    const { ctx, player } = setup("suspended");
    player.wake();
    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe("running");
    player.wake();
    expect(ctx.resumes).toBe(1);
  });

  it("keeps only the newest turn queued on a context that is not running, so nothing comes back as a burst", () => {
    const ctx = new FakeAudioContext("suspended");
    // A browser that will not let it run: resuming changes nothing, and its clock stands still.
    ctx.resume = () => Promise.resolve();
    const player = createSoundPlayer(() => ctx.asContext());
    let run = createRun(level());
    player.follow(run);
    player.wake();
    const perTurn: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = ctx.started.length;
      run = turns(player, run, [wait]);
      perTurn.push(ctx.started.length - before);
    }
    expect(perTurn.every((count) => count > 0)).toBe(true);
    expect(ctx.soundingAfter().length).toBe(perTurn[3]);
  });
});

describe("following the run", () => {
  it("plays nothing for the first run it is shown, or for the same state again", () => {
    const { ctx, player } = setup();
    player.wake();
    const run = play(createRun(level()), move("n1"));
    player.follow(run);
    player.follow(run);
    expect(ctx.started).toEqual([]);
  });

  it("plays nothing on a restart, and ends what the old run was still sounding", () => {
    const { ctx, player, run } = playing();
    // Walking onto the guard's node at Calm: seen, Alert and caught in one turn.
    const caught = turns(player, run, [move("n1"), move("n2"), move("n3")]);
    expect(caught).toMatchObject({ status: "caught", alarm: "alert" });
    ctx.advance(0.05);
    expect(ctx.soundingAfter().length).toBeGreaterThan(0);
    const before = ctx.started.length;
    player.follow(createRun(level()));
    expect(ctx.started.length).toBe(before);
    expect(ctx.soundingAfter()).toEqual([]);
  });

  it("ends everything when the board goes away", () => {
    const { ctx, player, run } = playing();
    turns(player, run, [wait]);
    expect(ctx.soundingAfter().length).toBeGreaterThan(0);
    player.follow(null);
    expect(ctx.soundingAfter()).toEqual([]);
  });

  it("each turn's pulse replaces the last, so quick turns never stack them", () => {
    const { ctx, player, run } = playing();
    const one = turns(player, run, [wait]);
    const first = [...ctx.started];
    expect(first.length).toBeGreaterThan(0);
    ctx.advance(0.05);
    turns(player, one, [wait]);
    for (const beat of first) expect(beat.stopAt).toBeLessThanOrEqual(ctx.currentTime);
    const left = ctx.soundingAfter();
    expect(left.length).toBe(first.length);
    expect(left.some((source) => first.includes(source))).toBe(false);
  });

  it("leaves the pulse alone when the Chief's orders land between turns", () => {
    const { ctx, player } = setup();
    player.wake();
    const run = setAlarm(createRun(level()), "alert");
    player.follow(run);
    const turned = turns(player, run, [wait]);
    const sounding = ctx.soundingAfter().length;
    expect(sounding).toBeGreaterThan(0);
    const ordered = applyChiefOrders(turned, {
      orders: [{ guardId: "G1", zoneId: "hall", intent: "hold" }],
      lockZones: [],
      rationale: "Hold the hall.",
    });
    expect(ordered.applied).toHaveLength(1);
    const before = ctx.started.length;
    player.follow(ordered.run);
    expect(ctx.started.length).toBe(before);
    expect(ctx.soundingAfter().length).toBe(sounding);
  });

  it("once the run has ended, the pulse is gone and what is left ends by itself", () => {
    const { ctx, player, run } = playing();
    const near = turns(player, run, [move("n1"), move("n2")]);
    ctx.advance(2);
    // A wait one hop from the guard: all this turn starts is the pulse.
    const before = ctx.started.length;
    const waited = turns(player, near, [wait]);
    const beats = ctx.started.slice(before);
    expect(beats.length).toBeGreaterThan(0);
    ctx.advance(0.05);

    const caught = turns(player, waited, [move("n3")]);
    expect(caught.status).toBe("caught");
    for (const beat of beats) expect(beat.stopAt).toBeLessThanOrEqual(ctx.currentTime);
    expect(ctx.soundingAfter().length).toBeGreaterThan(0);
    ctx.advance(1);
    expect(ctx.soundingAfter()).toEqual([]);
  });
});

describe("mute", () => {
  it("muted from the start, no context is opened, by any gesture or any turn", () => {
    const { open, player } = setup();
    player.setMuted(true);
    const run = createRun(level());
    player.follow(run);
    player.wake();
    turns(player, run, [wait]);
    expect(open).not.toHaveBeenCalled();
  });

  it("unmuting after a gesture opens it, and the next turn is heard", () => {
    const { ctx, open, player } = setup();
    player.setMuted(true);
    const run = createRun(level());
    player.follow(run);
    player.wake();
    player.setMuted(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(ctx.started).toEqual([]);
    turns(player, run, [wait]);
    expect(ctx.started.length).toBeGreaterThan(0);
  });

  it("silences everything at once, and nothing is scheduled while it is on", () => {
    const { ctx, player, run } = playing();
    const one = turns(player, run, [wait]);
    ctx.advance(0.05);
    expect(ctx.soundingAfter().length).toBeGreaterThan(0);

    player.setMuted(true);
    expect(ctx.soundingAfter()).toEqual([]);
    const before = ctx.started.length;
    const two = turns(player, one, [move("n1")]);
    expect(ctx.started.length).toBe(before);

    // Unmuted, the turns already played stay unheard; the next one sounds.
    player.setMuted(false);
    expect(ctx.started.length).toBe(before);
    turns(player, two, [wait]);
    expect(ctx.started.length).toBeGreaterThan(before);
  });
});

describe("closing", () => {
  it("ends every sound and closes the context; later calls do nothing", () => {
    const { ctx, open, player, run } = playing();
    const one = turns(player, run, [wait]);
    expect(ctx.soundingAfter().length).toBeGreaterThan(0);

    player.close();
    expect(ctx.soundingAfter()).toEqual([]);
    expect(ctx.state).toBe("closed");

    const before = ctx.started.length;
    player.wake();
    player.setMuted(false);
    turns(player, one, [wait]);
    player.close();
    expect(open).toHaveBeenCalledTimes(1);
    expect(ctx.started.length).toBe(before);
  });

  it("before any gesture there is nothing to close, and nothing is opened afterwards", () => {
    const { open, player } = setup();
    expect(() => player.close()).not.toThrow();
    player.wake();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("where Web Audio is missing or blocked, the run plays on", () => {
  /** A whole run through the player: gestures, turns, mute, a restart and the close. */
  function wholeRun(player: SoundPlayer) {
    const run = createRun(level());
    player.follow(null);
    player.follow(run);
    player.wake();
    turns(player, run, [move("n1"), move("n2"), move("n3")]);
    player.wake();
    player.setMuted(true);
    player.setMuted(false);
    player.follow(createRun(level()));
    player.close();
  }

  it("in this test's own world, which has no AudioContext at all", () => {
    expect(typeof globalThis.AudioContext).toBe("undefined");
    expect(openAudio()).toBeNull();
    expect(() => wholeRun(createSoundPlayer())).not.toThrow();
  });

  it("when the browser has none: it is asked once and never again", () => {
    const open = vi.fn(() => null);
    expect(() => wholeRun(createSoundPlayer(open))).not.toThrow();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("when opening it throws", () => {
    const open = vi.fn((): AudioContext => {
      throw new DOMException("audio is not allowed", "NotAllowedError");
    });
    expect(() => wholeRun(createSoundPlayer(open))).not.toThrow();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("when the context it is given cannot build a thing", () => {
    const refuse = () => {
      throw new DOMException("the context is broken", "InvalidStateError");
    };
    const broken = new FakeAudioContext();
    broken.createGain = refuse;
    broken.createOscillator = refuse;
    broken.createBufferSource = refuse;
    expect(() => wholeRun(createSoundPlayer(() => broken.asContext()))).not.toThrow();
    // It was given back: a context that cannot be used is closed, not left open.
    expect(broken.state).toBe("closed");
  });

  it("when the context breaks part-way through a run", () => {
    const { ctx, player, run } = playing();
    ctx.createOscillator = () => {
      throw new DOMException("the context is broken", "InvalidStateError");
    };
    expect(() => turns(player, run, [wait, move("n1")])).not.toThrow();
    expect(() => wholeRun(player)).not.toThrow();
  });

  it("when resuming or closing is refused", async () => {
    const ctx = new FakeAudioContext("suspended");
    ctx.resume = () => Promise.reject(new DOMException("not allowed", "NotAllowedError"));
    ctx.close = () => Promise.reject(new DOMException("already closed", "InvalidStateError"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      expect(() => wholeRun(createSoundPlayer(() => ctx.asContext()))).not.toThrow();
      await new Promise((done) => setTimeout(done, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
