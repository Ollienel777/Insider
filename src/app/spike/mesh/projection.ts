// The scan mesh's material (issue 118): the picture at each point of the mesh
// comes from the panoramas that can see it.
//
// For up to four panoramas at once, a fragment looks its colour up in that
// panorama's cube map along the line from the panorama to the fragment. Each
// one's say is lib/scan-mesh/blend.ts's rule, the same sums: by default, how
// nearly its ray to the fragment agrees with the player's (so the picture
// changes with every step), times its slot's share as it enters or leaves,
// how squarely it faced the surface, and whether it saw the fragment at all:
// its depth cube holds how far it could see in every direction, and a
// fragment farther than that is behind something. Each panorama's colours
// are scaled by its own gain, so neighbours taken at different exposures
// match where they overlap.
// The colours are then combined as lib/scan-mesh/combine.ts says: where they
// disagree (a thin thing the mesh lacks, landing in a different place in each
// panorama) the strongest panorama gets more of the say, so it shows once,
// not twice; and a fragment no panorama saw takes the one that came nearest
// to seeing it, rather than a grey average of all four.
//
// Every panorama has a small cube that is always on the GPU, and the nearest
// few have a full-size one as well: a slot shows the small one, and fades to
// the sharp one (`uPanoSharp`) once it has arrived. With no panorama loaded, or with
// projection switched off, the mesh shows bare: shaded from its face normals,
// since the scan's mesh carries no texture coordinates.
//
// This is the material for a mesh with no texture of its own (the 50k mesh,
// shown first). The detailed mesh, which has one, is painted by
// photo-material.ts, which also draws the backdrop.
//
// Colours are passed through untouched: the panorama texels are display
// values, the output is display values, and nothing is lit.
import { BackSide, DoubleSide, Matrix3, ShaderMaterial, Vector3, type CubeTexture } from "three";
import { ANGLE_FLOOR, HIDDEN, REACH_PENALTY } from "@/lib/scan-mesh/blend";
import { AGREE_HIGH, AGREE_LOW, FILL_POWER, FILL_REACH, SEEN_FLOOR, SHARPEN } from "@/lib/scan-mesh/combine";

/** Panoramas blended at once. */
export const SLOTS = 4;

const VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uPanoPos[${SLOTS}];
uniform mat3 uPanoInv[${SLOTS}];
uniform float uPanoShare[${SLOTS}];
uniform vec3 uPanoGain[${SLOTS}];
/** 0: the view rule; 1: the nearest rule (blend.ts). */
uniform float uMode;
uniform samplerCube uPano0;
uniform samplerCube uPano1;
uniform samplerCube uPano2;
uniform samplerCube uPano3;
uniform samplerCube uLow0;
uniform samplerCube uLow1;
uniform samplerCube uLow2;
uniform samplerCube uLow3;
uniform float uPanoSharp[${SLOTS}];
uniform samplerCube uDepth0;
uniform samplerCube uDepth1;
uniform samplerCube uDepth2;
uniform samplerCube uDepth3;
uniform float uProjection;
uniform float uDebug;
/** lib/scan-mesh/combine.ts: lean on the strongest where colours disagree; fill what nobody saw from one panorama. */
uniform float uAgree;
uniform float uFill;
varying vec3 vWorld;

void sampleSlot(samplerCube pano, samplerCube low, float sharp, samplerCube depth, vec3 origin, mat3 toPano, float share, vec3 gain, vec3 normal, vec3 sight, out vec3 colour, out float base, out float seen, out float miss) {
  colour = vec3(0.0);
  base = 0.0;
  seen = 1.0;
  miss = 0.0;
  if (share <= 0.0) return;
#ifdef BACKDROP
  vec3 ray = sight;
  base = share;
#else
  vec3 ray = vWorld - origin;
  float reach = length(ray);
  vec3 along = ray / max(reach, 1e-4);
  float seenTo = textureCube(depth, ray).r;
  float limit = seenTo * 1.03 + 0.08;
  seen = 1.0 - smoothstep(limit, limit + 0.25, reach);
  miss = max(0.0, reach - limit);
  float facing = smoothstep(0.02, 0.3, dot(normal, -along));
  if (uMode > 0.5) {
    float aligned = max(dot(sight, along), 0.0);
    base = share * (0.03 + pow(aligned, 4.0)) * (0.1 + 0.9 * facing);
  } else {
    float camReach = max(distance(vWorld, cameraPosition), 1e-4);
    float angle = acos(clamp(dot(sight, along), -1.0, 1.0));
    float penalty = angle + ${REACH_PENALTY.toFixed(4)} * max(0.0, (reach - camReach) / max(reach, 1e-4)) + ${ANGLE_FLOOR.toFixed(4)};
    base = share * (0.1 + 0.9 * facing) / (penalty * penalty);
  }
#endif
  vec3 lookup = toPano * ray;
  colour = sharp >= 1.0 ? textureCube(pano, lookup).rgb
    : sharp <= 0.0 ? textureCube(low, lookup).rgb
    : mix(textureCube(low, lookup).rgb, textureCube(pano, lookup).rgb, sharp);
  colour *= gain;
}

