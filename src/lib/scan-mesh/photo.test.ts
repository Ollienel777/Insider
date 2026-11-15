import { describe, expect, it } from "vitest";
import { BLOCKED, DEPTH_SCALE, DEPTH_SLACK, DEPTH_SOFT, LEAD_MARGIN, PRIORITY, panoCosts, photoBlend, priorities, rankPanos, seenBy, standingOn } from "./photo";

describe("panoCosts", () => {
  it("is the distance, and more for a panorama behind a wall", () => {
    const costs = panoCosts([0, 0, 0], [[3, 0, 4], [1, 0, 0]], (i) => i === 1);
    expect(costs[0]).toBeCloseTo(5);
    expect(costs[1]).toBeCloseTo(1 + BLOCKED);
  });
});

describe("rankPanos", () => {
  it("puts the nearest first and keeps only the slots", () => {
    expect(rankPanos([4, 1, 3, 2, 9], [], 3)).toEqual([1, 3, 2]);
  });

  it("keeps the lead until another is clearly nearer", () => {
    // 0 led; 1 is now a little nearer, not by the margin.
    expect(rankPanos([2, 2 - LEAD_MARGIN * 0.5, 9], [0, 1], 2)).toEqual([0, 1]);
    // Clearly nearer: the lead changes.
    expect(rankPanos([2, 2 - LEAD_MARGIN * 2, 9], [0, 1], 2)).toEqual([1, 0]);
  });

  it("does not flip on the line between two panoramas", () => {
    let ranked = [0, 1];
    const leads: number[] = [];
    // The eye wobbles a few centimetres either side of the midpoint.
    for (const d of [0.02, -0.02, 0.03, -0.03, 0.01]) {
      ranked = rankPanos([1.5 + d, 1.5 - d], ranked, 2);
      leads.push(ranked[0]);
    }
    expect(new Set(leads).size).toBe(1);
  });

  it("leaves out a panorama with no finite cost", () => {
    expect(rankPanos([Infinity, 2, 1], [], 4)).toEqual([2, 1]);
  });
});

describe("priorities", () => {
  it("gives each rank its say and the rest none", () => {
    expect(priorities(4, [2, 0])).toEqual([PRIORITY[1], 0, PRIORITY[0], 0]);
  });
});

describe("seenBy", () => {
  it("accepts a point the panorama's depth reaches", () => {
    expect(seenBy(3, 3)).toBe(1);
    expect(seenBy(3.08, 3)).toBe(1);
  });

  it("rejects a point well behind what the panorama saw", () => {
    expect(seenBy(4, 3)).toBe(0);
    expect(seenBy(10, 1)).toBe(0);
  });

  it("is soft between", () => {
    const edge = seenBy(3 * DEPTH_SCALE + DEPTH_SLACK + DEPTH_SOFT / 2, 3);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });
});

describe("standingOn", () => {
  it("is 1 on the scan position and 0 a step away", () => {
    expect(standingOn(0)).toBe(1);
    expect(standingOn(0.03)).toBe(1);
    expect(standingOn(0.6)).toBe(0);
  });
});

describe("photoBlend", () => {
  const lead = { priority: PRIORITY[0], seen: 1, facing: 0.8 };
  const second = { priority: PRIORITY[1], seen: 1, facing: 0.8 };

  it("paints a point both saw alike mostly from the lead, and from the other too", () => {
    const { weights, cover } = photoBlend([lead, second]);
    expect(weights[0]).toBeGreaterThan(0.65);
    expect(weights[1]).toBeGreaterThan(0.1);
    expect(cover).toBe(1);
  });

  it("gives more of a point to the panorama that saw it from nearer and squarer", () => {
    const far = photoBlend([{ ...lead, reach: 4, facing: 0.45 }, { ...second, reach: 1, facing: 1 }]);
    expect(far.weights[1]).toBeGreaterThan(far.weights[0]);
  });

  it("leaves a surface far from every panorama to its texture", () => {
    expect(photoBlend([{ ...lead, reach: 3 }]).cover).toBe(1);
    const fading = photoBlend([{ ...lead, reach: 6 }]).cover;
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
    expect(photoBlend([{ ...lead, reach: 9 }]).cover).toBe(0);
  });

  it("hands a point the lead did not see to the next that did", () => {
    const { weights, cover } = photoBlend([{ ...lead, seen: 0 }, second]);
    expect(weights).toEqual([0, 1]);
    expect(cover).toBe(1);
  });

  it("leaves a point nobody saw to the mesh's texture", () => {
    const { weights, cover } = photoBlend([{ ...lead, seen: 0 }, { ...second, seen: 0 }]);
    expect(weights).toEqual([0, 0]);
    expect(cover).toBe(0);
  });

  it("does not use a panorama that saw the surface edge-on", () => {
    expect(photoBlend([{ ...lead, facing: 0.01 }]).cover).toBe(0);
    // Under about 12 degrees to the surface's own plane.
    expect(photoBlend([{ ...lead, facing: 0.19 }]).cover).toBe(0);
    expect(photoBlend([{ ...lead, facing: 0.4 }]).cover).toBe(1);
  });

  it("is the panorama alone when the eye stands on it, whatever its depth says", () => {
    const { weights, cover } = photoBlend([{ ...lead, seen: 0, facing: 0, on: 1, reach: 9 }, second]);
    expect(weights[0]).toBeGreaterThan(0.95);
    expect(cover).toBe(1);
  });

  it("fades a point out with the only panorama that saw it", () => {
    const leaving = { priority: PRIORITY[3] / 2, seen: 1, facing: 1 };
    expect(photoBlend([leaving]).cover).toBeCloseTo(0.5);
  });

  it("cross-fades while the lead changes", () => {
    const { weights } = photoBlend([{ ...lead, priority: 0.5 }, { ...second, priority: 0.5 }]);
    expect(weights[0]).toBeCloseTo(0.5);
  });

  it("keeps a surface's own texture until the panorama's full-size cube is in", () => {
    expect(photoBlend([{ ...lead, sharp: 0 }]).cover).toBe(0);
    expect(photoBlend([{ ...lead, sharp: 0.5 }]).cover).toBeCloseTo(0.5);
    expect(photoBlend([{ ...lead, sharp: 1 }]).cover).toBe(1);
  });

  it("turns to a panorama behind the lead whose full-size cube is in, while the lead's is not", () => {
    const { weights, cover } = photoBlend([{ ...lead, sharp: 0 }, { ...second, sharp: 1 }]);
    expect(weights).toEqual([0, 1]);
    expect(cover).toBe(1);
  });

  it("paints the back of a one-skinned wall from the panorama that saw its front", () => {
    const { weights, cover } = photoBlend([{ ...lead, facing: -0.8 }]);
    expect(weights).toEqual([1]);
    expect(cover).toBe(1);
  });
});

