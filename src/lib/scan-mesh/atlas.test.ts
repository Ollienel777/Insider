import { describe, expect, it } from "vitest";
import { packShelves } from "./atlas";

/** Whether two placed pictures come within `gutter` pixels of each other. */
function tooClose(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gutter: number): boolean {
  return a.x < b.x + b.w + gutter && b.x < a.x + a.w + gutter && a.y < b.y + b.h + gutter && b.y < a.y + a.h + gutter;
}

describe("packShelves", () => {
  it("packs nothing onto no pages", () => {
    expect(packShelves([], 256, 4)).toEqual({ placements: [], pages: 0 });
  });

  it("keeps every picture on its page, clear of the edge and of its neighbours", () => {
    const sizes: [number, number][] = [];
    for (let i = 0; i < 60; i++) sizes.push([10 + ((i * 37) % 50), 8 + ((i * 53) % 40)]);
    const { placements, pages } = packShelves(sizes, 256, 4);
    expect(pages).toBeGreaterThan(1);
    const placed = placements.map((p, i) => ({ ...p, w: sizes[i][0], h: sizes[i][1] }));
    for (const p of placed) {
      expect(p.page).toBeLessThan(pages);
      expect(p.x).toBeGreaterThanOrEqual(4);
      expect(p.y).toBeGreaterThanOrEqual(4);
      expect(p.x + p.w + 4).toBeLessThanOrEqual(256);
      expect(p.y + p.h + 4).toBeLessThanOrEqual(256);
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (placed[i].page !== placed[j].page) continue;
        expect(tooClose(placed[i], placed[j], 4)).toBe(false);
      }
    }
  });

  it("answers in the order asked, whatever order it packs in", () => {
    const { placements } = packShelves(
      [
        [10, 10],
        [10, 100],
      ],
      256,
      4,
    );
    // The tall one is packed first, at the corner.
    expect(placements[1]).toEqual({ page: 0, x: 4, y: 4 });
    expect(placements[0]).toEqual({ page: 0, x: 18, y: 4 });
  });

  it("gives a picture as large as a page a page to itself", () => {
    const { placements, pages } = packShelves(
      [
        [20, 20],
        [300, 300],
        [20, 20],
      ],
      256,
      4,
    );
    expect(pages).toBe(2);
    expect(placements[1].page).not.toBe(placements[0].page);
    expect(placements[0].page).toBe(placements[2].page);
  });
});
