// The parts of the scan controls that are free of the DOM (issue #109): the
// geometry measured on a real scan, which position a key travels to, how long a
// hop is asked to take, and the walk's state from hop to hop.
import { describe, expect, it } from "vitest";
import {
  bearingOf,
  createWalker,
  DEFAULT_TUNING,
  DROPPED_STEP_MS,
  forwardOf,
  pickTarget,
  RETRY_MS,
  scoreHops,
  stepMs,
  wrapDegrees,
  type Pose,
  type Vec3,
  type WalkIntent,
} from "./controls";

const at = (x: number, z: number): Vec3 => ({ x, y: 0, z });
/** A camera at eye height over (x, z), with yaw in the SDK's degrees. Yaw 0 looks down -z. */
const pose = (x: number, z: number, yaw = 0, pitch = 0): Pose => ({ position: { x, y: 1.5, z }, rotation: { x: pitch, y: yaw } });
const aimAt = (points: Record<string, Vec3>, p: Pose, more: object = {}) => ({
  pose: p,
  hops: Object.keys(points),
  floorPoint: (id: string) => points[id],
  ...more,
});

describe("geometry, as a real scan measured it", () => {
  it("faces down -z at yaw 0, and a point to the +x side is to the right", () => {
    expect(forwardOf(0).x).toBeCloseTo(0);
    expect(forwardOf(0).z).toBeCloseTo(-1);
    expect(bearingOf(pose(0, 0), at(0, -3))).toBeCloseTo(0);
    expect(bearingOf(pose(0, 0), at(3, -3))).toBeCloseTo(45);
    expect(bearingOf(pose(0, 0), at(-3, -3))).toBeCloseTo(-45);
    expect(Math.abs(bearingOf(pose(0, 0), at(0, 3)))).toBeCloseTo(180);
  });

  it("matches the scan: at yaw 123.75 a position 24 degrees right of the view reads +24", () => {
    // From the spike's log: forward is (-sin yaw, -cos yaw), and Camera.rotate(+h) lowers the yaw and turns right.
    const yaw = 123.75;
    const p = pose(0, 0, yaw);
    const rightOfView = forwardOf(yaw - 24);
    expect(bearingOf(p, at(rightOfView.x * 2, rightOfView.z * 2))).toBeCloseTo(24);
  });

  it("wraps angles into (-180, 180]", () => {
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-190)).toBe(170);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(720)).toBe(0);
  });
});

describe("stepMs", () => {
  it("keeps the walking speed, less the player's own overhead", () => {
    const { walkMetresPerSecond: speed, stepOverheadMs: overhead } = DEFAULT_TUNING;
    expect(stepMs(2)).toBe(Math.round((2 / speed) * 1000 - overhead));
    expect(stepMs(4)).toBe(Math.round((4 / speed) * 1000 - overhead));
    // Twice the distance takes twice the time, end to end.
    expect(stepMs(4) + overhead).toBe(2 * (stepMs(2) + overhead));
  });

  it("is bounded for very short and very long hops", () => {
    expect(stepMs(0.1)).toBe(DEFAULT_TUNING.minStepMs);
    expect(stepMs(40)).toBe(DEFAULT_TUNING.maxStepMs);
  });
});

