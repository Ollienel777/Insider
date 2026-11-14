// The scan as the Run view (issue 107), on a stubbed Inside view: W plays the
// engine's move to the hop in view and nothing when none is; the camera
// follows the player's node and one hop is in flight at a time; the board
// takes over when the player does not open, fails, or does not arrive; and
// Tactical and fixture floors never show the scan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsidePose, InsideView, ScanPoint } from "@/adapters/matterport";
import { attachScanControls, LOOK_DEGREES_PER_PIXEL, stepMs } from "./controls";
import {
  createScanWalk,
  HOP_GRACE_MS,
  SCAN_OPEN_MS,
  scanIsStage,
  SETTLE_MS,
  type ScanWalkState,
} from "./scan-walk";

/** Three positions: the player starts at a; b is 2 m east, c 3 m south. */
const POINTS: ReadonlyMap<string, ScanPoint> = new Map([
  ["a", { x: 0, y: 0, z: 0 }],
  ["b", { x: 2, y: 0, z: 0 }],
  ["c", { x: 0, y: 0, z: 3 }],
]);
const FRAME = { w: 1000, h: 800 };
const standingAt = (id: string): InsidePose => {
  const p = POINTS.get(id)!;
  return { position: { x: p.x, y: p.y + 1.5, z: p.z }, rotation: { x: 0, y: 0 } };
};

/**
 * An Inside view whose camera arrives where it is sent (unless told not to),
 * and whose frame shows only the position it `faces`, in the middle.
 */
