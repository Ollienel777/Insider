// Made-up panoramas 2 m apart along x, looking at a wall at z = -3.
import { describe, expect, it } from "vitest";
import { blendWeights, slotFades, type BlendSource } from "./blend";
import type { Vec3 } from "./coords";

const WALL_NORMAL: Vec3 = [0, 0, 1];
const sources = (shares = [1, 1, 1]): BlendSource[] =>
  [0, 2, 4].map((x, i) => ({ origin: [x, 1.5, 0] as Vec3, share: shares[i], seen: 1 }));

describe("blendWeights, the view rule", () => {
  it("sums to one, and is all zero with no shares", () => {
    const w = blendWeights("view", [1, 1.5, 0], [1, 1.5, -3], WALL_NORMAL, sources());
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(blendWeights("view", [1, 1.5, 0], [1, 1.5, -3], WALL_NORMAL, sources([0, 0, 0]))).toEqual([0, 0, 0]);
  });

  it("gives the panorama the player stands on nearly all of every point", () => {
    for (const x of [-2, 0, 3, 6]) {
      const w = blendWeights("view", [2, 1.5, 0], [x, 1.2, -3], WALL_NORMAL, sources());
      expect(w[1]).toBeGreaterThan(0.85);
    }
  });

  it("changes a little with every step, with no point where it flips", () => {
    let last = blendWeights("view", [0, 1.5, 0], [2, 1.5, -3], WALL_NORMAL, sources());
    for (let x = 0.02; x <= 4; x += 0.02) {
      const now = blendWeights("view", [x, 1.5, 0], [2, 1.5, -3], WALL_NORMAL, sources());
      for (let i = 0; i < 3; i++) expect(Math.abs(now[i] - last[i])).toBeLessThan(0.05);
      last = now;
    }
  });

  it("is less peaked than the nearest rule between two panoramas", () => {
    const camera: Vec3 = [0.6, 1.5, 0];
    const point: Vec3 = [3, 1.5, -3];
    const view = blendWeights("view", camera, point, WALL_NORMAL, sources([0.5, 0.5, 0.2]));
    const nearest = blendWeights("nearest", camera, point, WALL_NORMAL, sources([0.9, 0.1, 0.0]));
    expect(Math.max(...view)).toBeLessThan(Math.max(...nearest));
  });

  it("shares each point by whose ray agrees with the player's, not by distance alone", () => {
    // Midway between 0 and 2: the two are equally near, but for a point off
    // to one side the panorama on the far side sees it along a ray nearer the
    // player's own (sight 45 degrees; panorama 2 at 53, panorama 0 at 34).
    const left = blendWeights("view", [1, 1.5, 0], [-2, 1.5, -3], WALL_NORMAL, sources([1, 1, 0]));
    const right = blendWeights("view", [1, 1.5, 0], [4, 1.5, -3], WALL_NORMAL, sources([1, 1, 0]));
    expect(left[1]).toBeGreaterThan(left[0]);
    expect(right[0]).toBeGreaterThan(right[1]);
    expect(left[0]).toBeCloseTo(right[1], 9);
  });

  it("all but ignores a panorama that didn't see the point", () => {
    const hidden = sources();
    hidden[1] = { ...hidden[1], seen: 0 };
    const w = blendWeights("view", [2, 1.5, 0], [2, 1.5, -3], WALL_NORMAL, hidden);
    expect(w[1]).toBeLessThan(0.05);
  });

  it("all but ignores a panorama that sees the surface edge on", () => {
    // A floor point far off: panorama 4 sees it from right above, 0 at a graze.
    const floor: Vec3 = [0, 1, 0];
    const point: Vec3 = [4, 0, -0.3];
    const flat = [
      { origin: [-30, 0.05, -0.3] as Vec3, share: 1, seen: 1 },
      { origin: [4, 1.5, -0.3] as Vec3, share: 1, seen: 1 },
    ];
    const w = blendWeights("view", [3, 1.5, 0], point, floor, flat);
    expect(w[1]).toBeGreaterThan(0.95);
  });
});

describe("slotFades", () => {
  it("gives everyone a full share when there are no more panoramas than slots", () => {
    expect(slotFades([1, 2, 3], 4)).toEqual([1, 1, 1]);
  });

  it("falls to zero exactly at the (slots + 1)th nearest", () => {
    const f = slotFades([0, 1, 2, 3, 4, 5], 4);
    expect(f[0]).toBe(1);
    expect(f[4]).toBe(0);
    expect(f[5]).toBe(0);
    expect(f[1]).toBeGreaterThan(f[2]);
    expect(f[3]).toBeGreaterThan(0);
  });

  it("has no jump as the fourth and fifth nearest swap", () => {
    const a = slotFades([0.5, 1, 2, 2.999, 3.001], 4);
    const b = slotFades([0.5, 1, 2, 3.001, 2.999], 4);
    expect(a[3]).toBeLessThan(0.001);
    expect(b[4]).toBeLessThan(0.001);
    for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(0.002);
  });
});

describe("blendWeights, the photo rule", () => {
  it("shares a point out by rank among the panoramas that saw it", () => {
    const ranked: BlendSource[] = [
      { origin: [0, 1.5, 0], share: 1, seen: 1 },
      { origin: [2, 1.5, 0], share: 0.4, seen: 1 },
    ];
    const w = blendWeights("photo", [0.5, 1.5, 0], [1, 1.5, -3], WALL_NORMAL, ranked);
    expect(w[0]).toBeGreaterThan(0.6);
    expect(w[0] + w[1]).toBeCloseTo(1, 9);
  });

  it("gives a point the lead did not see to the next", () => {
    const ranked: BlendSource[] = [
      { origin: [0, 1.5, 0], share: 1, seen: 0 },
      { origin: [2, 1.5, 0], share: 0.4, seen: 1 },
    ];
    expect(blendWeights("photo", [0.5, 1.5, 0], [1, 1.5, -3], WALL_NORMAL, ranked)).toEqual([0, 1]);
  });
});
