// The scan's picture as one photograph (issue 118): every surface is
// painted from the panorama the eye is nearest, where that panorama saw it;
// where it did not, from the next in line that did; and only where none of
// them saw it, from the surface's own texture. lib/scan-mesh/photo.ts has
// the rule and its reasons, the same sums as the shader here.
//
// Three surfaces share it:
//   - the textured mesh: its fallback is the Matterpak's texture;
//   - a stand-in (a closed hole, a plane carried across a gap, a level's
//     floor or ceiling plane): its fallback is a texture made for it where
//     there is one, else nothing: alpha says how much was painted, and
//     hole-fill.ts fills the rest;
//   - the backdrop, the box behind everything: the panoramas' far view, so
//     a window shows what the camera saw through it.
//
// The panoramas' uniforms are one set, shared by every material made here:
// the store writes them once a frame.
import { BackSide, DoubleSide, Matrix3, ShaderMaterial, Vector3, type CubeTexture, type IUniform, type Texture } from "three";
import { DEPTH_SCALE, DEPTH_SLACK, DEPTH_SOFT, GRAZE_FULL, GRAZE_NONE, PRIORITY } from "@/lib/scan-mesh/photo";
import { SLOTS } from "./projection";

export type PhotoUniforms = Record<string, IUniform>;

/** The panoramas' uniforms, to share between materials. `blank` is a 1×1 cube bound to every unused slot. */
export function createPhotoUniforms(blank: CubeTexture): PhotoUniforms {
  const uniforms: PhotoUniforms = {
    uPanoPos: { value: Array.from({ length: SLOTS }, () => new Vector3()) },
    uPanoInv: { value: Array.from({ length: SLOTS }, () => new Matrix3()) },
    uPanoShare: { value: new Array<number>(SLOTS).fill(0) },
    uPanoGain: { value: Array.from({ length: SLOTS }, () => new Vector3(1, 1, 1)) },
    uPanoSharp: { value: new Array<number>(SLOTS).fill(0) },
    uPanoOn: { value: new Array<number>(SLOTS).fill(0) },
    uMode: { value: 0 },
    uProjection: { value: 1 },
    uDebug: { value: 0 },
  };
  for (let i = 0; i < SLOTS; i++) {
    uniforms[`uPano${i}`] = { value: blank };
    uniforms[`uLow${i}`] = { value: blank };
    uniforms[`uDepth${i}`] = { value: blank };
  }
  return uniforms;
}

const VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
#ifdef HAS_UV
  vUv = uv;