describe("pickTarget", () => {
  it("picks a position 1 m ahead while looking level, though its floor point is below the screen", () => {
    // The first spike aimed by screen position, so this hop could never be walked to.
    expect(pickTarget(aimAt({ near: at(0, -1) }, pose(0, 0)))).toBe("near");
  });

  it("answers null when every position is outside the aim window: the player faces a wall", () => {
    const points = { side: at(3, -1), behind: at(0, 3) };
    expect(pickTarget(aimAt(points, pose(0, 0)))).toBeNull();
  });

  it("takes the next position along a corridor, not one further down it", () => {
    const corridor = { a: at(0.1, -2), b: at(0, -4), c: at(0, -6) };
    expect(pickTarget(aimAt(corridor, pose(0, 0)))).toBe("a");
  });

  it("takes a stride through closely spaced positions, not a shuffle of short hops", () => {
    // A dense scan: positions every 0.7 m in a line. Each hop eases in and out, so 0.7 m hops stutter.
    const dense = { p1: at(0, -0.7), p2: at(0, -1.4), p3: at(0, -2.1), p4: at(0, -2.8), p5: at(0, -3.5) };
    const picked = pickTarget(aimAt(dense, pose(0, 0)))!;
    expect(["p3", "p4"]).toContain(picked);
  });

  it("takes a far position dead ahead over a near one well off to the side", () => {
    const room = { near: at(0.5, -1), far: at(0, -4.9) };
    // near is 26.6 degrees off and 1.4 m short of a stride; far is dead ahead and 2.4 m over it.
    expect(pickTarget(aimAt(room, pose(0, 0)))).toBe("far");
  });

  it("ignores the position the player stands on", () => {
    expect(pickTarget(aimAt({ here: at(0.1, -0.1), ahead: at(0, -2) }, pose(0, 0)))).toBe("ahead");
  });

  it("widens the aim while a walk is under way, so a bend does not stop it", () => {
    const bend = { round: at(2.4, -2) }; // 50 degrees right
    expect(pickTarget(aimAt(bend, pose(0, 0)))).toBeNull();
    expect(pickTarget(aimAt(bend, pose(0, 0), { chained: true }))).toBe("round");
  });

  it("keeps the walk's line when two positions are as good as each other to look at", () => {
    // Two positions 2 m away, 20 degrees either side of the view. The walk arrived along the line to "on".
    const right = forwardOf(-20);
    const left = forwardOf(20);
    const fork = { off: at(left.x * 2, left.z * 2), on: at(right.x * 2, right.z * 2) };
    const facing = pose(0, 0);
    // Standing, the two cost the same, and the tie goes to the first by name.
    const [first, second] = scoreHops(aimAt(fork, facing));
    expect(first.cost).toBeCloseTo(second.cost);
    expect(pickTarget(aimAt(fork, facing))).toBe("off");
    // Walking, the one that keeps the line wins.
    const walking = pickTarget(aimAt(fork, facing, { chained: true, cameFrom: at(-right.x * 2, -right.z * 2) }));
    expect(walking).toBe("on");
  });

  it("holds the aimed position until another is clearly better", () => {
    const pair = { left: at(-0.4, -3), right: at(0.5, -3) };
    const p = pose(0, 0);
    expect(pickTarget(aimAt(pair, p))).toBe("left");
    // right was aimed a moment ago and is within the sticky margin: it stays.
    expect(pickTarget(aimAt(pair, p, { sticky: "right" }))).toBe("right");
    // Turn well toward left, and it takes over.
    expect(pickTarget(aimAt(pair, pose(0, 0, 12), { sticky: "right" }))).toBe("left");
    // A sticky position that is no longer a legal hop is forgotten.
    expect(pickTarget(aimAt(pair, p, { sticky: "gone" }))).toBe("left");
  });

  it("steps back and to the sides without turning the view", () => {
    const cross = { ahead: at(0, -2), back: at(0, 2), left: at(-2, 0), right: at(2, 0) };
    const p = pose(0, 0);
    expect(pickTarget(aimAt(cross, p, { heading: 0 }))).toBe("ahead");
    expect(pickTarget(aimAt(cross, p, { heading: 180 }))).toBe("back");
    expect(pickTarget(aimAt(cross, p, { heading: -90 }))).toBe("left");
    expect(pickTarget(aimAt(cross, p, { heading: 90 }))).toBe("right");
    // And with the view turned a quarter turn to the right, "ahead" is what was to the right.
    expect(pickTarget(aimAt(cross, pose(0, 0, -90), { heading: 0 }))).toBe("right");
  });

  it("is the same whatever order the hops come in", () => {
    const points = { a: at(-1, -3), b: at(1, -3) };
    const one = pickTarget({ pose: pose(0, 0), hops: ["a", "b"], floorPoint: (id) => points[id as "a" | "b"] });
    const two = pickTarget({ pose: pose(0, 0), hops: ["b", "a"], floorPoint: (id) => points[id as "a" | "b"] });
    expect(one).toBe(two);
  });
});

