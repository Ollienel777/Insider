// Made-up samples: plain colours and weights, no scan.
import { describe, expect, it } from "vitest";
import { combineSamples, colourGap, type PanoSample } from "./combine";
import type { Rgb } from "./exposure";

const WHITE: Rgb = [0.9, 0.9, 0.9];
const DARK: Rgb = [0.1, 0.1, 0.12];
const BOTH = { agree: true, fill: true };
const NEITHER = { agree: false, fill: false };

const sample = (colour: Rgb, base: number, seen = 1, miss = 0): PanoSample => ({ colour, base, seen, miss });

describe("combineSamples, colours that agree", () => {
  it("leaves the weights as the blend rule gave them", () => {
    const samples = [sample([0.5, 0.5, 0.5], 3), sample([0.51, 0.5, 0.49], 1)];
    const out = combineSamples(samples, BOTH);
    expect(out.weights[0]).toBeCloseTo(0.75, 9);
    expect(out.weights[1]).toBeCloseTo(0.25, 9);
    expect(out.ghost).toBeLessThan(0.01);
  });

  it("gives nothing and no colour when no sample has a say", () => {
    const out = combineSamples([sample(WHITE, 0), sample(DARK, 0)], BOTH);
    expect(out.weights).toEqual([0, 0]);
    expect(out.colour).toBeNull();
  });
});

describe("combineSamples, colours that disagree (a thing the mesh lacks)", () => {
  it("leans on the stronger panorama, leaving far less of a second picture", () => {
    const samples = [sample(DARK, 0.6), sample(WHITE, 0.4)];
    const plain = combineSamples(samples, NEITHER);
    const fixed = combineSamples(samples, BOTH);
    expect(plain.weights[0]).toBeCloseTo(0.6, 9);
    expect(fixed.weights[0]).toBeGreaterThan(0.95);
    expect(fixed.ghost).toBeLessThan(plain.ghost / 5);
    expect(colourGap(fixed.colour!, DARK)).toBeLessThan(0.05);
  });

  it("hands over without a jump as the player walks from one panorama to the other", () => {
    let last = combineSamples([sample(DARK, 0.9), sample(WHITE, 0.1)], BOTH).weights[0];
    for (let t = 0.1; t <= 0.9 + 1e-9; t += 0.002) {
      const now = combineSamples([sample(DARK, 1 - t), sample(WHITE, t)], BOTH).weights[0];
      expect(now).toBeLessThanOrEqual(last + 1e-12);
      expect(last - now).toBeLessThan(0.05);
      last = now;
    }
    expect(last).toBeLessThan(0.05);
  });

  it("is still an even mix exactly half way, where neither is stronger", () => {
    const out = combineSamples([sample(DARK, 1), sample(WHITE, 1)], BOTH);
    expect(out.weights[0]).toBeCloseTo(0.5, 9);
  });
});

describe("combineSamples, a point nobody saw", () => {
  const unseen = [sample(WHITE, 3, 0, 1.2), sample(DARK, 1, 0, 0.03), sample([0.6, 0.3, 0.2], 2, 0, 2)];

  it("used to average every panorama's colour: a grey smudge", () => {
    const out = combineSamples(unseen, NEITHER);
    expect(out.weights[0]).toBeCloseTo(0.5, 6);
    expect(out.ghost).toBeGreaterThan(0.2);
  });

  it("now takes the panorama that came nearest to seeing it, even with less say", () => {
    const out = combineSamples(unseen, BOTH);
    expect(out.weights[1]).toBeGreaterThan(0.99);
    expect(colourGap(out.colour!, DARK)).toBeLessThan(0.01);
    expect(out.seenFraction).toBe(0);
  });

  it("goes by what was seen once enough of the say saw it", () => {
    const out = combineSamples([sample(WHITE, 3, 1), sample(DARK, 1, 0, 0.01)], { agree: false, fill: true });
    expect(out.weights[0]).toBeCloseTo(1, 9);
    expect(out.seenFraction).toBeCloseTo(0.75, 9);
  });

  it("doesn't lose a panorama metres short of the point to underflow", () => {
    const out = combineSamples([sample(WHITE, 1e-3, 0, 40), sample(DARK, 1e-3, 0, 60)], BOTH);
    expect(out.weights[0]).toBeGreaterThan(0.99);
    expect(Number.isFinite(out.weights[1])).toBe(true);
  });
});
