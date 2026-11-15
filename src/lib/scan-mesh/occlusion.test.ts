import { describe, expect, it } from "vitest";
import { vertexOcclusion } from "./occlusion";

/** A grid of quads, `n` by `n` cells of `step` metres, at the corner `at`, along `u` and `v`. */
function sheet(at: number[], u: number[], v: number[], n: number, step: number, positions: number[], index: number[]): void {
  const base = positions.length / 3;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) positions.push(...[0, 1, 2].map((k) => at[k] + u[k] * i * step + v[k] * j * step));
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i;
      // Wound so the normal is v × u: the floor faces up, the wall faces +x.
      index.push(a, a + n + 2, a + 1, a, a + n + 1, a + n + 2);
    }
}

describe("vertexOcclusion", () => {
  it("darkens where a floor meets a wall, and leaves open floor open", () => {
    const positions: number[] = [];
    const index: number[] = [];
    sheet([0, 0, 0], [1, 0, 0], [0, 0, 1], 20, 0.1, positions, index); // floor, 2 m square
    sheet([0, 0, 0], [0, 0, 1], [0, 1, 0], 20, 0.1, positions, index); // wall at x = 0
    const shut = vertexOcclusion(new Float32Array(positions), new Uint32Array(index));
    const at = (x: number, z: number) => shut[Math.round(z / 0.1) * 21 + Math.round(x / 0.1)];
    expect(at(0.1, 1)).toBeGreaterThan(0.1);
    expect(at(1.5, 1)).toBeLessThan(0.02);
    expect(at(0.1, 1)).toBeGreaterThan(at(1.5, 1));
  });
});
