// A panorama drawn as its own photograph with depth (issue 118).
//
// The scan's mesh is too broken to paint photographs onto: glass, thin
// partitions and furniture come out torn, and a torn surface is torn
// whatever is painted on it. So the mesh is not drawn. Each panorama is a
// sphere centred where it was taken (lib/scan-mesh/cube-sphere.ts), its
// colour looked up along each vertex's direction, so from the scan position
// it is exactly the photograph. Each vertex is pushed out along its
// direction to as far as the panorama saw that way (its depth cube,
// rendered from the mesh), so a step away from the scan position things
// shift against each other as they should: the photograph warped by its own
// depth. The sphere is one unbroken sheet, and nothing in it shatters. Where
// the depth jumps (a door's edge against the room behind it) the sheet
// between the two is a surface that was never there, a skin stretched along
// the panorama's own line of sight; seen from the side it would be a wall
// across the doorway. That skin alone is left out: the other panorama, or
// the far view behind everything, shows through.
//
// The depth is smoothed where it is read, a vertex at a time: nine samples
// round the vertex's direction, their median (which a stray spike or a hole
// in the mesh cannot move), then the mean of the samples near that median
// (which keeps a wall flat and an edge where it is).
//
// Two spheres are drawn, both solid: the lead's, and behind it the other
// of the two panoramas the eye is between. Nothing is blended (two
// photographs laid over each other read as a double exposure). The other
// sphere is set a little farther from the eye than it is, so wherever both
// have a surface the lead's is the one seen, and the other shows only
// through what the lead leaves out: its skins, and the directions where
// its depth found nothing. Behind both is the mesh itself, so no gap ever
// shows nothing. When the lead changes, the new one comes in over a few
// frames as a fine screen of pixels (`uSolid`) rather than at a stroke.
import { DoubleSide, ShaderMaterial, type IUniform } from "three";
import type { PhotoUniforms } from "./photo-material";

/** The angle between a vertex's depth samples, radians: about a degree, the sphere's own grid. */
export const DEPTH_STEP = 0.018;
/** A vertex whose depth samples span more than this ratio, nearest to farthest, is at an edge... */
export const JUMP = 1.6;
/** ...and a surface there that the panorama looks along at less than this cosine is the skin across the jump, not a thing. */
export const SKIN = 0.15;
/** Depths are held to this range, metres: a hole in the mesh reads as far, not as two kilometres. */
export const DEPTH_NEAR = 0.25;
export const DEPTH_FAR = 40;
/** The sphere behind the lead is drawn this much farther from the eye than it is: a part of its distance, and metres. */
export const BEHIND_PART = 0.05;
export const BEHIND = 0.08;

const vertex = (slot: number) => /* glsl */ `
uniform vec3 uPanoPos[4];
uniform samplerCube uDepth${slot};
/** 1 for the sphere behind the lead. */
uniform float uBehind;
varying vec3 vDirection;
varying float vDepth;
varying vec3 vWorld;
varying float vJump;

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
      s[j * 3 + i] = depthAt(direction + (across * float(i - 1) + up * float(j - 1)) * ${DEPTH_STEP.toFixed(4)});
    }
  }
  float own = s[4];
  float least = s[0];
  float most = s[0];
  for (int k = 1; k < 9; k++) {
    least = min(least, s[k]);
    most = max(most, s[k]);
  }
  vJump = most / least;
  // The median: sorted, the middle one.
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
  // The mean of the samples near it: smooth along a surface, not across an edge.
  float sum = 0.0;
  float count = 0.0;
  for (int k = 0; k < 9; k++) {
    float w = 1.0 - smoothstep(0.04, 0.12, abs(s[k] - median) / median);
    sum += s[k] * w;
    count += w;
  }
  float depth = count > 0.0 ? sum / count : median;
  // A vertex whose own sample is with the median keeps a share of it: detail survives where the depth is steady.
  depth = mix(depth, own, 0.35 * (1.0 - smoothstep(0.02, 0.08, abs(own - median) / median)));
  vDepth = depth;
  vec4 world = vec4(uPanoPos[${slot}] + direction * depth, 1.0);
  vWorld = world.xyz;
  // Behind the lead: farther along the eye's own line to it, so it lands on the same pixel.
  vec3 fromEye = world.xyz - cameraPosition;
  world.xyz += uBehind * fromEye * (${BEHIND_PART.toFixed(2)} + ${BEHIND.toFixed(2)} / max(length(fromEye), 0.1));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = (slot: number) => /* glsl */ `
uniform mat3 uPanoInv[4];
uniform vec3 uPanoGain[4];
uniform float uPanoSharp[4];
uniform samplerCube uPano${slot};
uniform samplerCube uLow${slot};
/** How much of the sphere is drawn: 1 all of it, less a screen of its pixels (the lead coming in). */
uniform float uSolid;
varying vec3 vDirection;
varying vec3 vWorld;
varying float vJump;
varying float vDepth;

void main() {
  // The skin across a jump in depth: at an edge, and lying along the panorama's own line of sight.
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (vJump > ${JUMP.toFixed(2)} && abs(dot(normal, normalize(vDirection))) < ${SKIN.toFixed(2)}) discard;
  // Where the depth found nothing (a hole in the mesh, a window) there is no surface to draw: what is behind shows.
  if (vDepth > ${(0.97).toFixed(2)} * ${DEPTH_FAR.toFixed(1)}) discard;
  if (uSolid < 1.0) {
    float grain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (grain > uSolid) discard;
  }
  vec3 lookup = uPanoInv[${slot}] * vDirection;
  float sharp = uPanoSharp[${slot}];
  vec3 colour = sharp >= 1.0 ? textureCube(uPano${slot}, lookup).rgb
    : sharp <= 0.0 ? textureCube(uLow${slot}, lookup).rgb
    : mix(textureCube(uLow${slot}, lookup).rgb, textureCube(uPano${slot}, lookup).rgb, sharp);
  gl_FragColor = vec4(colour * uPanoGain[${slot}], 1.0);
}
`;

/**
 * The material for the sphere of the panorama in the store's slot `slot`
 * (0 or 1), on the store's shared uniforms. Solid, with depth. `uBehind`
 * (0 or 1) says whether it is the one behind the lead this frame, and
 * `uSolid` how far in the lead has come.
 */
export function createSphereMaterial(panos: PhotoUniforms, slot: 0 | 1): ShaderMaterial {
  const uniforms: Record<string, IUniform> = { ...panos, uBehind: { value: 0 }, uSolid: { value: 1 } };
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
