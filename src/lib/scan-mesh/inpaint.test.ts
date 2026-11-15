import { describe, expect, it } from "vitest";
import { inpaint, knownBlur } from "./inpaint";

/** A picture `width` by `height` from `colour(x, y)` (a grey level), with the pixels `gap(x, y)` names missing. */
function picture(width: number, height: number, colour: (x: number, y: number) => number, gap: (x: number, y: number) => boolean) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const known = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const missing = gap(x, y);
      known[p] = missing ? 0 : 1;
      // A missing pixel holds rubbish, as an unpainted one does.
      const c = missing ? 255 : colour(x, y);
      rgba[p * 4] = c;
      rgba[p * 4 + 1] = c;
      rgba[p * 4 + 2] = c;
      rgba[p * 4 + 3] = missing ? 0 : 255;
    }
  }
  return { rgba, known };
}

const inGap = (x: number, y: number) => x >= 20 && x < 44 && y >= 20 && y < 44;

describe("knownBlur", () => {
  it("averages the seen pixels only", () => {
    const { rgba, known } = picture(8, 1, (x) => (x < 4 ? 100 : 200), (x) => x >= 4);
    const values = new Float32Array(8 * 3);
    for (let p = 0; p < 8; p++) for (let k = 0; k < 3; k++) values[p * 3 + k] = rgba[p * 4 + k];
    const reach = new Float32Array(8);
    const out = knownBlur(values, known, 8, 1, 2, reach);
    // Pixel 4 is missing; the seen pixels within 2 of it are all 100.
    expect(out[4 * 3]).toBeCloseTo(100);
    expect(reach[4]).toBe(2);
    // Pixel 7 has no seen pixel in reach.
    expect(reach[7]).toBe(0);
    expect(out[7 * 3]).toBe(0);
  });
});

describe("inpaint", () => {
  it("leaves the seen pixels exactly as they were", () => {
    const { rgba, known } = picture(64, 64, (x, y) => ((x * 7 + y * 13) % 50) + 100, inGap);
    const out = inpaint(rgba, known, 64, 64);
    expect(out).not.toBeNull();
    for (let p = 0; p < 64 * 64; p++) {
      if (!known[p]) continue;
      expect(out!.pixels[p * 4]).toBe(rgba[p * 4]);
    }
    expect(out!.filled).toBe(24 * 24);
  });

  it("fills a gap in a flat surface with the surface's colour, not the rubbish under it", () => {
    const { rgba, known } = picture(64, 64, () => 180, inGap);
    const out = inpaint(rgba, known, 64, 64)!;
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) expect(Math.abs(out.pixels[(y * 64 + x) * 4] - 180)).toBeLessThanOrEqual(1);
  });

  it("fills a gap in a weave with weave: the grain is as strong inside as outside", () => {
    // A two-pixel checker, light and dark by 60 levels: a blur would fill the gap with flat grey.
    const weave = (x: number, y: number) => (((x >> 1) + (y >> 1)) % 2 === 0 ? 150 : 90);
    const { rgba, known } = picture(64, 64, weave, inGap);
    const out = inpaint(rgba, known, 64, 64)!;
    const contrast = (inside: boolean) => {
      let sum = 0;
      let n = 0;
      for (let y = 22; y < 42; y++) {
        for (let x = 22; x < 42; x++) {
          const ox = inside ? x : x - 20;
          const p = (y * 64 + ox) * 4;
          sum += Math.abs(out.pixels[p] - 120);
          n++;
        }
      }
      return sum / n;
    };
    expect(contrast(false)).toBeCloseTo(30, 0);
    // No flat fill: nearly the full swing of the weave.
    expect(contrast(true)).toBeGreaterThan(22);
    // And only the weave's two tones, near enough.
    for (let y = 22; y < 42; y++) {
      for (let x = 22; x < 42; x++) {
        const c = out.pixels[(y * 64 + x) * 4];
        expect(Math.min(Math.abs(c - 150), Math.abs(c - 90))).toBeLessThan(25);
      }
    }
  });

  it("copies scraps of the seen surface: neighbours mostly come from neighbouring places", () => {
    const { rgba, known } = picture(64, 64, (x, y) => ((x * 31 + y * 17 + ((x * y) % 7) * 9) % 60) + 100, inGap);
    const out = inpaint(rgba, known, 64, 64)!;
    let coherent = 0;
    let pairs = 0;
    for (let y = 20; y < 44; y++) {
      for (let x = 21; x < 44; x++) {
        const p = y * 64 + x;
        pairs++;
        if (out.source[p] === out.source[p - 1] + 1) coherent++;
        // Every missing pixel's grain comes from a seen one.
        expect(known[out.source[p]]).toBe(1);
      }
    }
    expect(coherent / pairs).toBeGreaterThan(0.5);
  });

  it("carries the shading across the gap", () => {
    // Light falling off left to right, no grain.
    const { rgba, known } = picture(64, 64, (x) => 100 + x * 2, inGap);
    const out = inpaint(rgba, known, 64, 64)!;
    const left = out.pixels[(32 * 64 + 22) * 4];
    const right = out.pixels[(32 * 64 + 41) * 4];
    expect(right).toBeGreaterThan(left + 10);
    expect(Math.abs(left - 144)).toBeLessThan(25);
    expect(Math.abs(right - 182)).toBeLessThan(25);
  });

  it("is the same every time", () => {
    const { rgba, known } = picture(48, 48, (x, y) => ((x * 31 + y * 17) % 60) + 100, (x, y) => x > 10 && x < 30 && y > 10 && y < 30);
    const a = inpaint(rgba, known, 48, 48)!;
    const b = inpaint(rgba, known, 48, 48)!;
    expect([...a.pixels]).toEqual([...b.pixels]);
  });

  it("has nothing to fill from when nothing was seen", () => {
    const { rgba, known } = picture(8, 8, () => 0, () => true);
    expect(inpaint(rgba, known, 8, 8)).toBeNull();
  });

  it("gives grain only to the part asked for", () => {
    const weave = (x: number, y: number) => (((x >> 1) + (y >> 1)) % 2 === 0 ? 150 : 90);
    const { rgba, known } = picture(64, 64, weave, inGap);
    // The left half of the gap.
    const out = inpaint(rgba, known, 64, 64, undefined, [20, 20, 12, 24])!;
    expect(out.filled).toBe(12 * 24);
    const swing = (x0: number) => {
      let sum = 0;
      for (let y = 22; y < 42; y++) for (let x = x0; x < x0 + 8; x++) sum += Math.abs(out.pixels[(y * 64 + x) * 4] - 120);
      return sum / (20 * 8);
    };
    expect(swing(22)).toBeGreaterThan(20);
    // The right half has the shading only: flat.
    expect(swing(34)).toBeLessThan(8);
  });
});
