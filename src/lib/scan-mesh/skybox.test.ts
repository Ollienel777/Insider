import { describe, expect, it } from "vitest";
import type { Vec3 } from "./coords";
import {
  CUBE_LOOKUP_FLIP,
  CUBE_SLOTS,
  cubeLayout,
  faceLookup,
  faceRight,
  panoDistance,
  panoWeights,
  SCAN_FACES,
  type FaceFrame,
} from "./skybox";

/**
 * The GPU's own cube lookup (OpenGL ES 3.0, table 8.19): for a direction, the
 * face (+x -x +y -y +z -z) and (s, t) in [-1, 1], t growing down the image.
 */
function gpuLookup([x, y, z]: Vec3): { slot: number; s: number; t: number } {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return x > 0 ? { slot: 0, s: -z / ax, t: -y / ax } : { slot: 1, s: z / ax, t: -y / ax };
  if (ay >= az) return y > 0 ? { slot: 2, s: x / ay, t: z / ay } : { slot: 3, s: x / ay, t: -z / ay };
  return z > 0 ? { slot: 4, s: x / az, t: -y / az } : { slot: 5, s: -x / az, t: -y / az };
}

const flip = (d: Vec3): Vec3 => [d[0] * CUBE_LOOKUP_FLIP[0], d[1] * CUBE_LOOKUP_FLIP[1], d[2] * CUBE_LOOKUP_FLIP[2]];

const DIRECTIONS: Vec3[] = [];
for (let i = 0; i < 200; i++) {
  // A fixed scatter over the sphere, clear of the cube's edges.
  const a = i * 2.399963;
  const y = 1 - (2 * (i + 0.5)) / 200;
  const r = Math.sqrt(1 - y * y);
  const d: Vec3 = [Math.cos(a) * r, y, Math.sin(a) * r];
  const sorted = d.map(Math.abs).sort((p, q) => q - p);
  if (sorted[0] - sorted[1] > 0.05) DIRECTIONS.push(d);
}

describe("the cube slots", () => {
  it("are ordinary photos: right-handed, six different ways", () => {
    const seen = new Set(CUBE_SLOTS.map((s) => s.forward.join()));
    expect(seen.size).toBe(6);
    for (const slot of CUBE_SLOTS) {
      const right = faceRight(slot);
      expect(Math.hypot(...right)).toBeCloseTo(1, 9);
      expect(right[0] * slot.up[0] + right[1] * slot.up[1] + right[2] * slot.up[2]).toBe(0);
    }
  });

  it("say where the GPU really looks: through the flip, a direction lands on its slot at the photo's own place", () => {
    expect(DIRECTIONS.length).toBeGreaterThan(100);
    for (const d of DIRECTIONS) {
      const gpu = gpuLookup(flip(d));
      const photo = faceLookup(CUBE_SLOTS, d);
      expect(gpu.slot).toBe(photo.face);
      expect(gpu.s).toBeCloseTo(photo.u, 9);
      // t grows down the image; v grows up it.
      expect(gpu.t).toBeCloseTo(-photo.v, 9);
    }
  });
});

describe("cubeLayout", () => {
  it("puts photos already in slot order in as they are", () => {
    const layout = cubeLayout(CUBE_SLOTS);
    expect(layout.map((s) => s.face)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(layout.every((s) => s.identity)).toBe(true);
  });

  /** Where a point of a scan face lands once it is drawn into its slot with the layout's transform. */
  function drawn(transform: readonly number[], u: number, v: number): { s: number; t: number } {
    // Canvas coordinates about the centre: x right, y down.
    const [a, b, c, d] = transform;
    const x = u;
    const y = -v;
    return { s: a * x + c * y, t: b * x + d * y };
  }

  it.each([
    ["the scan's own convention", SCAN_FACES],
    [
      "faces shuffled and turned every which way",
      [
        { forward: [0, 0, 1], up: [1, 0, 0] },
        { forward: [0, -1, 0], up: [-1, 0, 0] },
        { forward: [-1, 0, 0], up: [0, 0, -1] },
        { forward: [0, 1, 0], up: [0, 0, 1] },
        { forward: [1, 0, 0], up: [0, -1, 0] },
        { forward: [0, 0, -1], up: [0, 1, 0] },
      ] as FaceFrame[],
    ],
  ])("draws %s so every direction finds its own pixel", (_name, faces) => {
    const layout = cubeLayout(faces);
    expect(new Set(layout.map((s) => s.face)).size).toBe(6);
    for (const d of DIRECTIONS) {
      const scan = faceLookup(faces, d);
      const gpu = gpuLookup(flip(d));
      expect(layout[gpu.slot].face).toBe(scan.face);
      const at = drawn(layout[gpu.slot].transform, scan.u, scan.v);
      expect(at.s).toBeCloseTo(gpu.s, 9);
      expect(at.t).toBeCloseTo(gpu.t, 9);
    }
  });

  it("refuses a set of faces that leaves a side of the cube empty", () => {
    const five = [...SCAN_FACES.slice(0, 5), SCAN_FACES[0]];
    expect(() => cubeLayout(five)).toThrow();
    expect(() => cubeLayout(SCAN_FACES.slice(0, 5))).toThrow();
  });
});

describe("panoDistance", () => {
  it("is plain distance on one storey, and counts height three times over", () => {
    expect(panoDistance([0, 1.6, 0], [3, 1.6, 4])).toBeCloseTo(5, 9);
    expect(panoDistance([0, 1.6, 0], [0, 4.6, 0])).toBeCloseTo(9, 9);
  });
});

describe("panoWeights", () => {
  const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);

  it("is empty for no panoramas, and everything for one", () => {
    expect(panoWeights([])).toEqual([]);
    expect(panoWeights([7])).toEqual([1]);
  });

  it("shares the picture among the three nearest, summing to one", () => {
    const w = panoWeights([4, 1, 9, 2, 6]);
    expect(sum(w)).toBeCloseTo(1, 9);
    expect(w[2]).toBe(0);
    expect(w[4]).toBe(0);
    expect(w[1]).toBeGreaterThan(w[3]);
    expect(w[3]).toBeGreaterThan(w[0]);
    expect(w[0]).toBeGreaterThan(0);
  });

  it("gives the panorama the player stands on nearly everything", () => {
    const w = panoWeights([0, 2, 3, 4]);
    expect(w[0]).toBeGreaterThan(0.97);
  });

  it("has no pop as the third and fourth nearest swap", () => {
    const before = panoWeights([1, 2, 2.999, 3]);
    const after = panoWeights([1, 2, 3, 2.999]);
    expect(before[2]).toBeLessThan(1e-6);
    expect(after[3]).toBeLessThan(1e-6);
    for (let i = 0; i < 2; i++) expect(Math.abs(before[i] - after[i])).toBeLessThan(1e-3);
  });

  it("changes a little for a small step, all the way across a room", () => {
    // Four panoramas on a line; the player walks past them.
    const at = [0, 2.5, 5, 7.5];
    let last = panoWeights(at.map((p) => Math.abs(p - 0)));
    for (let x = 0.01; x <= 7.5; x += 0.01) {
      const now = panoWeights(at.map((p) => Math.abs(p - x)));
      for (let i = 0; i < at.length; i++) expect(Math.abs(now[i] - last[i])).toBeLessThan(0.05);
      last = now;
    }
  });

  it("splits evenly between panoramas the same distance away", () => {
    expect(panoWeights([2, 2])).toEqual([0.5, 0.5]);
    const tied = panoWeights([3, 3, 3, 3]);
    expect(sum(tied)).toBeCloseTo(1, 9);
    expect(new Set(tied).size).toBe(1);
  });
});
