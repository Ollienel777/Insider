// The one place scan coordinates change frame (issue 118). The Model API and
// the OBJ mesh are z-up, in metres; three.js is y-up. Both are right-handed,
// so the change is a quarter turn about x: (x, y, z) becomes (x, z, -y).
// Everything past this file is y-up.

export type Vec3 = readonly [number, number, number];
/** A unit quaternion as (x, y, z, w). */
export type Quat = readonly [number, number, number, number];

/** A z-up point or direction, in y-up. */
export function zUpToYUp(x: number, y: number, z: number): Vec3 {
  return [x, z, 0 - y];
}

/**
 * A z-up rotation, in y-up. A change of basis by a rotation turns a
 * quaternion's vector part like any other vector and leaves w alone.
 */
export function zUpQuatToYUp(x: number, y: number, z: number, w: number): Quat {
  return [x, z, 0 - y, w];
}

/** `v` turned by the unit quaternion `q`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 q × v;  v' = v + w t + q × t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

/** The inverse of a unit quaternion. */
export function conjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/**
 * The 3×3 matrix of the unit quaternion `q`, column-major (the order
 * three.js's `Matrix3.fromArray` reads).
 */
export function quatToMat3(q: Quat): number[] {
  const cx = rotate(q, [1, 0, 0]);
  const cy = rotate(q, [0, 1, 0]);
  const cz = rotate(q, [0, 0, 1]);
  return [...cx, ...cy, ...cz];
}