function stubView(points: ReadonlyMap<string, ScanPoint> = POINTS) {
  const listeners = new Set<(pose: InsidePose) => void>();
  const control = { faces: null as string | null, arrives: true, settles: true };
  const emit = (pose: InsidePose) => listeners.forEach((l) => l(pose));
  const view = {
    moveTo: vi.fn<InsideView["moveTo"]>((id) => {
      if (!control.settles) return new Promise<void>(() => {});
      if (control.arrives) emit(standingAt(id));
      return Promise.resolve();
    }),
    rotate: vi.fn<InsideView["rotate"]>(async () => undefined),
    onPose: vi.fn<InsideView["onPose"]>((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    floorPoints: vi.fn<InsideView["floorPoints"]>(async () => points),
    project: vi.fn<InsideView["project"]>((point) => {
      const faced = control.faces ? points.get(control.faces) : undefined;
      return faced && faced.x === point.x && faced.z === point.z ? { x: FRAME.w / 2, y: FRAME.h * 0.7 } : null;
    }),
    disconnect: vi.fn(),
  } satisfies InsideView;
  return { view, control, emit, listeners };
}

/** A walk on the stubbed view, with the Run screen's side played by hand: `move` records, `follow` is the next render. */
function walkOn(hops: readonly string[] = ["b", "c"]) {
  const states: ScanWalkState[] = [];
  const move = vi.fn((sweepId: string) => hops.includes(sweepId));
  const onNoAim = vi.fn();
  const walk = createScanWalk({ move, hops: () => hops, size: () => FRAME, onChange: (s) => states.push(s), onNoAim });
  return { walk, move, onNoAim, states, last: () => states.at(-1) };
}

/** Opens the walk on `stub` at node a, and waits until the camera stands there. */
async function ready(w: ReturnType<typeof walkOn>, stub: ReturnType<typeof stubView>) {
  w.walk.follow("a");
  w.walk.opened(stub.view);
  await vi.advanceTimersByTimeAsync(0);
  expect(w.last()).toEqual({ phase: "ready", at: "a" });
}

/** A keyboard event as the controls read it (Node has no KeyboardEvent). */
const key = (type: "keydown" | "keyup", k: string, extra: Partial<KeyboardEvent> = {}) =>
  Object.assign(new Event(type, { cancelable: true }), { key: k, altKey: false, ctrlKey: false, metaKey: false, ...extra });

function pointer(type: string, x: number, y: number) {
  return Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 1 });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The controls on a layer, wired to `w` as the stage wires them. */
function controlsFor(w: ReturnType<typeof walkOn>, stub: ReturnType<typeof stubView>) {
  const layer = Object.assign(new EventTarget(), { setPointerCapture: vi.fn() }) as unknown as HTMLElement;
  const controls = attachScanControls({
    look: (dx, dy) => void stub.view.rotate(dx, dy),
    layer,
    target: () => w.walk.target(),
    step: (id) => w.walk.step(id),
  });
  return { layer, controls };
}

describe("the scan as the Run view", () => {
  it("opens, flies to the player's node, and is ready once the camera stands on it", async () => {
    const stub = stubView();
    const w = walkOn();
    w.walk.follow("a");
    expect(w.last()).toBeUndefined();
    w.walk.opened(stub.view);
    await vi.advanceTimersByTimeAsync(0);
    // The opening flight keeps the Inside view's own travel time.
    expect(stub.view.moveTo.mock.calls).toEqual([["a"]]);
    expect(w.states).toEqual([{ phase: "ready", at: "a" }]);
  });

  it("W plays the engine's move to the hop in view, and the camera follows the player's node", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    const { controls } = controlsFor(w, stub);
    stub.control.faces = "b";

    window.dispatchEvent(key("keydown", "w"));
    window.dispatchEvent(key("keyup", "w"));
    expect(w.move.mock.calls).toEqual([["b"]]);
    expect(controls.moving).toBe(true);

    // The Run screen's next render: the engine has the player at b, and the camera goes there in the hop's own time.
    w.walk.follow("b");
    expect(stub.view.moveTo.mock.calls.at(-1)).toEqual(["b", stepMs(2)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.last()).toEqual({ phase: "ready", at: "b" });
    expect(controls.moving).toBe(false);
    expect(w.move).toHaveBeenCalledTimes(1);
    controls.dispose();
  });

  it("the up arrow steps as W does", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    const { controls } = controlsFor(w, stub);
    stub.control.faces = "c";
    window.dispatchEvent(key("keydown", "ArrowUp"));
    window.dispatchEvent(key("keyup", "ArrowUp"));
    expect(w.move.mock.calls).toEqual([["c"]]);
    controls.dispose();
  });

  it("with no hop in view, W plays nothing and the screen is told to say turn", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    const { controls } = controlsFor(w, stub);
    stub.control.faces = null;
    const event = key("keydown", "w");
    window.dispatchEvent(event);
    window.dispatchEvent(key("keyup", "w"));
    expect(w.move).not.toHaveBeenCalled();
    expect(w.onNoAim).toHaveBeenCalledTimes(1);
    // The key is still the scan's: it never falls through to the board's wait.
    expect(event.defaultPrevented).toBe(true);
    controls.dispose();
  });

  it("a position in view that is not a legal hop is not stepped to", async () => {
    const stub = stubView();
    const w = walkOn(["c"]);
    await ready(w, stub);
    stub.control.faces = "b";
    expect(w.walk.target()).toBeNull();
    expect(w.onNoAim).toHaveBeenCalledTimes(1);
  });

  it("leaves W alone with a modifier held or while typing", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    const { controls } = controlsFor(w, stub);
    stub.control.faces = "b";
    window.dispatchEvent(key("keydown", "w", { ctrlKey: true }));
    const typing = { closest: (selector: string) => (selector.includes("input") ? {} : null) };
    window.dispatchEvent(Object.defineProperty(key("keydown", "w"), "target", { value: typing }));
    expect(w.move).not.toHaveBeenCalled();
    controls.dispose();
  });

  it("dragging turns the camera through the Inside view", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    const { layer, controls } = controlsFor(w, stub);
    layer.dispatchEvent(pointer("pointerdown", 100, 100));
    layer.dispatchEvent(pointer("pointermove", 110, 95));
    layer.dispatchEvent(pointer("pointerup", 110, 95));
    layer.dispatchEvent(pointer("pointermove", 200, 200));
    expect(stub.view.rotate.mock.calls).toEqual([[10 * LOOK_DEGREES_PER_PIXEL, -5 * LOOK_DEGREES_PER_PIXEL]]);
    controls.dispose();
  });

  it("holds one input at a time: nothing else steps from the move until the camera arrives", async () => {
    const stub = stubView();
    stub.control.arrives = false;
    const w = walkOn();
    w.walk.follow("a");
    w.walk.opened(stub.view);
    await vi.advanceTimersByTimeAsync(0);
    stub.emit(standingAt("a"));
    expect(w.last()).toEqual({ phase: "ready", at: "a" });

    stub.control.faces = "b";
    const first = w.walk.step("b");
    // Between the move and the Run screen's next render, and then during the flight, no second step is played.
    await w.walk.step("c");
    w.walk.follow("b");
    await w.walk.step("c");
    expect(w.walk.target()).toBeNull();
    expect(w.move.mock.calls).toEqual([["b"]]);
    expect(w.last()).toEqual({ phase: "ready", at: "a" });

    let done = false;
    void first.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    stub.emit(standingAt("b"));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(w.last()).toEqual({ phase: "ready", at: "b" });
  });

  it("a step the engine refuses plays nothing more and releases the key at once", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    w.move.mockReturnValueOnce(false);
    await w.walk.step("b");
    expect(stub.view.moveTo).toHaveBeenCalledTimes(1);
    expect(w.last()).toEqual({ phase: "ready", at: "a" });
  });

  it("tells the stage which hop W would take as the camera turns", async () => {
    const stub = stubView();
    const aims: (string | null)[] = [];
    const walk = createScanWalk({ move: () => true, hops: () => ["b", "c"], size: () => FRAME, onChange: () => {}, onAim: (id) => aims.push(id) });
    walk.follow("a");
    walk.opened(stub.view);
    await vi.advanceTimersByTimeAsync(0);
    stub.control.faces = "c";
    stub.emit({ ...standingAt("a"), rotation: { x: 0, y: 180 } });
    stub.control.faces = null;
    stub.emit({ ...standingAt("a"), rotation: { x: 0, y: 90 } });
    expect(aims).toEqual(["c", null]);
  });
});

