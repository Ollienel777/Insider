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
// mild and the sheet never tears open. Beyond that the picture is the one
// from `REACH` metres out, floating a little with the player.
//
// The camera itself stays where the player is (walking and collision use
// it). The sphere is moved by the difference instead: drawn from the
// camera, it looks exactly as it would from the clamped point.
import { DoubleSide, ShaderMaterial, Vector3, type IUniform } from "three";
import type { PhotoUniforms } from "./photo-material";
import { DEPTH_FAR, DEPTH_NEAR, DEPTH_STEP } from "./sphere-material";

/** How far from its scan position the picture follows the eye, metres. */
export const REACH = 0.6;
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
varying vec3 vDirection;
/** Where the panorama looks just past this vertex's edge, on its far side: what a stretched triangle is painted with. */
varying vec3 vBack;

float depthAt(vec3 direction) {
  return clamp(texture(uDepth${slot}, direction).r, ${DEPTH_NEAR.toFixed(2)}, ${DEPTH_FAR.toFixed(1)});
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
  vec3 world = uPanoPos[${slot}] + direction * max(depth, ${PARALLAX_NEAR.toFixed(2)}) + uShift;
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
varying vec3 vDirection;
varying vec3 vBack;

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
  gl_FragColor = vec4(colour * uPanoGain[${slot}], 1.0);
}
`;

/** The material for the panorama in the store's slot `slot`, drawn alone and whole. `uShift` is set each frame. */
export function createPhotoViewMaterial(panos: PhotoUniforms, slot: number): ShaderMaterial {
  const uniforms: Record<string, IUniform> = { ...panos, uShift: { value: new Vector3() }, uPixel: { value: 0.001 } };
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

/** `uShift` for a panorama at `origin` seen from `eye`: the eye's offset past `REACH` metres, which the picture does not follow. */
export function photoShift(eye: readonly [number, number, number], origin: readonly [number, number, number], reach = REACH): [number, number, number] {
  const dx = eye[0] - origin[0];
  const dy = eye[1] - origin[1];
  const dz = eye[2] - origin[2];
  const length = Math.hypot(dx, dy, dz);
  if (length <= reach) return [0, 0, 0];
  const keep = 1 - reach / length;
  return [dx * keep, dy * keep, dz * keep];
}
