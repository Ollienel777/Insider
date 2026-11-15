// The nearest panorama alone, warped a little by its own depth (issue 118, `view=photo`).
//
// One sphere, centred where the panorama was taken, each vertex pushed out
// along its direction to as far as the panorama saw that way: the same
// sheet as sphere-material.ts, but drawn alone, opaque, and with nothing
// cut out of it. Where the depth jumps (a door frame against the room
// behind) the triangles across the jump are kept, stretched: a smear of the
// edge's colour rather than a hole. A stretched skin is only visible from
// off the panorama's own line of sight, so the eye's offset from the scan
// position, for the picture, is held to `REACH` metres: the parallax stays
// mild and the sheet never tears open. Beyond that it follows less and
// less (up to three times `REACH`), floating a little with the player.
//
// The camera itself stays where the player is (walking and collision use
// it). The sphere is moved by the difference instead: drawn from the
// camera, it looks exactly as it would from the clamped point.
import { DoubleSide, ShaderMaterial, Vector3, Vector4, type IUniform } from "three";
import type { PhotoUniforms } from "./photo-material";
import { DEPTH_FAR, DEPTH_NEAR, DEPTH_STEP } from "./sphere-material";

/** Fitted planes handed to the shader at most, the ones that matter most to the panorama shown. */
export const PLANES = 48;

/** How far from its scan position the picture follows the eye, metres. */
export const REACH = 0.38;
/**
 * Nothing is moved as if it were nearer than this, metres. A door frame
 * half a metre from the scan position against a room six metres behind it
 * would otherwise slide a long way across the room, and the stretched sheet
 * between the two would be a long smear. Held back, near things move a
 * little less than they should, and the smear stays short.
 */
export const PARALLAX_NEAR = 1.6;