#else
  vUv = vec2(0.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const f = (value: number) => (Number.isInteger(value) ? value.toFixed(1) : String(value));

const FRAGMENT = /* glsl */ `
uniform vec3 uPanoPos[${SLOTS}];
uniform mat3 uPanoInv[${SLOTS}];
uniform float uPanoShare[${SLOTS}];
uniform vec3 uPanoGain[${SLOTS}];
uniform float uPanoSharp[${SLOTS}];
/** How much the eye stands on each panorama's own position (photo.ts's standingOn). */
uniform float uPanoOn[${SLOTS}];
uniform samplerCube uPano0;
uniform samplerCube uPano1;
uniform samplerCube uPano2;
uniform samplerCube uPano3;
uniform samplerCube uLow0;
uniform samplerCube uLow1;
uniform samplerCube uLow2;
uniform samplerCube uLow3;
uniform samplerCube uDepth0;
uniform samplerCube uDepth1;
uniform samplerCube uDepth2;
uniform samplerCube uDepth3;
uniform float uProjection;
uniform float uDebug;
#ifndef BACKDROP
uniform sampler2D uMap;
/** 1 when uMap is this surface's own texture; 0 for a stand-in with none. */
uniform float uHasMap;
#endif
varying vec3 vWorld;
varying vec2 vUv;

void slot(samplerCube pano, samplerCube low, float sharp, samplerCube depth, vec3 origin, mat3 toPano, float share, vec3 gain, float on, vec3 normal, vec3 sight, inout vec3 sum, inout float total, inout float cover) {
  if (share <= 0.0) return;
  // Painted already, and this one's part would not show.
  if (cover >= 0.999 && share < 0.02 * total) return;
#ifdef BACKDROP
  vec3 ray = sight;
  float usable = 1.0;
#else
  vec3 ray = vWorld - origin;
  float reach = length(ray);
  vec3 along = ray / max(reach, 1e-4);
  // The panorama's own depth: a point farther than it saw that way is behind something.
  float limit = textureCube(depth, ray).r * ${f(DEPTH_SCALE)} + ${f(DEPTH_SLACK)};
  float seen = 1.0 - smoothstep(limit, limit + ${f(DEPTH_SOFT)}, reach);
  float graze = smoothstep(${f(GRAZE_NONE)}, ${f(GRAZE_FULL)}, dot(normal, -along));
  float usable = max(seen * graze, on);
  if (usable <= 0.0) return;
#endif
  vec3 lookup = toPano * ray;
  vec3 colour = sharp >= 1.0 ? textureCube(pano, lookup).rgb
    : sharp <= 0.0 ? textureCube(low, lookup).rgb
    : mix(textureCube(low, lookup).rgb, textureCube(pano, lookup).rgb, sharp);
  float w = share * usable;
  sum += colour * gain * w;
  total += w;
  cover += usable * min(1.0, share / ${PRIORITY[PRIORITY.length - 1].toExponential()});
}

void main() {
  vec3 sight = normalize(vWorld - cameraPosition);
#ifdef BACKDROP
  vec3 normal = -sight;
#else
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(normal, sight) > 0.0) normal = -normal;
#endif
  vec3 sum = vec3(0.0);
  float total = 0.0;
  float cover = 0.0;
  slot(uPano0, uLow0, uPanoSharp[0], uDepth0, uPanoPos[0], uPanoInv[0], uPanoShare[0], uPanoGain[0], uPanoOn[0], normal, sight, sum, total, cover);
  slot(uPano1, uLow1, uPanoSharp[1], uDepth1, uPanoPos[1], uPanoInv[1], uPanoShare[1], uPanoGain[1], uPanoOn[1], normal, sight, sum, total, cover);
  slot(uPano2, uLow2, uPanoSharp[2], uDepth2, uPanoPos[2], uPanoInv[2], uPanoShare[2], uPanoGain[2], uPanoOn[2], normal, sight, sum, total, cover);
  slot(uPano3, uLow3, uPanoSharp[3], uDepth3, uPanoPos[3], uPanoInv[3], uPanoShare[3], uPanoGain[3], uPanoOn[3], normal, sight, sum, total, cover);
  vec3 photo = total > 0.0 ? sum / total : vec3(0.0);
  cover = min(1.0, cover) * uProjection;
#ifdef BACKDROP
  vec3 sky = mix(vec3(0.027, 0.035, 0.047), vec3(0.067, 0.086, 0.114), smoothstep(-0.2, 0.6, sight.y));
  gl_FragColor = vec4(mix(sky, photo, cover), 1.0);
#else
  vec3 own = texture2D(uMap, vUv).rgb;
#ifdef STANDIN
  if (uDebug > 2.5) {
    // The sources: the panoramas (red), a texture made for the stand-in (green); blue marks a stand-in.
    gl_FragColor = vec4(cover, (1.0 - cover) * uHasMap, 1.0, 1.0);
    return;
  }
  // Alpha is how much was painted; hole-fill.ts fills the rest.
  float painted = cover + (1.0 - cover) * uHasMap;
  gl_FragColor = vec4(photo * cover + own * (1.0 - cover) * uHasMap, painted);
#else
  if (uDebug > 2.5) {
    // The sources: the panoramas (red), the mesh's own texture (green).
    gl_FragColor = vec4(cover, 1.0 - cover, 0.0, 1.0);
    return;
  }
  gl_FragColor = vec4(mix(own, photo, cover), 1.0);
#endif
#endif
}
`;

export type PhotoSurface = "mesh" | "stand-in" | "backdrop";

/**
 * A material that paints `surface` by the photo rule, on the shared
 * `panos` uniforms. `map` is the surface's own texture (a stand-in may have
 * none). Stand-ins draw just behind the scanned surfaces where the two meet.
 */
export function createPhotoMaterial(panos: PhotoUniforms, surface: PhotoSurface, map: Texture | null = null): ShaderMaterial {
  const uniforms: PhotoUniforms = { ...panos };
  const defines: Record<string, string> = {};
  if (surface === "backdrop") defines.BACKDROP = "";
  else {
    uniforms.uMap = { value: map };
    uniforms.uHasMap = { value: map ? 1 : 0 };
    defines.HAS_UV = "";
    if (surface === "stand-in") defines.STANDIN = "";
  }
  const standIn = surface === "stand-in";
  return new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines,
    side: surface === "backdrop" ? BackSide : DoubleSide,
    depthWrite: surface !== "backdrop",
    depthTest: surface !== "backdrop",
    toneMapped: false,
    polygonOffset: standIn,
    polygonOffsetFactor: standIn ? 1 : 0,
    polygonOffsetUnits: standIn ? 4 : 0,
  });
}
