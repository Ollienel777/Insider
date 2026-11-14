import { describe, expect, it } from "vitest";
import { walkStats, type WalkSample } from "./walk-stats";

/** A made-up 2 m walk, 100 frames, with the weight between two panoramas given by `w`. */
function walk(w: (s: number) => number, brightness: (s: number) => number = () => 100): WalkSample[] {
  return Array.from({ length: 101 }, (_, i) => {
    const s = i * 0.02;
    return { walked: s, weights: { 3: w(s), 7: 1 - w(s) }, change: 2, brightness: brightness(s) };
  });
}

describe("walkStats", () => {
  it("sees a flip as a large weight change per metre, and a ramp as a small one", () => {
    const flip = walkStats(walk((s) => (s < 1 ? 1 : 0)));
    const ramp = walkStats(walk((s) => 1 - s / 2));
    expect(flip.maxWeightPerMetre).toBeCloseTo(50, 6);
    expect(ramp.maxWeightPerMetre).toBeCloseTo(0.5, 6);
    expect(flip.handovers).toBe(1);
    expect(ramp.handovers).toBe(1);
  });

  it("counts the frames one panorama dominates", () => {
    expect(walkStats(walk((s) => (s < 1 ? 1 : 0))).dominated).toBe(1);
    expect(walkStats(walk(() => 0.5)).dominated).toBe(0);
  });

  it("finds picture spikes against the typical change, and brightness steps", () => {
    const samples = walk(() => 0.5, (s) => (s < 1 ? 100 : 112));
    samples[40] = { ...samples[40], change: 20 };
    const stats = walkStats(samples);
    expect(stats.medianChange).toBe(2);
    expect(stats.maxChange).toBe(20);
    expect(stats.spikes).toBe(1);
    expect(stats.maxBrightnessStep).toBe(12);
    expect(stats.brightnessRange).toBe(12);
    expect(stats.metres).toBeCloseTo(2, 9);
  });

  it("is all zero for no frames", () => {
    const stats = walkStats([]);
    expect(stats.frames).toBe(0);
    expect(stats.maxWeightPerMetre).toBe(0);
    expect(stats.spikes).toBe(0);
  });
});