const vertex = (slot: number) => /* glsl */ `
uniform vec3 uPanoPos[4];
uniform samplerCube uDepth${slot};
/** The camera's position less the clamped one the picture is from. */
uniform vec3 uShift;
/** The mesh's fitted planes near the panorama (normal, offset: normal · p = offset), and how many are set. */
uniform vec4 uPlanes[${PLANES}];
uniform int uPlaneCount;
varying vec3 vDirection;
/** Where the panorama looks just past this vertex's edge, on its far side: what a stretched triangle is painted with. */
varying vec3 vBack;
varying float vConfidence;

float depthAt(vec3 direction) {
  return clamp(texture(uDepth${slot}, direction).r, ${DEPTH_NEAR.toFixed(2)}, ${DEPTH_FAR.toFixed(1)});
}

/**
 * How far the depth round a vertex is from flat, and the mean inverse depth
 * round it. Across any plane the inverse depth is linear in the direction,
 * so for samples opposite each other on a ring the mean of their inverse
 * depths is the vertex's own: a floor seen at a slant counts as flat, as it
 * is. x: the worst of four such pairs, as a part of the vertex's inverse
 * depth (0 on a plane, large at an edge or a thin thing); y: the mean
 * inverse depth of the ring's eight samples.
 */
vec2 ring(vec3 direction, vec3 across, vec3 up, float radius, float own) {
  float worst = 0.0;
  float total = 0.0;
  for (int k = 0; k < 4; k++) {
    float a = float(k) * 0.7853982;
    vec3 side = (across * cos(a) + up * sin(a)) * radius;
    float a1 = 1.0 / depthAt(direction + side);
    float a2 = 1.0 / depthAt(direction - side);
    worst = max(worst, abs(0.5 * (a1 + a2) * own - 1.0));
    total += a1 + a2;
  }
  return vec2(worst, total / 8.0);
}

void main() {
  vec3 direction = normalize(position);
  vDirection = direction;
  vec3 across = normalize(cross(direction, abs(direction.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 up = cross(direction, across);
  float s[9];
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      s[j * 3 + i] = depthAt(direction + (across * float(i - 1) + up * float(j - 1)) * ${(DEPTH_STEP * 1.5).toFixed(4)});
    }
  }
  float own = s[4];
  // The deepest of the samples, and the ratio of deepest to nearest: an edge, and which side of it is behind.
  int deepest = 0;
  float least = s[0];
  for (int k = 1; k < 9; k++) {
    if (s[k] > s[deepest]) deepest = k;
    least = min(least, s[k]);
  }
  float jump = s[deepest] / least;
  vec3 toward = across * float(deepest - (deepest / 3) * 3 - 1) + up * float(deepest / 3 - 1);
  vBack = normalize(direction + toward * ${(DEPTH_STEP * 3).toFixed(4)} * smoothstep(1.15, 1.4, jump));
  for (int a = 0; a < 8; a++) {
    for (int b = 0; b < 8 - a; b++) {
      if (s[b] > s[b + 1]) {
        float t = s[b];
        s[b] = s[b + 1];
        s[b + 1] = t;
      }
    }
  }
  float median = s[4];
  float sum = 0.0;
  float count = 0.0;
  for (int k = 0; k < 9; k++) {
    float w = 1.0 - smoothstep(0.04, 0.12, abs(s[k] - median) / median);
    sum += s[k] * w;
    count += w;
  }
  float depth = count > 0.0 ? sum / count : median;
  depth = mix(depth, own, 0.25 * (1.0 - smoothstep(0.02, 0.08, abs(own - median) / median)));
  // How far this vertex's depth can be trusted to move it: none at a jump in depth or a thin thing
  // (the samples close round it are not on one plane; glass and reflections, whose depth is noise,
  // come out the same), rising over a few degrees as the rings farther out agree, so nothing steps.
  vec2 r1 = ring(direction, across, up, ${(DEPTH_STEP * 1.5).toFixed(4)}, own);
  vec2 r2 = ring(direction, across, up, ${(DEPTH_STEP * 3).toFixed(4)}, own);
  vec2 r4 = ring(direction, across, up, ${(DEPTH_STEP * 6).toFixed(4)}, own);
  float c1 = 1.0 - smoothstep(0.03, 0.12, r1.x);
  float c2 = 1.0 - smoothstep(0.04, 0.16, r2.x);
  float c4 = 1.0 - smoothstep(0.05, 0.2, r4.x);
  float confidence = c1 * mix(1.0, c2, 0.75) * mix(1.0, c4, 0.5);
  vConfidence = confidence;
  // Where the depth is not trusted, the vertex moves by the depth of the
  // wide neighbourhood round it (the mean of the inverse depths, which is
  // a plane's own across a plane) rather than its own: a thin partition top
  // or a glass door frame rides with what is round it as one smooth sheet,
  // instead of waving. Held still outright, as a first try had it, the
  // still parts sheared against the moving ones wherever they met.
  float wide = (r2.y + 2.0 * r4.y) / 3.0;
  depth = 1.0 / mix(wide, 1.0 / depth, confidence);
  // On a fitted plane (a wall, a partition's face, a desk, a pane) the plane's own depth, not the
  // samples': the surface moves as one rigid sheet. A plane counts only where the depth the
  // panorama has here (its own, unsmoothed) is close to where the ray meets it.
  float onPlane = 0.0;
  float planeDepth = depth;
  float best = 1e9;
  vec3 origin = uPanoPos[${slot}];
  for (int k = 0; k < ${PLANES}; k++) {
    if (k >= uPlaneCount) break;
    vec4 plane = uPlanes[k];
    float facing = dot(plane.xyz, direction);
    if (abs(facing) < 0.08) continue;
    float t = (plane.w - dot(plane.xyz, origin)) / facing;
    if (t <= 0.0) continue;
    float miss = abs(t - own) / (0.04 + 0.03 * own);
    if (miss < 1.0 && miss < best) {
      best = miss;
      planeDepth = t;
    }
  }
  if (best < 1.0) {
    // Only where the depth round the vertex is already trusted: an infinite plane met by chance at
    // an edge would undo the smooth sheet there and tear it again.
    onPlane = (1.0 - smoothstep(0.15, 1.0, best)) * smoothstep(0.4, 0.8, confidence);
    depth = mix(depth, planeDepth, onPlane);
    vConfidence = max(vConfidence, onPlane);
  }
  vec3 world = origin + direction * max(depth, ${PARALLAX_NEAR.toFixed(2)}) + uShift;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragment = (slot: number) => /* glsl */ `
