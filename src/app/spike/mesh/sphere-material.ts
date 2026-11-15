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
import { DoubleSide, ShaderMaterial, Vector3, type IUniform } from "three";
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
/** Across the sphere toward the far side of a jump in depth. */
varying vec3 vFar;
/** 1 where the depth is a wall's sheet standing in for glass (depth-clean.ts's green). */
varying float vGlass;

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
  // Toward the far side: the depth's slope across the nine samples (before they are sorted).
  float gx = (s[2] + s[5] + s[8]) - (s[0] + s[3] + s[6]);
  float gy = (s[6] + s[7] + s[8]) - (s[0] + s[1] + s[2]);
  vFar = across * gx + up * gy;
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
  vGlass = texture(uDepth${slot}, direction).g;
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
uniform vec3 uPanoPos[4];
uniform float uPanoSharp[4];
uniform float uPanoShare[4];
uniform samplerCube uPano${slot};
uniform samplerCube uLow${slot};
uniform samplerCube uTiny${slot};
uniform samplerCube uTiny${1 - slot};
uniform samplerCube uDepth${1 - slot};
/** 1 to even out the two panoramas' light where they meet. */
uniform float uMatch;
/** How much of the sphere is drawn: 1 all of it, less a screen of its pixels (the lead coming in). */
uniform float uSolid;
varying vec3 vDirection;
varying vec3 vWorld;
varying float vJump;
varying float vDepth;
varying vec3 vFar;
varying float vGlass;
/** 1: the skin across a jump is drawn, far back, in the colour of the jump's far side; 0: it is left out. */
uniform float uSkinFill;
uniform float uBehind;
/** For debugging: a tint on this sphere's surface, and on its skins. */
uniform vec3 uTint;
uniform vec3 uSkinTint;
uniform float uGlassDebug;

void main() {
  // The skin across a jump in depth: at an edge, and lying along the panorama's own line of sight.
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  bool skin = vJump > ${JUMP.toFixed(2)} && abs(dot(normal, normalize(vDirection))) < ${SKIN.toFixed(2)};
  if (skin && uSkinFill < 0.5) discard;
  // What the eye sees there was hidden from this panorama: the other one's
  // surface, where it has one, is in front of it (the skin is drawn at the
  // back of the depth range); else the far side carried across the gap, which
  // reads as the room beyond going on, not as a shard of the wall in front.
  gl_FragDepth = skin ? (uBehind > 0.5 ? 0.99995 : 0.9999) : gl_FragCoord.z;
  vec3 seenDirection = vDirection;
  if (skin) {
    float far = length(vFar);
    if (far > 1e-5) seenDirection = normalize(vDirection + (vFar / far) * ${(DEPTH_STEP * 3).toFixed(4)});
  }
  // Where the depth found nothing (a hole in the mesh, a window) there is no surface to draw: what is behind shows.
  if (vDepth > ${(0.97).toFixed(2)} * ${DEPTH_FAR.toFixed(1)}) discard;
  if (uSolid < 1.0) {
    float grain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (grain > uSolid) discard;
  }
  vec3 lookup = uPanoInv[${slot}] * seenDirection;
  float sharp = uPanoSharp[${slot}];
  vec3 colour = sharp >= 1.0 ? textureCube(uPano${slot}, lookup).rgb
    : sharp <= 0.0 ? textureCube(uLow${slot}, lookup).rgb
    : mix(textureCube(uLow${slot}, lookup).rgb, textureCube(uPano${slot}, lookup).rgb, sharp);
  colour *= uPanoGain[${slot}];
  // Glass: what the panorama saw through it lies on the pane, a little
  // tinted, with a sheen that grows as the pane is seen edge on.
  // A floor or a ceiling the scan has a gap in (green 0.5): tiles, in the light round them.
  float level = smoothstep(0.3, 0.45, vGlass) * (1.0 - smoothstep(0.6, 0.75, vGlass));
  if (level > 0.01 && abs(normal.y) > 0.8 && vWorld.y > cameraPosition.y + 0.3) {
    vec3 tile = textureCube(uTiny${slot}, lookup).rgb * uPanoGain[${slot}];
    float l = dot(tile, vec3(0.333));
    vec3 base = vec3(0.86, 0.86, 0.84) * clamp(l / 0.8, 0.7, 1.15);
    vec2 g = abs(fract(vWorld.xz / 0.61) - 0.5);
    float seam = 1.0 - smoothstep(0.47, 0.49, max(g.x, g.y));
    vec3 ceiling = base * mix(0.72, 1.0, seam);
    colour = mix(colour, ceiling, level);
  }
  if (vGlass > 0.7) {
    float pane = smoothstep(0.75, 0.98, vGlass);
    vec3 toEye = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normal, toEye));
    float fresnel = 0.02 + 0.45 * pow(1.0 - facing, 5.0);
    float streak = 0.5 + 0.5 * sin(dot(vWorld, vec3(1.9, 2.6, 1.9)) * 2.2);
    vec3 sky = vec3(0.88, 0.92, 0.95);
    vec3 glassy = colour * vec3(0.95, 0.985, 0.99) * (1.0 - fresnel) + sky * (fresnel + 0.03 * streak * streak);
    colour = mix(colour, glassy, pane);
  }
  // The light, not the detail, is shared with the other panorama by how far
  // along the eye is from one to the other: its own light is swapped for the
  // two's blend (each from its tiny cube, so only the broad brightness and
  // colour move), where the other saw this point too. Both spheres aim at the
  // same blend, so when the lead changes the light does not.
  float other = uPanoShare[${1 - slot}];
  float mine = uPanoShare[${slot}];
  if (uMatch > 0.5 && other > 0.002) {
    vec3 own = textureCube(uTiny${slot}, lookup).rgb * uPanoGain[${slot}];
    vec3 toOther = vWorld - uPanoPos[${1 - slot}];
    float reach = length(toOther);
    float seen = textureCube(uDepth${1 - slot}, toOther / max(reach, 1e-4)).r;
    float sees = smoothstep(0.82, 0.92, seen / max(reach, 1e-3));
    vec3 theirs = textureCube(uTiny${1 - slot}, uPanoInv[${1 - slot}] * (toOther / max(reach, 1e-4))).rgb * uPanoGain[${1 - slot}];
    float t = sees * other / max(other + mine, 1e-4);
    vec3 target = mix(own, theirs, t);
    vec3 ratio = clamp((target + 0.02) / (own + 0.02), vec3(0.6), vec3(1.6));
    colour *= ratio;
  }
  if (uGlassDebug > 0.5) colour = mix(colour, vec3(1.0, 0.0, 1.0), 0.6 * vGlass);
  gl_FragColor = vec4(colour * (skin ? uSkinTint : uTint), 1.0);
}
`;

/**
 * The material for the sphere of the panorama in the store's slot `slot`
 * (0 or 1), on the store's shared uniforms. Solid, with depth. `uBehind`
 * (0 or 1) says whether it is the one behind the lead this frame, and
 * `uSolid` how far in the lead has come.
 */
export function createSphereMaterial(panos: PhotoUniforms, slot: 0 | 1): ShaderMaterial {
  const uniforms: Record<string, IUniform> = { ...panos, uBehind: { value: 0 }, uSolid: { value: 1 }, uMatch: { value: 1 }, uSkinFill: { value: 0 }, uTint: { value: new Vector3(1, 1, 1) }, uSkinTint: { value: new Vector3(1, 1, 1) }, uGlassDebug: { value: 0 } };
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
