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

describe("combineSamples, the floor under a panorama's own tripod (issue 198)", () => {
  // The panorama standing over the point has a blurred grey picture of it; the floor is carpet, the door frame dark.
  const BLUR: Rgb = [0.5, 0.5, 0.5];
  const CARPET: Rgb = [0.55, 0.4, 0.3];
  const under = (seen = 1) => ({ ...sample(BLUR, 2, seen), nadir: 0.9999 });

  it("leaves the floor to a neighbour that saw it, though the panorama overhead has more say", () => {
    for (const options of [BOTH, NEITHER]) {
      const out = combineSamples([under(), sample(CARPET, 0.5)], options);
      expect(out.weights[1]).toBeGreaterThan(0.99);
      expect(colourGap(out.colour!, CARPET)).toBeLessThan(0.01);
    }
  });

  it("keeps floor the panorama overhead saw when the neighbour's view of it was blocked by a door frame", () => {
    for (const options of [BOTH, NEITHER]) {
      for (const miss of [0.3, 1, 3]) {
        const out = combineSamples([under(), sample(DARK, 2, 0, miss)], options);
        expect(out.weights[0]).toBeGreaterThan(0.99);
        expect(colourGap(out.colour!, BLUR)).toBeLessThan(0.01);
      }
    }
  });

  it("keeps it too when the neighbour only just saw past the door frame, at the soft edge of its view", () => {
    for (const seen of [0.02, 0.05, 0.1]) {
      const out = combineSamples([under(), sample(DARK, 2, seen)], BOTH);
      expect(out.weights[0]).toBeGreaterThan(0.85);
    }
  });

  it("gives up only as far as the neighbour saw the point: more of it, more of the say", () => {
    let last = 1;
    for (let seen = 0; seen <= 1 + 1e-9; seen += 0.05) {
      const own = combineSamples([under(), sample(CARPET, 2, seen)], { agree: false, fill: true }).weights[0];
      expect(own).toBeLessThanOrEqual(last + 1e-12);
      last = own;
    }
    expect(last).toBeLessThan(0.01);
  });

  it("changes nothing for a point nobody saw: that is filled as before", () => {
    const plain = [sample(BLUR, 2, 0, 0.4), sample(DARK, 1, 0, 0.1)];
    const faded = [{ ...plain[0], nadir: 0.9999 }, plain[1]];
    expect(combineSamples(faded, BOTH).weights).toEqual(combineSamples(plain, BOTH).weights);
  });

  it("is the blend as it was when no panorama is in its own patch", () => {
    const samples = [sample(WHITE, 3, 1), sample(DARK, 1, 0.4, 0.05), sample(BLUR, 2, 0, 1)];
    for (const options of [BOTH, NEITHER]) {
      expect(combineSamples(samples.map((s) => ({ ...s, nadir: 0 })), options)).toEqual(combineSamples(samples, options));
    }
  });
});
