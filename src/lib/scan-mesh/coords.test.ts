import { describe, expect, it } from "vitest";
import { conjugate, quatToMat3, rotate, zUpQuatToYUp, zUpToYUp, type Quat, type Vec3 } from "./coords";

const close = (a: readonly number[], b: readonly number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
};

/** A unit quaternion turning `angle` radians about a unit `axis`. */
function about(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

describe("z-up to y-up", () => {
  it("sends up to up, and keeps the frame right-handed", () => {
    close(zUpToYUp(0, 0, 1), [0, 1, 0]);
    close(zUpToYUp(1, 0, 0), [1, 0, 0]);
    // z-up's y (forward on the floor) is y-up's -z.
    close(zUpToYUp(0, 1, 0), [0, 0, -1]);
  });

  it("keeps a scan camera above its floor anchor", () => {
    const camera = zUpToYUp(4, -7, 1.35);
    const anchor = zUpToYUp(4, -7, 0);
    expect(camera[1] - anchor[1]).toBeCloseTo(1.35, 9);
    expect(camera[0]).toBe(anchor[0]);
    expect(camera[2]).toBe(anchor[2]);
  });

  it("turns a rotation with the frame: converting then rotating equals rotating then converting", () => {
    const q = about([0.36, 0.48, 0.8], 1.1);
    const v: Vec3 = [0.3, -1.2, 2.5];
    const turnedThenConverted = zUpToYUp(...rotate(q, v));
    const convertedThenTurned = rotate(zUpQuatToYUp(...q), zUpToYUp(...v));
    close(convertedThenTurned, turnedThenConverted);
  });

  it("makes a turn about z-up's vertical a turn about y", () => {
    const q = zUpQuatToYUp(...about([0, 0, 1], Math.PI / 2));
    close(rotate(q, [1, 0, 0]), [0, 0, -1]);
    close(rotate(q, [0, 1, 0]), [0, 1, 0]);
  });
});

describe("quaternions", () => {
  it("rotates, and the conjugate undoes it", () => {
    const q = about([0, 1, 0], Math.PI / 2);
    close(rotate(q, [0, 0, -1]), [-1, 0, 0]);
    close(rotate(conjugate(q), rotate(q, [0.2, 0.5, -0.9])), [0.2, 0.5, -0.9]);
  });

  it("gives a column-major matrix that does the same turn", () => {
    const q = about([0.6, 0, 0.8], 0.7);
    const m = quatToMat3(q);
    const v: Vec3 = [1.5, -0.5, 0.25];
    const byMatrix = [0, 1, 2].map((row) => m[row] * v[0] + m[3 + row] * v[1] + m[6 + row] * v[2]);
    close(byMatrix, rotate(q, v));
  });
});
