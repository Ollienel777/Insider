// Made-up positions: a corridor of panoramas 2 m apart along -z, at eye height.
import { describe, expect, it } from "vitest";
import type { Vec3 } from "./coords";
import { nearestFirst, planSharp, sharpOrder } from "./pano-plan";

const CORRIDOR: Vec3[] = Array.from({ length: 10 }, (_, i) => [0, 1.6, -2 * i] as Vec3);

describe("nearestFirst", () => {
  it("orders every panorama by distance from the player", () => {
    expect(nearestFirst(CORRIDOR, [0, 1.6, -7.2])).toEqual([4, 3, 5, 2, 6, 1, 7, 0, 8, 9]);
  });

  it("puts a panorama on another storey after everything on this one", () => {
    const upstairs: Vec3[] = [...CORRIDOR.slice(0, 3), [0, 4.6, 0]];
    expect(nearestFirst(upstairs, [0, 1.6, 0])).toEqual([0, 1, 2, 3]);
  });

  it("breaks a tie by the scan's own order, and is empty for no panoramas", () => {
    expect(nearestFirst([CORRIDOR[1], CORRIDOR[1], CORRIDOR[0]], [0, 1.6, 0])).toEqual([2, 0, 1]);
    expect(nearestFirst([], [0, 0, 0])).toEqual([]);
  });
});

describe("sharpOrder", () => {
  const still = { positions: CORRIDOR, eye: [0, 1.6, -4] as Vec3, velocity: [0, 0] as const };

  it("standing still, is nearest first", () => {
    expect(sharpOrder(still).slice(0, 5)).toEqual([2, 1, 3, 0, 4]);
  });

  it("running, brings forward what lies ahead over what lies behind", () => {
    const running = sharpOrder({ ...still, velocity: [0, -5], horizon: 1 });
    // The panorama underfoot stays first; then the ones the player is about to reach.
    expect(running[0]).toBe(2);
    expect(running.indexOf(4)).toBeLessThan(running.indexOf(1));
    expect(running.indexOf(5)).toBeLessThan(running.indexOf(0));
    expect(running.slice(0, 5)).toEqual(expect.arrayContaining([2, 3, 4, 5]));
  });

  it("running the other way, looks the other way", () => {
    const back = sharpOrder({ ...still, velocity: [0, 5], horizon: 1 });
    expect(back.slice(0, 4)).toEqual(expect.arrayContaining([2, 1, 0]));
  });

  it("looks further ahead for a longer horizon", () => {
    const short = sharpOrder({ ...still, velocity: [0, -5], horizon: 0.4 });
    const long = sharpOrder({ ...still, velocity: [0, -5], horizon: 2 });
    expect(long.indexOf(7)).toBeLessThan(short.indexOf(7));
  });

  it("pulls the scan's recommended neighbours closer", () => {
    // 0 and 4 are both 4 m away; 4 is a neighbour.
    const pulled = sharpOrder({ ...still, neighbours: [4] });
    expect(pulled.indexOf(4)).toBeLessThan(pulled.indexOf(0));
    const plain = sharpOrder(still);
    expect(plain.indexOf(0)).toBeLessThan(plain.indexOf(4));
  });

  it("lists every panorama exactly once", () => {
    const order = sharpOrder({ ...still, velocity: [3, -4], neighbours: [9, 0] });
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("planSharp", () => {
  const all = () => true;
  const order = [2, 3, 1, 4, 0, 5, 6, 7, 8, 9];

  it("starts the most wanted panorama that has none, while there is room", () => {
    expect(planSharp(order, new Set(), all, 6, 4)).toEqual({ start: 2, drop: null });
    expect(planSharp(order, new Set([2, 3]), all, 6, 4)).toEqual({ start: 1, drop: null });
  });

  it("waits for a panorama's bytes, and takes the next one meanwhile", () => {
    const held = (i: number) => i !== 2;
    expect(planSharp(order, new Set(), held, 6, 4)).toEqual({ start: 3, drop: null });
    expect(planSharp(order, new Set([3, 1, 4]), held, 6, 4)).toEqual({ start: null, drop: null });
  });

  it("does nothing once everything wanted is there", () => {
    expect(planSharp(order, new Set([2, 3, 1, 4]), all, 6, 4)).toEqual({ start: null, drop: null });
    expect(planSharp(order, new Set([2, 3, 1, 4, 8, 9]), all, 6, 4)).toEqual({ start: null, drop: null });
  });

  it("when full, lets go of the cube least worth keeping, and starts nothing until it has gone", () => {
    expect(planSharp(order, new Set([3, 1, 4, 7, 8, 9]), all, 6, 4)).toEqual({ start: null, drop: 9 });
    expect(planSharp(order, new Set([3, 1, 4, 7, 8]), all, 6, 4)).toEqual({ start: 2, drop: null });
  });

  it("never lets go of a wanted cube, so two panoramas can't take turns", () => {
    // Asking for more than there is room for wants only what fits; full of those, nothing goes.
    expect(planSharp(order, new Set([2, 3, 1]), all, 3, 9)).toEqual({ start: null, drop: null });
    // The only spare is unwanted: it is the one that goes, however near it is.
    expect(planSharp(order, new Set([3, 1, 0]), all, 3, 3)).toEqual({ start: null, drop: 0 });
  });

  it("never holds more than capacity over a walk down the corridor", () => {
    const have = new Set<number>();
    for (let z = 0; z >= -18; z -= 0.25) {
      const walk = sharpOrder({ positions: CORRIDOR, eye: [0, 1.6, z], velocity: [0, -5] });
      for (let step = 0; step < 4; step++) {
        const plan = planSharp(walk, have, all, 4, 3);
        if (plan.drop !== null) have.delete(plan.drop);
        if (plan.start !== null) have.add(plan.start);
        expect(have.size).toBeLessThanOrEqual(4);
      }
      // What the player is standing nearest is always sharp once the plan has settled.
      expect(have.has(nearestFirst(CORRIDOR, [0, 1.6, z])[0])).toBe(true);
    }
  });
});
