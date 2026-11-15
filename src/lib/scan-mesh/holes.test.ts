import { describe, expect, it } from "vitest";
import { closeHoles } from "./holes";

/**
 * An n × n grid of unit squares on the floor (y = 0), two triangles each,
 * welded, with the squares in `missing` (by "col,row") left out.
 */
function grid(n: number, missing: string[] = [], size = 1) {
  const positions: number[] = [];
  for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) positions.push(c * size, 0, r * size);
  const at = (c: number, r: number) => r * (n + 1) + c;
  const index: number[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (missing.includes(`${c},${r}`)) continue;
      index.push(at(c, r), at(c, r + 1), at(c + 1, r + 1), at(c, r), at(c + 1, r + 1), at(c + 1, r));
    }
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}

/** The area of the triangles, flat on the floor. */
function area(triangles: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < triangles.length; i += 9) {
    const [ax, , az, bx, , bz, cx, , cz] = triangles.subarray(i, i + 9);
    sum += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  return sum;
}

describe("closeHoles", () => {
  it("leaves a mesh with no hole alone (its outer edge is too wide)", () => {
    const { positions, index } = grid(4);
    const closed = closeHoles(positions, index, { maxEdges: 100, maxSpan: 2 });
    expect(closed.holes).toBe(0);
    expect(closed.open).toBe(1);
    expect(closed.triangles.length).toBe(0);
  });

  it("closes a small hole exactly, with triangles inside it", () => {
    const { positions, index } = grid(5, ["2,2", "3,2"], 0.25);
    const closed = closeHoles(positions, index, { maxEdges: 100, maxSpan: 1 });
    expect(closed.holes).toBe(1);
    expect(area(closed.triangles)).toBeCloseTo(2 * 0.25 * 0.25, 6);
    for (let i = 0; i < closed.triangles.length; i += 3) {
      expect(closed.triangles[i]).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(closed.triangles[i]).toBeLessThanOrEqual(1 + 1e-6);
      expect(closed.triangles[i + 1]).toBe(0);
    }
  });

  it("closes each of several holes, and a hole one triangle wide", () => {
    const { positions, index } = grid(6, ["1,1", "4,4"]);
    const closed = closeHoles(positions, index, { maxEdges: 100, maxSpan: 1.5 });
    expect(closed.holes).toBe(2);
    expect(area(closed.triangles)).toBeCloseTo(2, 6);

    // Take one triangle out of the middle square: a three-edge hole, closed by that triangle again.
    const one = grid(3);
    const cut = Uint32Array.from([...one.index.slice(0, 24), ...one.index.slice(27)]);
    const single = closeHoles(one.positions, cut, { maxEdges: 100, maxSpan: 1.5 });
    expect(single.holes).toBe(1);
    expect(single.triangles.length).toBe(9);
    expect(area(single.triangles)).toBeCloseTo(0.5, 6);
  });

  it("leaves open a hole too wide or with too many edges: a doorway, a window", () => {
    const wide = grid(8, ["2,2", "3,2", "4,2", "5,2"]);
    expect(closeHoles(wide.positions, wide.index, { maxEdges: 100, maxSpan: 2 }).holes).toBe(0);
    expect(closeHoles(wide.positions, wide.index, { maxEdges: 100, maxSpan: 4 }).holes).toBe(1);
    expect(closeHoles(wide.positions, wide.index, { maxEdges: 9, maxSpan: 4 }).holes).toBe(0);
  });

  it("ignores triangles with a repeated corner", () => {
    const { positions, index } = grid(3, ["1,1"]);
    const junk = Uint32Array.from([...index, 0, 0, 1]);
    expect(closeHoles(positions, junk, { maxEdges: 100, maxSpan: 1.5 }).holes).toBe(1);
  });
});
