// How a scan's six skybox faces become a GPU cube map, and how much each
// panorama counts toward the picture (issue 118). Pure.
//
// A scan face is an ordinary photo taken from inside the cube: it looks along
// `forward`, and its top edge points along `up`, both given in the panorama's
// own frame (y-up, after coords.ts). Its right edge is then forward × up.
// `SCAN_FACES` is the scan's convention, found by standing at a scan position
// and lining the projection up with the mesh.
//
// A GPU cube map is looked up by a direction and is laid out as if seen from
// outside, so every face is a mirror image of a photo. Rather than mirror six
// images per panorama, the shader looks the cube up with x negated
// (`CUBE_LOOKUP_FLIP`), which makes each slot an ordinary photo again:
// `CUBE_SLOTS` lists, in the GPU's +x, -x, +y, -y, +z, -z order, where each
// slot's photo looks and which way its top edge points.
import type { Vec3 } from "./coords";

export interface FaceFrame {
  forward: Vec3;
  up: Vec3;
}

/** Multiply a panorama-frame direction by this before the cube lookup. */
export const CUBE_LOOKUP_FLIP: Vec3 = [-1, 1, 1];

/** The photo each GPU cube slot holds when looked up through `CUBE_LOOKUP_FLIP`. */
export const CUBE_SLOTS: readonly FaceFrame[] = [
  { forward: [-1, 0, 0], up: [0, 1, 0] },
  { forward: [1, 0, 0], up: [0, 1, 0] },
  { forward: [0, 1, 0], up: [0, 0, -1] },
  { forward: [0, -1, 0], up: [0, 0, 1] },
  { forward: [0, 0, 1], up: [0, 1, 0] },
  { forward: [0, 0, -1], up: [0, 1, 0] },
];

/** The scan's faces 0 to 5, in the panorama's own frame. */
export const SCAN_FACES: readonly FaceFrame[] = [
  // 0 looks up, 1 to 4 go round the horizon (+x, then turning right), 5 looks
  // down. The top edges of 0 and 5 are the edges they share with face 3 and 1.
  { forward: [0, 1, 0], up: [-1, 0, 0] },
  { forward: [1, 0, 0], up: [0, 1, 0] },
  { forward: [0, 0, 1], up: [0, 1, 0] },
  { forward: [-1, 0, 0], up: [0, 1, 0] },
  { forward: [0, 0, -1], up: [0, 1, 0] },
  { forward: [0, -1, 0], up: [1, 0, 0] },
];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A face's right edge: what is to the right when looking along forward with `up` up. */
export function faceRight(face: FaceFrame): Vec3 {
  return cross(face.forward, face.up);
}

export interface SlotSource {
  /** Which scan face fills this slot. */
  face: number;
  /**
   * The canvas transform (a, b, c, d of `setTransform`, about the centre) that
   * draws the scan face into the slot: a quarter-turn or mirror. Identity
   * means the image goes in as it is.
   */
  transform: readonly [number, number, number, number];
  identity: boolean;
}

/**
 * For each GPU cube slot, the scan face that fills it and how it is turned.
 * Throws when `faces` is not six faces looking six different ways.
 */
export function cubeLayout(faces: readonly FaceFrame[] = SCAN_FACES): SlotSource[] {
  if (faces.length !== 6) throw new Error("a skybox has six faces");
  return CUBE_SLOTS.map((slot) => {
    const face = faces.findIndex((f) => dot(f.forward, slot.forward) > 0.99);
    if (face === -1) throw new Error("no scan face looks along a cube slot");
    const source = faces[face];
    const sr = faceRight(source);
    const gr = faceRight(slot);
    // A point at (x right, y up) in the scan face lands at
    // (x sr·gr + y su·gr, x sr·gu + y su·gu) in the slot. Canvas y runs down,
    // which flips the sign of the two cross terms.
    const a = Math.round(dot(sr, gr));
    const c = -Math.round(dot(source.up, gr));
    const b = -Math.round(dot(sr, slot.up));
    const d = Math.round(dot(source.up, slot.up));
    return { face, transform: [a, b, c, d] as const, identity: a === 1 && b === 0 && c === 0 && d === 1 };
  });
}

