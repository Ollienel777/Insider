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
// depth. The sphere is one unbroken sheet. Where the depth jumps (the edge
// of a desk against the floor behind it) the sheet stretches between the two
// rather than tearing, and nothing shatters.
//
// The depth is smoothed where it is read, a vertex at a time: nine samples
// round the vertex's direction, their median (which a stray spike or a hole
// in the mesh cannot move), then the mean of the samples near that median
// (which keeps a wall flat and an edge where it is).
//
// Slot 0 of the store's panoramas is the one the eye is nearest; slot 1 is
// the one it is coming from or going to, drawn over it at `uFade` while the
// two change places.
import { CustomBlending, DoubleSide, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, SrcAlphaFactor, type IUniform } from "three";
import type { PhotoUniforms } from "./photo-material";

/** The angle between a vertex's depth samples, radians: about a degree, the sphere's own grid. */
export const DEPTH_STEP = 0.018;
/** Depths are held to this range, metres: a hole in the mesh reads as far, not as two kilometres. */
export const DEPTH_NEAR = 0.25;
export const DEPTH_FAR = 40;

const vertex = (slot: number) => /* glsl */ `
uniform vec3 uPanoPos[4];
uniform samplerCube uDepth${slot};
varying vec3 vDirection;

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
  vec4 world = vec4(uPanoPos[${slot}] + direction * depth, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = (slot: number) => /* glsl */ `
uniform mat3 uPanoInv[4];
uniform vec3 uPanoGain[4];
uniform float uPanoSharp[4];
uniform samplerCube uPano${slot};
uniform samplerCube uLow${slot};
uniform float uFade;
varying vec3 vDirection;

void main() {
  vec3 lookup = uPanoInv[${slot}] * vDirection;
  float sharp = uPanoSharp[${slot}];
  vec3 colour = sharp >= 1.0 ? textureCube(uPano${slot}, lookup).rgb
    : sharp <= 0.0 ? textureCube(uLow${slot}, lookup).rgb
    : mix(textureCube(uLow${slot}, lookup).rgb, textureCube(uPano${slot}, lookup).rgb, sharp);
  gl_FragColor = vec4(colour * uPanoGain[${slot}], uFade);
}
`;

export type SpherePart = "lead" | "other-depth" | "other";

/**
 * The material for a panorama's sphere, on the store's shared uniforms.
 * "lead" is slot 0, opaque. Slot 1 is drawn in two steps: "other-depth"
 * lays down its depth alone, then "other" its colour over the lead at
 * `uFade`, only where it is the nearest of its own surfaces, so each pixel
 * is blended once.
 */
export function createSphereMaterial(panos: PhotoUniforms, part: SpherePart): ShaderMaterial {
  const slot = part === "lead" ? 0 : 1;
  const uniforms: Record<string, IUniform> = { ...panos, uFade: { value: 1 } };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: vertex(slot),
    fragmentShader: fragment(slot),
    side: DoubleSide,
    toneMapped: false,
    depthTest: true,
    depthWrite: part !== "other",
    colorWrite: part !== "other-depth",
  });
  if (part === "other") {
    // Blended, but drawn with the solid things and before the game's own: not sorted in with what is see-through.
    material.blending = CustomBlending;
    material.blendSrc = SrcAlphaFactor;
    material.blendDst = OneMinusSrcAlphaFactor;
    // The frame's alpha stays 1: it says a pixel was painted (hole-fill.ts).
    material.blendSrcAlpha = OneFactor;
    material.blendDstAlpha = OneFactor;
  }
  return material;
}
