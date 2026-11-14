// The scan mesh's material (issue 118): the picture at each point of the mesh
// comes from the panoramas that can see it.
//
// For up to four panoramas at once, a fragment looks its colour up in that
// panorama's cube map along the line from the panorama to the fragment. Each
// one's say is the product of
//   - its share for where the player stands (lib/scan-mesh/skybox.ts),
//   - how nearly it saw the fragment along the player's own line of sight,
//   - how squarely it faced the surface (a grazing view smears), and
//   - whether it saw the fragment at all: its depth cube holds how far it
//     could see in every direction, and a fragment farther than that is
//     behind something.
// A fragment no panorama saw keeps a trace of each (a wrong picture in the
// right colours reads better than a hole).
//
// Every panorama has a small cube that is always on the GPU, and the nearest
// few have a full-size one as well: a slot shows the small one, and fades to
// the sharp one (`uPanoSharp`) once it has arrived. With no panorama loaded, or with
// projection switched off, the mesh shows bare: shaded from its face normals,
// since the scan's mesh carries no texture coordinates.
//
// Colours are passed through untouched: the panorama texels are display
// values, the output is display values, and nothing is lit.
import { BackSide, DoubleSide, Matrix3, ShaderMaterial, Vector3, type CubeTexture } from "three";

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
varying vec3 vWorld;

vec4 fromPano(samplerCube pano, samplerCube low, float sharp, samplerCube depth, vec3 origin, mat3 toPano, float share, vec3 normal, vec3 sight) {
  if (share <= 0.0) return vec4(0.0);
#ifdef BACKDROP
  vec3 ray = sight;
  float weight = share;
#else
  vec3 ray = vWorld - origin;
  float reach = length(ray);
  vec3 along = ray / max(reach, 1e-4);
  float seenTo = textureCube(depth, ray).r;
  float limit = seenTo * 1.03 + 0.08;
  float seen = 1.0 - smoothstep(limit, limit + 0.25, reach);
  float aligned = max(dot(sight, along), 0.0);
  float facing = smoothstep(0.02, 0.3, dot(normal, -along));
  float weight = share * (0.03 + pow(aligned, 4.0)) * (0.1 + 0.9 * facing) * (seen + 0.003);
  if (uDebug > 0.5) return vec4(vec3(abs(seenTo - reach) * 2.0, seen, 0.0) * share, share);
#endif
  vec3 lookup = toPano * ray;
  vec3 colour = sharp >= 1.0 ? textureCube(pano, lookup).rgb
    : sharp <= 0.0 ? textureCube(low, lookup).rgb
    : mix(textureCube(low, lookup).rgb, textureCube(pano, lookup).rgb, sharp);
  return vec4(colour * weight, weight);
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
  vec4 sum = vec4(0.0);
  sum += fromPano(uPano0, uLow0, uPanoSharp[0], uDepth0, uPanoPos[0], uPanoInv[0], uPanoShare[0], normal, sight);
  sum += fromPano(uPano1, uLow1, uPanoSharp[1], uDepth1, uPanoPos[1], uPanoInv[1], uPanoShare[1], normal, sight);
  sum += fromPano(uPano2, uLow2, uPanoSharp[2], uDepth2, uPanoPos[2], uPanoInv[2], uPanoShare[2], normal, sight);
  sum += fromPano(uPano3, uLow3, uPanoSharp[3], uDepth3, uPanoPos[3], uPanoInv[3], uPanoShare[3], normal, sight);
  float shares = min(1.0, uPanoShare[0] + uPanoShare[1] + uPanoShare[2] + uPanoShare[3]);
  float cover = sum.a > 0.0 ? uProjection * shares : 0.0;
  vec3 projected = sum.a > 0.0 ? sum.rgb / sum.a : bare;
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
    uPanoSharp: { value: new Array<number>(SLOTS).fill(0) },
    uProjection: { value: 1 },
    uDebug: { value: 0 },
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
