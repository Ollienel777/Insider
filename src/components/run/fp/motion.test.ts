// The first-person feet (issue 115): constant speed with a near-instant start
// and stop, and a body that slides along walls and never passes through one.
import { describe, expect, it } from "vitest";
import { FIXTURE_FLOORS } from "@/adapters/matterport/fake";
import type { Seg, Vec } from "./ground";
import { accelerate, blocked, deflect, distanceTo, slide, wishVelocity } from "./motion";
import { FP } from "./tuning";
import { buildWorld, groundOf, onFloor, solids } from "./world";

const speed = (v: Vec) => Math.hypot(v.x, v.y);
const still: Vec = { x: 0, y: 0 };

describe("the speed the keys ask for", () => {
  it("is the run speed forwards, backwards, sideways and diagonally alike", () => {
    for (const [forward, strafe] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (const yaw of [0, 0.7, Math.PI, -2]) {
        expect(speed(wishVelocity({ forward, strafe }, yaw))).toBeCloseTo(FP.runMps, 9);
      }
    }
  });

  it("is nothing with no key held", () => {
    expect(wishVelocity({ forward: 0, strafe: 0 }, 1)).toEqual(still);
  });

  it("goes where the view faces: yaw 0 is east, a quarter turn right is south, and D is to the right", () => {
    const east = wishVelocity({ forward: 1, strafe: 0 }, 0);
    expect(east.x).toBeCloseTo(FP.runMps);
    expect(east.y).toBeCloseTo(0);
    const south = wishVelocity({ forward: 1, strafe: 0 }, Math.PI / 2);
    expect(south.x).toBeCloseTo(0);
    expect(south.y).toBeCloseTo(FP.runMps);
    const right = wishVelocity({ forward: 0, strafe: 1 }, 0);
    expect(right.x).toBeCloseTo(0);
    expect(right.y).toBeCloseTo(FP.runMps);
  });
});

describe("starting and stopping", () => {
  const run = wishVelocity({ forward: 1, strafe: 0 }, 0);

  it("reaches full run speed within a tenth of a second and then holds it exactly", () => {
    let v = still;
    let t = 0;
    while (speed(v) < FP.runMps && t < 1) {
      v = accelerate(v, run, FP.stepS);
      t += FP.stepS;
    }
    expect(t).toBeLessThanOrEqual(0.1);
    for (let i = 0; i < 240; i++) v = accelerate(v, run, FP.stepS);
    expect(v).toEqual(run);
  });

  it("never overshoots the run speed on the way up, or when the direction flips", () => {
    let v = still;
    for (let i = 0; i < 60; i++) {
      v = accelerate(v, run, FP.stepS);
      expect(speed(v)).toBeLessThanOrEqual(FP.runMps + 1e-9);
    }
    const back = { x: -run.x, y: -run.y };
    for (let i = 0; i < 60; i++) {
      v = accelerate(v, back, FP.stepS);
      expect(speed(v)).toBeLessThanOrEqual(FP.runMps + 1e-9);
    }
    expect(v).toEqual(back);
  });

  it("stops dead within a tenth of a second of letting go, with no drift after", () => {
    let v = run;
    let t = 0;
    while (speed(v) > 0 && t < 1) {
      v = accelerate(v, still, FP.stepS);
      t += FP.stepS;
    }
    expect(t).toBeLessThanOrEqual(0.1);
    expect(accelerate(v, still, FP.stepS)).toEqual(still);
  });
});

describe("a body against walls", () => {
  const wall: Seg = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };

  it("stops a body walking straight at a wall one radius short of it", () => {
    let p: Vec = { x: 5, y: 2 };
    for (let i = 0; i < 200; i++) p = slide(p, { x: 0, y: -0.04 }, [wall]).pos;
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(FP.radiusM);
  });

  it("slides along a wall met at an angle, keeping the speed along it", () => {
    let p: Vec = { x: 2, y: FP.radiusM };
    const v = wishVelocity({ forward: 1, strafe: 0 }, -Math.PI / 4); // north-east, into the wall
    const moved = slide(p, { x: v.x * FP.stepS, y: v.y * FP.stepS }, [wall]);
    expect(moved.pos.y).toBeCloseTo(FP.radiusM);
    expect(moved.pos.x - p.x).toBeCloseTo(v.x * FP.stepS);
    const left = deflect(v, moved.touched);
    expect(left.y).toBeCloseTo(0);
    expect(left.x).toBeCloseTo(v.x);
    for (let i = 0; i < 120; i++) p = slide(p, { x: v.x * FP.stepS, y: v.y * FP.stepS }, [wall]).pos;
    expect(p.x).toBeCloseTo(2 + v.x);
    expect(p.y).toBeCloseTo(FP.radiusM);
  });

  it("does not tunnel through a wall however far one step asks it to go", () => {
    const p = slide({ x: 5, y: 1 }, { x: 0, y: -50 }, [wall]).pos;
    expect(p.y).toBeGreaterThanOrEqual(FP.radiusM - 1e-3);
  });

  it("comes to rest in a corner rather than passing through it", () => {
    const corner: Seg[] = [wall, { a: { x: 0, y: 0 }, b: { x: 0, y: 10 } }];
    let p: Vec = { x: 2, y: 2 };
    for (let i = 0; i < 300; i++) p = slide(p, { x: -0.03, y: -0.03 }, corner).pos;
    expect(p.x).toBeCloseTo(FP.radiusM);
    expect(p.y).toBeCloseTo(FP.radiusM);
  });

  it("rounds the end of a wall without catching on it", () => {
    const stub: Seg = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    let p: Vec = { x: 1.2, y: 1 };
    for (let i = 0; i < 100; i++) p = slide(p, { x: 0, y: -0.04 }, [stub]).pos;
    expect(p.y).toBeLessThan(-1);
    expect(distanceTo(stub, p)).toBeGreaterThanOrEqual(FP.radiusM - 1e-3);
  });
});

/** A small seeded generator, so the wander below is the same every run. */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.each(["F1", "F2", "F3"] as const)("a body wandering %s", (id) => {
  const floor = FIXTURE_FLOORS[id];
  const world = buildWorld(floor);
  const ground = groundOf(world);
  const lockable = floor.edges.flatMap((e) => (e.door?.lockable ? [e.door.id] : []));

  it.each([
    ["every lockable door locked", lockable],
    ["every door open", [] as string[]],
  ])("never passes through a wall or leaves the floor, with %s", (_name, locked) => {
    const random = mulberry(115);
    const walls = solids(world, locked);
    for (const start of [...world.nodes.values()].filter((_, i) => i % 4 === 0)) {
      let pos: Vec = { x: start.x, y: start.y };
      let vel: Vec = { x: 0, y: 0 };
      let yaw = random() * Math.PI * 2;
      let wish = { forward: 1, strafe: 0 };
      for (let step = 0; step < 2400; step++) {
        if (step % 40 === 0) {
          yaw += (random() - 0.5) * 3;
          wish = { forward: random() < 0.85 ? 1 : -1, strafe: Math.round(random() * 2 - 1) };
        }
        const moved = ground.collide(pos, accelerate(vel, wishVelocity(wish, yaw), FP.stepS), FP.stepS, locked);
        expect(blocked(walls, pos, moved.pos)).toBe(false);
        expect(onFloor(world, moved.pos)).toBe(true);
        expect(speed(moved.vel)).toBeLessThanOrEqual(FP.runMps + 1e-9);
        pos = moved.pos;
        vel = moved.vel;
      }
      for (const wall of walls) expect(distanceTo(wall, pos)).toBeGreaterThanOrEqual(FP.radiusM - 2e-3);
    }
  });
});
