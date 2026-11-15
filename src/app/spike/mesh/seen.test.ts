import { describe, expect, it } from "vitest";
import type { Vec3 } from "@/lib/scan-mesh/coords";
import { seenTriangles } from "./seen";

/** A square wall in the plane z = `z`, `size` metres, centred on the x and y axes: two triangles. */
function wall(z: number, size: number, base: number) {
  const h = size / 2;
  return {
    positions: [-h, -h, z, h, -h, z, h, h, z, -h, h, z],
    index: [base, base + 1, base + 2, base, base + 2, base + 3],
  };
}

describe("seenTriangles", () => {
  it("marks a wall a panorama looks at, and not the wall behind it", () => {
    const front = wall(2, 4, 0);
    const behind = wall(3, 2, 4);
    const positions = Float32Array.from([...front.positions, ...behind.positions]);
    const index = Uint32Array.from([...front.index, ...behind.index]);
    const before = [...index];
    const panos: Vec3[] = [[0, 0, 0]];
    expect([...seenTriangles(positions, index, panos)]).toEqual([1, 1, 0, 0]);
    // The caller's triangles are left in their order.
    expect([...index]).toEqual(before);
  });

  it("marks the wall behind once a panorama stands on its side", () => {
    const front = wall(2, 4, 0);
    const behind = wall(3, 2, 4);
    const positions = Float32Array.from([...front.positions, ...behind.positions]);
    const index = Uint32Array.from([...front.index, ...behind.index]);
    const panos: Vec3[] = [
      [0, 0, 0],
      [0, 0, 5],
    ];
    // (Two metres behind the far wall, looking square at it.)
    expect([...seenTriangles(positions, index, panos)]).toEqual([1, 1, 1, 1]);
  });

  it("does not count a panorama that looks along the surface, or one too far away", () => {
    const only = wall(0, 2, 0);
    const positions = Float32Array.from(only.positions);
    const index = Uint32Array.from(only.index);
    // In the wall's own plane.
    expect([...seenTriangles(positions, index, [[5, 0, 0]])]).toEqual([0, 0]);
    expect([...seenTriangles(positions, index, [[0, 0, 40]])]).toEqual([0, 0]);
    expect([...seenTriangles(positions, index, [[0, 0, 4]])]).toEqual([1, 1]);
  });

  it("sees nothing with no panoramas", () => {
    const only = wall(0, 2, 0);
    expect([...seenTriangles(Float32Array.from(only.positions), Uint32Array.from(only.index), [])]).toEqual([0, 0]);
  });
});