describe("the board takes over", () => {
  it("when the player has not opened within 20 s", async () => {
    const w = walkOn();
    w.walk.follow("a");
    await vi.advanceTimersByTimeAsync(SCAN_OPEN_MS - 1);
    expect(w.last()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(w.last()).toEqual({ phase: "failed", failure: "timeout", at: null });
  });

  it("when the player opens but the camera never stands on the player's node within 20 s, retrying a refused move until then", async () => {
    const stub = stubView();
    stub.control.arrives = false;
    const w = walkOn();
    w.walk.follow("a");
    w.walk.opened(stub.view);
    await vi.advanceTimersByTimeAsync(SCAN_OPEN_MS);
    expect(stub.view.moveTo.mock.calls.length).toBeGreaterThan(1);
    expect(w.last()).toEqual({ phase: "failed", failure: "timeout", at: null });
  });

  it("when the player reports an error", () => {
    const w = walkOn();
    w.walk.follow("a");
    w.walk.failed();
    expect(w.last()).toEqual({ phase: "failed", failure: "error", at: null });
  });

  it("when the scan gives no floor points to stand on", async () => {
    const stub = stubView(new Map());
    const w = walkOn();
    w.walk.follow("a");
    w.walk.opened(stub.view);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.last()).toEqual({ phase: "failed", failure: "error", at: null });
  });

  it("when a hop settles and the camera is not on the player's node", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    stub.control.arrives = false;
    expect(w.walk.step("b")).toBeInstanceOf(Promise);
    w.walk.follow("b");
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(w.last()?.phase).toBe("ready");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.last()).toEqual({ phase: "failed", failure: "lost", at: "a" });
  });

  it("when a hop never settles", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    stub.control.settles = false;
    void w.walk.step("b");
    w.walk.follow("b");
    await vi.advanceTimersByTimeAsync(stepMs(2) + HOP_GRACE_MS);
    expect(w.last()).toEqual({ phase: "failed", failure: "lost", at: "a" });
  });

  it("and the run is not lost: a step waiting on the camera is let go, the walk plays nothing more and stops reading the pose", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    stub.control.settles = false;
    const waiting = w.walk.step("b");
    w.walk.follow("b");
    w.walk.failed();
    await expect(waiting).resolves.toBeUndefined();
    expect(stub.listeners.size).toBe(0);
    stub.control.faces = "c";
    expect(w.walk.target()).toBeNull();
    await w.walk.step("c");
    expect(w.move.mock.calls).toEqual([["b"]]);
  });

  it("lets go of a player that opens after it has failed", async () => {
    const stub = stubView();
    const w = walkOn();
    w.walk.failed();
    w.walk.opened(stub.view);
    expect(stub.view.disconnect).toHaveBeenCalledTimes(1);
    expect(stub.view.onPose).not.toHaveBeenCalled();
  });

  it("stops listening when the stage goes", async () => {
    const stub = stubView();
    const w = walkOn();
    await ready(w, stub);
    w.walk.dispose();
    expect(stub.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(SCAN_OPEN_MS);
    expect(w.last()?.phase).toBe("ready");
  });
});

describe("where the scan is the stage", () => {
  it("never in Tactical, whatever the scan", () => {
    for (const phase of ["opening", "ready", "failed"] as const) {
      expect(scanIsStage({ live: false, scan: true, phase })).toBe(false);
      expect(scanIsStage({ live: false, scan: false, phase })).toBe(false);
    }
  });

  it("never on a fixture floor, or wherever the player cannot open", () => {
    expect(scanIsStage({ live: true, scan: false, phase: "opening" })).toBe(false);
    expect(scanIsStage({ live: true, scan: false, phase: "ready" })).toBe(false);
  });

  it("in Live on a live scan, until it fails", () => {
    expect(scanIsStage({ live: true, scan: true, phase: "opening" })).toBe(true);
    expect(scanIsStage({ live: true, scan: true, phase: "ready" })).toBe(true);
    expect(scanIsStage({ live: true, scan: true, phase: "failed" })).toBe(false);
  });
});
