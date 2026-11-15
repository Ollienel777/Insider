// The clean view's materials (issue 118): the scan drawn from the
// Matterpak's own textures alone, no panorama projected onto it, so nothing
// swims, ghosts or doubles as the eye moves. A little shading keeps it from
// looking flat: the occlusion baked into each corner (lib/scan-mesh/
// occlusion.ts) darkens corners and the space under furniture, and a soft
// light from above tells walls, floor and ceiling apart.
import { BackSide, DoubleSide, ShaderMaterial, type Texture } from "three";

const VERTEX = /* glsl */ `
attribute float occlusion;
varying vec3 vWorld;
varying vec2 vUv;
varying float vShut;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
#ifdef HAS_UV
  vUv = uv;
#else
  vUv = vec2(0.0);
#endif
#ifdef HAS_OCCLUSION
  vShut = occlusion;
#else
  vShut = 0.0;
#endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3 uBase;
uniform float uDebug;
uniform float uShade;
varying vec3 vWorld;
varying vec2 vUv;
varying float vShut;
void main() {
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 sight = normalize(vWorld - cameraPosition);
  if (dot(normal, sight) > 0.0) normal = -normal;
#ifdef STANDIN
  vec4 texel = texture2D(uMap, vUv);
  float has = uHasMap * step(0.02, texel.a);
  vec3 own = texel.rgb / max(texel.a, 0.02);
  if (uDebug > 2.5) { gl_FragColor = vec4(0.0, has, 1.0, 1.0); return; }
  float alpha = has;
#else
  vec3 own = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : uBase;
  if (uDebug > 2.5) { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); return; }
  float alpha = 1.0;
#endif
  // A soft light from above and to one side: floors brightest, ceilings a little darker, walls by which way they face.
  float light = 0.9 + 0.1 * dot(normal, normalize(vec3(0.35, 0.8, 0.5)));
  float shut = smoothstep(0.0, 0.75, vShut);
  float ao = 1.0 - uShade * shut;
  gl_FragColor = vec4(own * light * ao, alpha);
}
`;

/**
 * A textured surface of the scan, or one with no texture yet (drawn in a
 * plain light grey, never black). A stand-in (a patch, a fan, a level's
 * plane) writes alpha 0 where it has no texture of its own, for hole-fill.ts
 * to fill from the pixels round it.
 */
export function createCleanMaterial(map: Texture | null, surface: "mesh" | "stand-in" = "mesh", behind = 1): ShaderMaterial {
  const standIn = surface === "stand-in";
  // The occlusion attribute comes with the repair; until then the corners read 0, open.
  const defines: Record<string, string> = { HAS_UV: "", HAS_OCCLUSION: "" };
  if (standIn) defines.STANDIN = "";
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
      uBase: { value: [0.62, 0.61, 0.58] },
      uShade: { value: 0.5 },
      uDebug: { value: 0 },
      // Kept so the view's looks (setProjection, setFixes) find what they set.
      uProjection: { value: 0 },
      uAgree: { value: 1 },
      uFill: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines,
    side: DoubleSide,
    toneMapped: false,
    polygonOffset: standIn,
    polygonOffsetFactor: standIn ? behind : 0,
    polygonOffsetUnits: standIn ? 4 * behind : 0,
  });
}

/** Behind everything: a pale overcast daylight, what an opening such as a window shows in the clean view. */
export function createCleanBackdrop(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uDebug: { value: 0 } },
    vertexShader: /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
    fragmentShader: /* glsl */ `
varying vec3 vWorld;
void main() {
  vec3 sight = normalize(vWorld - cameraPosition);
  vec3 low = vec3(0.74, 0.76, 0.78);
  vec3 high = vec3(0.86, 0.9, 0.95);
  gl_FragColor = vec4(mix(low, high, smoothstep(-0.2, 0.6, sight.y)), 1.0);
}`,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
}