uniform mat3 uPanoInv[4];
uniform vec3 uPanoGain[4];
uniform float uPanoSharp[4];
uniform samplerCube uPano${slot};
uniform samplerCube uLow${slot};
/** The angle a screen pixel spans, radians. */
uniform float uPixel;
/** 1 shows each pixel's confidence in red (debug). */
uniform float uShowConfidence;
varying vec3 vDirection;
varying vec3 vBack;
varying float vConfidence;

void main() {
  // A triangle stretched across a jump in depth spans far more of the screen than of the panorama:
  // paint it from the far side of the edge (what the step uncovers), not the edge itself drawn out.
  float stretch = length(fwidth(vDirection)) / uPixel;
  vec3 direction = normalize(mix(vBack, vDirection, smoothstep(0.2, 0.45, stretch)));
  vec3 lookup = uPanoInv[${slot}] * direction;
  float sharp = uPanoSharp[${slot}];
  vec3 colour = sharp >= 1.0 ? textureCube(uPano${slot}, lookup).rgb
    : sharp <= 0.0 ? textureCube(uLow${slot}, lookup).rgb
    : mix(textureCube(uLow${slot}, lookup).rgb, textureCube(uPano${slot}, lookup).rgb, sharp);
  colour *= uPanoGain[${slot}];
  if (uShowConfidence > 0.5) colour = mix(colour, vec3(1.0, 0.0, 0.0), 0.6 * (1.0 - vConfidence));
  gl_FragColor = vec4(colour, 1.0);
}
`;

/** The material for the panorama in the store's slot `slot`, drawn alone and whole. `uShift` is set each frame. */
export function createPhotoViewMaterial(panos: PhotoUniforms, slot: number): ShaderMaterial {
  const uniforms: Record<string, IUniform> = { ...panos, uShift: { value: new Vector3() }, uPlanes: { value: Array.from({ length: PLANES }, () => new Vector4()) }, uPlaneCount: { value: 0 }, uShowConfidence: { value: 0 }, uPixel: { value: 0.001 } };
  return new ShaderMaterial({
    uniforms,
    vertexShader: vertex(slot),
    fragmentShader: fragment(slot),
    side: DoubleSide,
    toneMapped: false,
    depthTest: true,
    depthWrite: true,
  });
}

/**
 * `uShift` for a panorama at `origin` seen from `eye`: the part of the eye's
 * offset the picture does not follow. Up to `reach` metres it follows fully;
 * beyond, less and less, approaching `reach` × 3 (a tanh, so the follow never
 * stops at a stroke): walking on past the reach still moves the picture, and
 * the confidence weighting keeps that from tearing.
 */
export function photoShift(eye: readonly [number, number, number], origin: readonly [number, number, number], reach = REACH): [number, number, number] {
  const dx = eye[0] - origin[0];
  const dy = eye[1] - origin[1];
  const dz = eye[2] - origin[2];
  const length = Math.hypot(dx, dy, dz);
  if (length <= reach || length === 0) return [0, 0, 0];
  const followed = reach + 2 * reach * Math.tanh((length - reach) / (2 * reach));
  const keep = 1 - followed / length;
  return [dx * keep, dy * keep, dz * keep];
}

/**
 * The planes that matter most to a panorama at `origin`, best first: the
 * largest and nearest, within `reach` metres. `planes` is five numbers a
 * plane (normal, offset, area), as the repair sends them.
 */
export function planesFor(planes: Float32Array, origin: readonly [number, number, number], count = PLANES, reach = 15): number[] {
  const scored: [number, number][] = [];
  for (let i = 0; i * 5 < planes.length; i++) {
    const at = i * 5;
    const distance = Math.abs(planes[at] * origin[0] + planes[at + 1] * origin[1] + planes[at + 2] * origin[2] - planes[at + 3]);
    if (distance > reach) continue;
    scored.push([i, planes[at + 4] / (1 + distance)]);
  }
  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([i]) => i);
}