float gap(vec3 a, vec3 b) {
  vec3 d = abs(a - b);
  return (d.r + d.g + d.b) / 3.0;
}

void main() {
  vec3 sight = normalize(vWorld - cameraPosition);
#ifdef BACKDROP
  vec3 normal = -sight;
  vec3 bare = mix(vec3(0.027, 0.035, 0.047), vec3(0.067, 0.086, 0.114), smoothstep(-0.2, 0.6, sight.y));
#else
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(normal, sight) > 0.0) normal = -normal;
  // Bare look: light from above and a little from one side, fading with distance.
  float light = 0.5 + 0.32 * normal.y + 0.12 * normal.x + 0.06 * normal.z;
  vec3 clay = vec3(0.74, 0.77, 0.82) * light;
  float haze = 1.0 - exp(-distance(vWorld, cameraPosition) * 0.035);
  vec3 bare = mix(clay, vec3(0.09, 0.115, 0.15), haze);
#endif
  vec3 c[${SLOTS}];
  float b[${SLOTS}];
  float s[${SLOTS}];
  float m[${SLOTS}];
  sampleSlot(uPano0, uLow0, uPanoSharp[0], uDepth0, uPanoPos[0], uPanoInv[0], uPanoShare[0], uPanoGain[0], normal, sight, c[0], b[0], s[0], m[0]);
  sampleSlot(uPano1, uLow1, uPanoSharp[1], uDepth1, uPanoPos[1], uPanoInv[1], uPanoShare[1], uPanoGain[1], normal, sight, c[1], b[1], s[1], m[1]);
  sampleSlot(uPano2, uLow2, uPanoSharp[2], uDepth2, uPanoPos[2], uPanoInv[2], uPanoShare[2], uPanoGain[2], normal, sight, c[2], b[2], s[2], m[2]);
  sampleSlot(uPano3, uLow3, uPanoSharp[3], uDepth3, uPanoPos[3], uPanoInv[3], uPanoShare[3], uPanoGain[3], normal, sight, c[3], b[3], s[3], m[3]);

  // lib/scan-mesh/combine.ts, the same sums.
  float baseSum = 0.0;
  float seenSum = 0.0;
  for (int i = 0; i < ${SLOTS}; i++) {
    baseSum += b[i];
    seenSum += b[i] * s[i];
  }
  float seenFraction = baseSum > 0.0 ? seenSum / baseSum : 0.0;
  float w[${SLOTS}];
  float total = 0.0;
  if (uFill < 0.5) {
    float hidden = uMode > 0.5 ? 0.002 : ${HIDDEN.toExponential()};
    for (int i = 0; i < ${SLOTS}; i++) w[i] = b[i] * (s[i] + hidden);
  } else {
    // A point nobody saw takes the panorama nearest to seeing it, not an average of all of them.
    float score[${SLOTS}];
    float best = -1e30;
    for (int i = 0; i < ${SLOTS}; i++) {
      score[i] = b[i] > 0.0 ? log(b[i]) - m[i] / ${FILL_REACH.toFixed(4)} : -1e30;
      best = max(best, score[i]);
    }
    float fills = 0.0;
    float f[${SLOTS}];
    for (int i = 0; i < ${SLOTS}; i++) {
      f[i] = b[i] > 0.0 ? exp(${FILL_POWER.toFixed(1)} * (score[i] - best)) : 0.0;
      fills += f[i];
    }
    float t = smoothstep(0.0, ${SEEN_FLOOR.toFixed(4)}, seenFraction);
    for (int i = 0; i < ${SLOTS}; i++) {
      float fromSeen = seenSum > 0.0 ? b[i] * s[i] / seenSum : 0.0;
      w[i] = mix(fills > 0.0 ? f[i] / fills : 0.0, fromSeen, t);
    }
  }
  for (int i = 0; i < ${SLOTS}; i++) total += w[i];
  vec3 mean = vec3(0.0);
  float most = 0.0;
  for (int i = 0; i < ${SLOTS}; i++) {
    w[i] = total > 0.0 ? w[i] / total : 0.0;
    mean += c[i] * w[i];
    most = max(most, w[i]);
  }
  float spread = 0.0;
  for (int i = 0; i < ${SLOTS}; i++) spread += w[i] * gap(c[i], mean);
  if (uAgree > 0.5 && most > 0.0) {
    // Where the panoramas disagree, lean on the strongest: one copy of a thing the mesh lacks, not two.
    float power = 1.0 + ${SHARPEN.toFixed(1)} * smoothstep(${AGREE_LOW.toFixed(4)}, ${AGREE_HIGH.toFixed(4)}, spread);
    total = 0.0;
    for (int i = 0; i < ${SLOTS}; i++) {
      w[i] = w[i] > 0.0 ? pow(w[i] / most, power) : 0.0;
      total += w[i];
    }
    for (int i = 0; i < ${SLOTS}; i++) w[i] /= total;
  }
  vec3 projected = vec3(0.0);
  for (int i = 0; i < ${SLOTS}; i++) projected += c[i] * w[i];
