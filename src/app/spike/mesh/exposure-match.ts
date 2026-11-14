// Gathers the colour pairs lib/scan-mesh/exposure.ts solves (issue 118): for
// each panorama, points of the mesh it saw that a near neighbour saw too, and
// the colour each gave them. Works from tiny copies of the faces already held
// in memory, a panorama at a time between frames, so the walk doesn't stutter.
import { DoubleSide, Ray, Vector3 } from "three";
import { conjugate, rotate, type Quat, type Vec3 } from "@/lib/scan-mesh/coords";
import { pairRatio, solveGains, type PairRatio, type Rgb } from "@/lib/scan-mesh/exposure";
import { faceLookup, SCAN_FACES } from "@/lib/scan-mesh/skybox";
import type { MeshWorld } from "./collider";

export interface ExposureSource {
  index: number;
  origin: Vec3;
  /** The panorama's rotation, y-up. */
  rotation: Quat;
  /** Its six faces' bytes, in the scan's order. */
  faces: Blob[];
}

/** Pixels across each tiny face copy. */
const SIZE = 48;
/** Directions sampled from each panorama. */
const DIRECTIONS = 320;
/** Neighbours each panorama is compared with, and how far away they may be, metres. */
const NEIGHBOURS = 4;
const REACH = 8;

type Faces = Uint8ClampedArray[];

async function tiny(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: SIZE,
    resizeHeight: SIZE,
    resizeQuality: "medium",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, SIZE, SIZE).data;
}

/** The colour a panorama gave the world direction `direction`. */
function colourAt(faces: Faces, rotation: Quat, direction: Vec3): Rgb {
  const own = rotate(conjugate(rotation), direction);
  const { face, u, v } = faceLookup(SCAN_FACES, own);
  const x = Math.min(SIZE - 1, Math.max(0, Math.floor(((u + 1) / 2) * SIZE)));
  const y = Math.min(SIZE - 1, Math.max(0, Math.floor(((1 - v) / 2) * SIZE)));
  const at = (y * SIZE + x) * 4;
  const px = faces[face];
  return [px[at], px[at + 1], px[at + 2]];
}

/** Evenly spread unit directions. */
function sphere(n: number): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963229728653;
    return [Math.cos(a) * r, y, Math.sin(a) * r] as Vec3;
  });
}

const yieldFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * One gain per panorama and channel, by index, so neighbours match. Resolves
 * with an empty map when it is stopped (`signal`) or finds no pairs.
 */
export async function matchExposure(
  sources: readonly ExposureSource[],
  world: MeshWorld,
  signal: AbortSignal,
): Promise<{ gains: Map<number, Rgb>; pairs: number }> {
  const faces = new Map<number, Faces>();
  for (const s of sources) {
    if (signal.aborted) return { gains: new Map(), pairs: 0 };
    try {
      faces.set(s.index, await Promise.all(s.faces.map(tiny)));
    } catch {
      // A face that won't decode leaves this panorama out.
    }
  }

  const ray = new Ray();
  const visibleFrom = (from: Vec3, point: Vec3): Vec3 | null => {
    const to = new Vector3(point[0] - from[0], point[1] - from[1], point[2] - from[2]);
    const reach = to.length();
    ray.set(new Vector3(...from), to.normalize());
    const hit = world.bvh.raycastFirst(ray, DoubleSide);
    if (hit && hit.distance < reach * 0.97 - 0.05) return null;
    return [to.x, to.y, to.z];
  };

  const directions = sphere(DIRECTIONS);
  const ratios: PairRatio[] = [];
  for (const a of sources) {
    if (signal.aborted) return { gains: new Map(), pairs: 0 };
    const facesA = faces.get(a.index);
    if (!facesA) continue;
    const neighbours = sources
      .filter((b) => b.index !== a.index && faces.has(b.index))
      .map((b) => ({ b, d: Math.hypot(b.origin[0] - a.origin[0], (b.origin[1] - a.origin[1]) * 3, b.origin[2] - a.origin[2]) }))
      .filter(({ d }) => d < REACH)
      .sort((x, y) => x.d - y.d)
      .slice(0, NEIGHBOURS);
    if (neighbours.length === 0) continue;

    // The points of the mesh this panorama saw.
    const points: { point: Vec3; direction: Vec3 }[] = [];
    for (const direction of directions) {
      ray.set(new Vector3(...a.origin), new Vector3(...direction));
      const hit = world.bvh.raycastFirst(ray, DoubleSide);
      if (!hit || hit.distance > REACH || hit.distance < 0.3) continue;
      points.push({ point: [hit.point.x, hit.point.y, hit.point.z], direction });
    }
    for (const { b } of neighbours) {
      const facesB = faces.get(b.index)!;
      const colourA: Rgb[] = [];
      const colourB: Rgb[] = [];
      for (const { point, direction } of points) {
        const fromB = visibleFrom(b.origin, point);
        if (!fromB) continue;
        colourA.push(colourAt(facesA, a.rotation, direction));
        colourB.push(colourAt(facesB, b.rotation, fromB));
      }
      const r = pairRatio({ a: a.index, b: b.index, colourA, colourB });
      if (r) ratios.push(r);
    }
    await yieldFrame();
  }

  const indices = sources.map((s) => s.index);
  const count = Math.max(0, ...indices) + 1;
  const solved = solveGains(count, ratios);
  const gains = new Map<number, Rgb>();
  for (const i of indices) gains.set(i, solved[i]);
  return { gains, pairs: ratios.length };
}
