// The flashlights' fallback and the guards' walk cycle (issue 146).
import { describe, expect, it } from "vitest";
import { coneGeometry, FrameRateWatch, WATCH_MIN_FPS, WATCH_WARMUP_S } from "./flashlight";
import { STRIDE_M, strideAfter } from "./guard-figure";

const feed = (watch: FrameRateWatch, fps: number, seconds: number) => {
  let dropped = false;
  for (let t = 0; t < seconds; t += 1 / fps) dropped = watch.frame(1 / fps) || dropped;
  return dropped;
};

describe("the frame-rate watch", () => {
  it("keeps the real lights at a steady rate", () => {
    const watch = new FrameRateWatch();
    expect(feed(watch, 60, 20)).toBe(false);
    expect(watch.dropped).toBe(false);
    expect(Math.round(watch.fps)).toBe(60);
  });

  it("says once, after the warm-up, when the rate drops", () => {
    const watch = new FrameRateWatch();
    expect(feed(watch, 20, WATCH_WARMUP_S - 0.1)).toBe(false);
    expect(feed(watch, 20, 3)).toBe(true);
    expect(watch.dropped).toBe(true);
    expect(feed(watch, 20, 3)).toBe(false);
  });

  it("forgives a slow load: the warm-up is not judged", () => {
    const watch = new FrameRateWatch();
    feed(watch, 10, WATCH_WARMUP_S - 0.2);
    expect(feed(watch, WATCH_MIN_FPS + 20, 6)).toBe(false);
  });
});

describe("the walk cycle", () => {
  it("goes a full stride every STRIDE_M walked, and stands still under reduced motion", () => {
    const half = strideAfter(0, STRIDE_M / 2, 1.5, false);
    expect(half.phase).toBeCloseTo(Math.PI);
    expect(half.swing).toBe(1);
    expect(strideAfter(0, 0, 0, false).swing).toBe(0);
    expect(strideAfter(1, 2, 1.5, true)).toEqual({ phase: 0, swing: 0 });
  });
});

describe("a sight cone", () => {
  it("has its tip at the origin and its mouth along the axis", () => {
    for (const axis of ["x", "z"] as const) {
      const g = coneGeometry(5, 0.3, axis);
      g.computeBoundingBox();
      const box = g.boundingBox!;
      const [lo, hi] = axis === "x" ? [box.min.x, box.max.x] : [box.min.z, box.max.z];
      expect(lo).toBeCloseTo(0);
      expect(hi).toBeCloseTo(5);
      expect(g.getAttribute("along").count).toBe(g.getAttribute("position").count);
    }
  });
});
