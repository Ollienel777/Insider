// Made-up poses and pixels.
import { describe, expect, it } from "vitest";
import { eyePose, poseVelocity, viewStats, type ScanPose } from "./pose";

const at = (x: number, z: number): ScanPose => ({ x, y: 1.6, z, yaw: 0, pitch: 0 });

describe("poseVelocity", () => {
  it("is the horizontal speed between two frames", () => {
    const [vx, vz] = poseVelocity(at(0, 0), at(0.05, -0.1), 0.02);
    expect(vx).toBeCloseTo(2.5, 9);
    expect(vz).toBeCloseTo(-5, 9);
  });

  it("is zero for the first frame, a zero step, and a teleport", () => {
    expect(poseVelocity(null, at(1, 1), 0.02)).toEqual([0, 0]);
    expect(poseVelocity(at(0, 0), at(1, 1), 0)).toEqual([0, 0]);
    expect(poseVelocity(at(0, 0), at(8, 0), 0.02)).toEqual([0, 0]);
  });
});

describe("eyePose", () => {
  it("lifts the feet to the eye", () => {
    expect(eyePose([2, 0.1, -3], 0.5, -0.2, 1.6)).toEqual({ x: 2, y: 1.7000000000000002, z: -3, yaw: 0.5, pitch: -0.2 });
  });
});

describe("viewStats", () => {
  /** Four pixels: backdrop, seen mesh, unseen far mesh, unseen near mesh that a panorama nearly saw. */
  const coverage = Uint8Array.from([0, 0, 12, 255, 0, 0, 255, 255, 255, 0, 255, 255, 255, 255, 255, 30]);
  it("counts coverage over the mesh only", () => {
    const doubles = Uint8Array.from([0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
    const s = viewStats(coverage, doubles);
    expect(s.mesh).toBeCloseTo(0.75, 9);
    expect(s.unseen).toBeCloseTo(2 / 3, 9);
    expect(s.unseenNear).toBeCloseTo(1 / 3, 9);
    expect(s.unseenClose).toBeCloseTo(1 / 3, 9);
    expect(s.ghost).toBe(0);
  });

  it("reads the ghost back from a quarter scale, and counts what shows twice", () => {
    // Ghosts of 0.2 (shows) and 0.02 (doesn't), times four, as bytes; the unseen far pixel is the doubled one.
    const doubles = Uint8Array.from([0, 0, 0, 0, 20, 40, 255, 255, 204, 102, 255, 255, 0, 0, 255, 255]);
    const s = viewStats(coverage, doubles);
    expect(s.ghost).toBeCloseTo((20 / 255 / 4 + 204 / 255 / 4) / 3, 9);
    expect(s.doubled).toBeCloseTo(1 / 3, 9);
    expect(s.unseenMixed).toBeCloseTo(1 / 3, 9);
  });

  it("is all zero for a frame with no mesh", () => {
    const empty = new Uint8Array(16);
    expect(viewStats(empty, empty).unseen).toBe(0);
  });
});