#ifndef BACKDROP
  if (uDebug > 1.5) {
    // The doubles: what is left of other pictures (red), and the disagreement before the sharpening (green).
    float ghost = 0.0;
    for (int i = 0; i < ${SLOTS}; i++) ghost += w[i] * gap(c[i], projected);
    gl_FragColor = vec4(clamp(ghost * 4.0, 0.0, 1.0), clamp(spread * 4.0, 0.0, 1.0), 1.0, 1.0);
    return;
  }
  if (uDebug > 0.5) {
    // The coverage: nobody saw it (red), and of those, one came within 30 cm (green); alpha the distance from the eye.
    float unseen = seenFraction < 0.01 ? 1.0 : 0.0;
    float close = 1e9;
    for (int i = 0; i < ${SLOTS}; i++) if (b[i] > 0.0) close = min(close, m[i]);
    gl_FragColor = vec4(unseen, unseen * (close < 0.3 ? 1.0 : 0.0), 1.0, clamp(distance(vWorld, cameraPosition) / 4.0, 0.0, 1.0));
    return;
  }
#endif
  float shares = uPanoShare[0] + uPanoShare[1] + uPanoShare[2] + uPanoShare[3];
  float cover = baseSum > 0.0 ? uProjection * smoothstep(0.0, 0.2, shares) : 0.0;
  if (baseSum <= 0.0) projected = bare;
  gl_FragColor = vec4(mix(bare, projected, cover), 1.0);
}
`;

/**
 * The material for the scan mesh, or (with `backdrop`) for the box behind it
 * that fills the mesh's holes and windows with the panoramas' far view.
 * `blank` is a 1×1 cube bound to every unused slot.
 */
export function createScanMaterial(blank: CubeTexture, backdrop = false): ShaderMaterial {
  const uniforms: Record<string, { value: unknown }> = {
    uPanoPos: { value: Array.from({ length: SLOTS }, () => new Vector3()) },
    uPanoInv: { value: Array.from({ length: SLOTS }, () => new Matrix3()) },
    uPanoShare: { value: new Array<number>(SLOTS).fill(0) },
    uPanoGain: { value: Array.from({ length: SLOTS }, () => new Vector3(1, 1, 1)) },
    uMode: { value: 0 },
    uPanoSharp: { value: new Array<number>(SLOTS).fill(0) },
    uProjection: { value: 1 },
    uDebug: { value: 0 },
    uAgree: { value: 1 },
    uFill: { value: 1 },
  };
  for (let i = 0; i < SLOTS; i++) {
    uniforms[`uPano${i}`] = { value: blank };
    uniforms[`uLow${i}`] = { value: blank };
    uniforms[`uDepth${i}`] = { value: blank };
  }
  return new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: backdrop ? { BACKDROP: "" } : {},
    side: backdrop ? BackSide : DoubleSide,
    depthWrite: !backdrop,
    depthTest: !backdrop,
    toneMapped: false,
  });
}

/** Writes how far each fragment is from `uOrigin` into the red channel: a panorama's depth cube. */
export function createDistanceMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uOrigin: { value: new Vector3() } },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
uniform vec3 uOrigin;
varying vec3 vWorld;
void main() {
  gl_FragColor = vec4(distance(vWorld, uOrigin), 0.0, 0.0, 1.0);
}
`,
    side: DoubleSide,
    toneMapped: false,
  });
}
