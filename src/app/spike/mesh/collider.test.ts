// The scan view's floor and walls (issue 118), on a made-up room: a floor
// at y 0 from -5 to 5, a step up to 0.3 m for x over 2, and a wall at z = -1.
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { stepMove, TUNING } from "@/lib/scan-mesh/movement";
import { MeshWorld } from "./collider";

/** Two triangles a quad, corners in order round it. */
function quads(...corners: [number, number, number][][]): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (const quad of corners) {
    const base = positions.length / 3;
    for (const c of quad) positions.push(...c);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);
  return geometry;
}

const room = () =>
  new MeshWorld(
    quads(
      [[-5, 0, -5], [2, 0, -5], [2, 0, 5], [-5, 0, 5]],
      [[2, 0.3, -5], [5, 0.3, -5], [5, 0.3, 5], [2, 0.3, 5]],
      [[-5, 0, -1], [5, 0, -1], [5, 3, -1], [-5, 3, -1]],
    ),
    TUNING.stepUp,
  );

describe("MeshWorld.floorBelow", () => {
  it("finds the floor under a point, and the step where it is higher", () => {
    const world = room();
    expect(world.floorBelow(0, 1.6, 0, 3)).toBeCloseTo(0, 6);
    expect(world.floorBelow(3, 1.6, 0, 3)).toBeCloseTo(0.3, 6);
  });

  it("is null over a hole, and when the floor is deeper than asked", () => {
    const world = room();
    expect(world.floorBelow(8, 1.6, 0, 3)).toBeNull();
    expect(world.floorBelow(0, 5, 0, 3)).toBeNull();
  });
});

describe("MeshWorld.pushOut", () => {
  it("moves a body out of a wall it overlaps, sideways only", () => {
    const out = room().pushOut(0, 0, -0.9, 0.25);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.z).toBeGreaterThanOrEqual(-1 + 0.25 - 1e-6);
  });

  it("leaves a body clear of every wall where it is, and ignores the floor under it", () => {
    expect(room().pushOut(0, 0, 1, 0.25)).toEqual({ x: 0, z: 1 });
  });
});

describe("a walking controller on the scan view's world", () => {
  it("runs into the wall and stops short of it", () => {
    const world = room();
    let state = { x: 0, y: 0, z: 1, vx: 0, vz: 0, walked: 0, grounded: true };
    // Yaw 0 looks down -z, toward the wall.
    for (let i = 0; i < 120; i++) state = stepMove(state, { forward: 1, right: 0, walk: false }, 0, 1 / 60, world);
    expect(state.z).toBeGreaterThan(-1 + TUNING.radius - 0.02);
    expect(state.z).toBeLessThan(-0.5);
    expect(state.grounded).toBe(true);
  });

  it("climbs the step onto the higher floor", () => {
    const world = room();
    let state = { x: 1, y: 0, z: 1, vx: 0, vz: 0, walked: 0, grounded: true };
    // Yaw -π/2 looks down +x.
    for (let i = 0; i < 120; i++) state = stepMove(state, { forward: 1, right: 0, walk: false }, -Math.PI / 2, 1 / 60, world);
    expect(state.x).toBeGreaterThan(2.5);
    expect(state.y).toBeCloseTo(0.3, 1);
  });
});