/** A rotation as three rows: row r dotted with a vector gives its turned component r. */
export type Rows = readonly [Vec3, Vec3, Vec3];

const turn = (rows: Rows, v: Vec3): Vec3 => [dot(rows[0], v), dot(rows[1], v), dot(rows[2], v)];

/** The 24 rotations that take the axes to the axes. */
function axisRotations(): Rows[] {
  const axes: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const out: Rows[] = [];
  for (const x of axes) {
    for (const y of axes) {
      if (dot(x, y) !== 0) continue;
      out.push([x, y, cross(x, y)]);
    }
  }
  // The identity first, so it wins a tie.
  return out.sort((a, b) => Number(b[0][0] === 1 && b[1][1] === 1) - Number(a[0][0] === 1 && a[1][1] === 1));
}

/**
 * The turn of the panorama's frame that lets the most scan faces go into the
 * GPU cube as they are, and the layout once it is applied. A cube laid out
 * like the scan's needs no face redrawn at all: turning the frame is one
 * matrix in the shader, where redrawing is a canvas per face per panorama.
 * Apply `rotation`, then `CUBE_LOOKUP_FLIP`, to a panorama-frame direction.
 */
export function alignToCube(faces: readonly FaceFrame[] = SCAN_FACES): { rotation: Rows; layout: SlotSource[] } {
  let best: { rotation: Rows; layout: SlotSource[] } | null = null;
  let most = -1;
  for (const rotation of axisRotations()) {
    const turned = faces.map((f) => ({ forward: turn(rotation, f.forward), up: turn(rotation, f.up) }));
    const layout = cubeLayout(turned);
    const asIs = layout.filter((s) => s.identity).length;
    if (asIs > most) {
      most = asIs;
      best = { rotation, layout };
    }
  }
  if (!best) throw new Error("a skybox has six faces");
  return best;
}

/** Where a direction lands on a set of faces: which face, and (u right, v up) in [-1, 1]. */
export function faceLookup(faces: readonly FaceFrame[], direction: Vec3): { face: number; u: number; v: number } {
  let best = 0;
  let most = -Infinity;
  faces.forEach((f, i) => {
    const along = dot(f.forward, direction);
    if (along > most) {
      most = along;
      best = i;
    }
  });
  const f = faces[best];
  return { face: best, u: dot(faceRight(f), direction) / most, v: dot(f.up, direction) / most };
}

/**
 * How far a panorama is from the player for ranking: plain distance, with
 * height counted three times over so a panorama on another storey ranks far.
 */
export function panoDistance(player: Vec3, pano: Vec3): number {
  return Math.hypot(player[0] - pano[0], (player[1] - pano[1]) * 3, player[2] - pano[2]);
}

/**
 * How much each panorama counts, from its distance to the player. The `keep`
 * nearest share the picture; each one's share falls to zero exactly as it
 * becomes the (keep + 1)th nearest, so the set changes without a pop, and the
 * share of a panorama the player stands on goes to one, where its picture is
 * exact whatever the mesh looks like. Shares sum to 1 (or are all 0 for no
 * panoramas).
 */
export function panoWeights(distances: readonly number[], keep = 3, soft = 0.12): number[] {
  if (distances.length === 0) return [];
  const sorted = [...distances].sort((a, b) => a - b);
  const cutoff = sorted.length > keep ? sorted[keep] : Infinity;
  const raw = distances.map((d) => {
    const fade = cutoff === Infinity ? 1 : Math.max(0, 1 - d / Math.max(cutoff, 1e-6));
    // Squared: two panoramas blended half and half show thin things twice, so
    // the nearer one keeps most of the picture until the player is nearly midway.
    const near = fade / (d * d + soft * soft);
    return near * near;
  });
  const total = raw.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    // Every candidate sits exactly on the cutoff: share evenly among the nearest.
    const nearest = sorted[0];
    const ties = distances.filter((d) => d === nearest).length;
    return distances.map((d) => (d === nearest ? 1 / ties : 0));
  }
  return raw.map((w) => w / total);
}