describe("createWalker", () => {
  /** A walker over a line of positions p1, p2, ... whose steps resolve when the test says so. */
  function rig(route: (string | null)[] = ["p1", "p2", "p3", "p4"]) {
    let clock = 0;
    const calls: { id: string; intent: WalkIntent; at: number }[] = [];
    const pending: { resolve: () => void; reject: (e: Error) => void }[] = [];
    let i = 0;
    const walker = createWalker({
      now: () => clock,
      target: () => (i < route.length ? route[i] : null),
      step: (id, intent) => {
        calls.push({ id, intent, at: clock });
        i += 1;
        return new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
      },
    });
    /** Lets the hop in flight arrive `ms` later, and runs what follows. */
    const arrive = async (ms = 400) => {
      clock += ms;
      pending.shift()!.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };
    const fail = async () => {
      pending.shift()!.reject(new Error("refused"));
      await Promise.resolve();
      await Promise.resolve();
    };
    return { walker, calls, arrive, fail, advance: (ms: number) => (clock += ms), setRoute: (r: (string | null)[]) => ((route = r), (i = 0)) };
  }

  it("starts the next hop on arrival while the key is held, with no gap", async () => {
    const { walker, calls, arrive } = rig();
    walker.press(0);
    expect(calls.map((c) => c.id)).toEqual(["p1"]);
    expect(walker.moving).toBe(true);
    await arrive(400);
    expect(calls.map((c) => c.id)).toEqual(["p1", "p2"]);
    expect(calls[1].at).toBe(400); // the same instant the first hop arrived
    await arrive(400);
    expect(calls.map((c) => c.id)).toEqual(["p1", "p2", "p3"]);
    expect(walker.lastHopMs).toBe(400);
  });

  it("marks every hop after the first as chained", async () => {
    const { walker, calls, arrive } = rig();
    walker.press(0);
    await arrive();
    await arrive();
    expect(calls.map((c) => c.intent.chained)).toEqual([false, true, true]);
  });

  it("stops after the hop in flight when the key is let go", async () => {
    const { walker, calls, arrive } = rig();
    walker.press(0);
    walker.release(0);
    await arrive();
    expect(calls).toHaveLength(1);
    expect(walker.moving).toBe(false);
  });

  it("a tap during a hop buys one more hop, and only one", async () => {
    const { walker, calls, arrive } = rig();
    walker.press(0);
    walker.release(0);
    walker.press(0);
    walker.release(0);
    await arrive();
    expect(calls.map((c) => c.id)).toEqual(["p1", "p2"]);
    await arrive();
    expect(calls).toHaveLength(2);
  });

  it("walks the heading pressed last, and falls back to the one still held", async () => {
    const { walker, calls, arrive } = rig();
    walker.press(0);
    walker.press(90);
    await arrive();
    expect(calls[1].intent.heading).toBe(90);
    walker.release(90);
    await arrive();
    expect(calls[2].intent.heading).toBe(0);
  });

  it("waits with the key held when nothing is in aim, and goes when the player turns to a position", async () => {
    const { walker, calls, setRoute } = rig([null]);
    walker.press(0);
    expect(calls).toHaveLength(0);
    expect(walker.moving).toBe(false);
    expect(walker.blocked).toBe(true);
    walker.tick();
    expect(calls).toHaveLength(0);
    setRoute(["p1"]);
    walker.tick();
    expect(calls.map((c) => c.id)).toEqual(["p1"]);
    expect(walker.blocked).toBe(false);
  });

  it("is not blocked once the key is let go", () => {
    const { walker } = rig([null]);
    walker.press(0);
    walker.release(0);
    expect(walker.blocked).toBe(false);
  });

  it("does not spin when a step comes back without travelling", async () => {
    // The player drops a move sent while another is in flight and resolves it at once.
    const { walker, calls, arrive, advance } = rig();
    walker.press(0);
    await arrive(DROPPED_STEP_MS - 1);
    expect(calls).toHaveLength(1);
    expect(walker.moving).toBe(false);
    walker.tick();
    expect(calls).toHaveLength(1);
    advance(RETRY_MS);
    walker.tick();
    expect(calls).toHaveLength(2);
  });

  it("stops on a refused step and tries again after a pause, with the key still held", async () => {
    const { walker, calls, fail, advance } = rig();
    walker.press(0);
    await fail();
    expect(walker.moving).toBe(false);
    walker.tick();
    expect(calls).toHaveLength(1);
    advance(RETRY_MS);
    walker.tick();
    expect(calls).toHaveLength(2);
  });

  it("releaseAll drops every key and any tap waiting", async () => {
    const { walker, calls, arrive } = rig();
    walker.press(0);
    walker.press(90);
    walker.releaseAll();
    await arrive();
    walker.tick();
    expect(calls).toHaveLength(1);
  });
});
