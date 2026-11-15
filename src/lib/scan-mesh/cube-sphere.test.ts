import { describe, expect, it } from "vitest";
import { cubeSphere } from "./cube-sphere";

describe("cubeSphere", () => {
  it("has six faces of vertices and two triangles a square", () => {
    const { directions, index } = cubeSphere(4);
    expect(directions.length).toBe(6 * 5 * 5 * 3);
    expect(index.length).toBe(6 * 4 * 4 * 6);
    expect(Math.max(...index)).toBe(6 * 5 * 5 - 1);
  });

  it("puts every vertex on the unit sphere", () => {
    const { directions } = cubeSphere(8);
    for (let i = 0; i < directions.length; i += 3) {
      expect(Math.hypot(directions[i], directions[i + 1], directions[i + 2])).toBeCloseTo(1, 5);
    }
  });

  it("covers the whole sphere: its triangles' areas add up to the sphere's", () => {
    const { directions, index } = cubeSphere(24);
    let area = 0;
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i] * 3, index[i + 1] * 3, index[i + 2] * 3];
      const u = [directions[b] - directions[a], directions[b + 1] - directions[a + 1], directions[b + 2] - directions[a + 2]];
      const v = [directions[c] - directions[a], directions[c + 1] - directions[a + 1], directions[c + 2] - directions[a + 2]];
      area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    }
    // Flat triangles inside a round sphere: a little under 4π.
    expect(area).toBeGreaterThan(4 * Math.PI * 0.99);
    expect(area).toBeLessThan(4 * Math.PI);
  });

  it("meets along the faces' shared edges: every edge direction is in two faces or three", () => {
    const { directions } = cubeSphere(3);
    const seen = new Map<string, number>();
    for (let i = 0; i < directions.length; i += 3) {
      const key = [directions[i], directions[i + 1], directions[i + 2]].map((x) => x.toFixed(4)).join(",");
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const counts = [...seen.values()];
    // 8 corners in three faces each, the rest of the 12 edges in two, the insides in one.
    expect(counts.filter((c) => c === 3)).toHaveLength(8);
    expect(counts.filter((c) => c === 2)).toHaveLength(12 * 2);
    expect(counts.filter((c) => c === 1)).toHaveLength(6 * 2 * 2);
  });

  it("makes squares of nearly one size: evenly spaced in angle", () => {
    const { directions } = cubeSphere(8);
    // Along the first face's first row, the angle between neighbours.
    const angles: number[] = [];
    for (let x = 0; x < 8; x++) {
      const a = x * 3;
      const b = (x + 1) * 3;
      const dot = directions[a] * directions[b] + directions[a + 1] * directions[b + 1] + directions[a + 2] * directions[b + 2];
      angles.push(Math.acos(Math.min(1, dot)));
    }
    expect(Math.max(...angles) / Math.min(...angles)).toBeLessThan(1.5);
  });
});
