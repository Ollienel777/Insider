// Made-up colours: a few panoramas of the same grey wall at different exposures.
import { describe, expect, it } from "vitest";
import { MIN_POINTS, pairRatio, solveGains, type PairRatio, type Rgb } from "./exposure";

/** `n` made-up wall colours, the same points as seen by a panorama `scale`d per channel. */
function seen(scale: Rgb, n = 60): Rgb[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 60 + ((i * 37) % 120);
    return [base * scale[0], base * scale[1], base * scale[2]] as const;
  });
}

describe("pairRatio", () => {
  it("finds the per-channel ratio between two exposures", () => {
    const r = pairRatio({ a: 0, b: 1, colourA: seen([1, 1, 1]), colourB: seen([1.2, 1, 0.9]) })!;
    expect(Math.exp(r.logRatio[0])).toBeCloseTo(1.2, 6);
    expect(Math.exp(r.logRatio[1])).toBeCloseTo(1, 6);
    expect(Math.exp(r.logRatio[2])).toBeCloseTo(0.9, 6);
    expect(r.count).toBe(60);
  });

  it("ignores clipped and near-black points, and a few wrong ones", () => {
    const a = seen([1, 1, 1]);
    const b = seen([1.1, 1.1, 1.1]);
    const colourA = [...a, [250, 250, 250] as const, [5, 5, 5] as const, [100, 100, 100] as const];
    const colourB = [...b, [255, 255, 255] as const, [6, 6, 6] as const, [40, 200, 60] as const];
    const r = pairRatio({ a: 0, b: 1, colourA, colourB })!;
    expect(r.count).toBe(61);
    expect(Math.exp(r.logRatio[1])).toBeCloseTo(1.1, 2);
  });

  it("says nothing with too few points", () => {
    expect(pairRatio({ a: 0, b: 1, colourA: seen([1, 1, 1], MIN_POINTS - 1), colourB: seen([1, 1, 1], MIN_POINTS - 1) })).toBeNull();
  });
});

describe("solveGains", () => {
  const ratio = (a: number, b: number, scaleA: Rgb, scaleB: Rgb): PairRatio =>
    pairRatio({ a, b, colourA: seen(scaleA), colourB: seen(scaleB) })!;

  it("brings a chain of panoramas to one exposure, keeping the average", () => {
    const exposures: Rgb[] = [
      [1, 1, 1],
      [1.25, 1.2, 1.1],
      [0.85, 0.9, 1.0],
      [1.1, 1.0, 0.8],
    ];
    const ratios = [ratio(0, 1, exposures[0], exposures[1]), ratio(1, 2, exposures[1], exposures[2]), ratio(2, 3, exposures[2], exposures[3])];
    const gains = solveGains(4, ratios, { pull: 0.001, iterations: 2000 });
    // Corrected colours agree across panoramas.
    for (let c = 0; c < 3; c++) {
      const corrected = exposures.map((e, i) => e[c] * gains[i][c]);
      for (const v of corrected) expect(v / corrected[0]).toBeCloseTo(1, 2);
      // And the gains' logs average to zero.
      expect(gains.reduce((s, g) => s + Math.log(g[c]), 0)).toBeCloseTo(0, 6);
    }
  });

  it("leaves a panorama with no pairs alone, and clamps a wild gain", () => {
    const wild = Math.log(3);
    const gains = solveGains(3, [{ a: 0, b: 1, logRatio: [wild, wild, wild], count: 100 }], { pull: 0.001 });
    expect(gains[2]).toEqual([1, 1, 1]);
    for (const g of gains.slice(0, 2)) for (const v of g) {
      expect(v).toBeGreaterThanOrEqual(0.6);
      expect(v).toBeLessThanOrEqual(1.6);
    }
  });

  it("is all ones when the panoramas already agree, and ignores a pair that names no panorama", () => {
    const gains = solveGains(2, [ratio(0, 1, [1, 1, 1], [1, 1, 1]), { a: 0, b: 9, logRatio: [1, 1, 1], count: 99 }]);
    for (const g of gains) for (const v of g) expect(v).toBeCloseTo(1, 9);
  });
});
