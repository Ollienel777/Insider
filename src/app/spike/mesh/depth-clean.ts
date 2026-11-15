// A panorama's depth cube, made whole before its sphere is pushed out by it
// (issue 118, the imaging A2 experiment).
//
// The scan's mesh is torn where the scanner was thrown off: glass and its
// frosted bands come back as scattered shards, a window or a glass panel
// onto an office no one walked into as a hole onto nothing. Pushed out to
// such a depth, the sphere shatters, and the eye walking past sees the
// shards slide over each other, the room beyond in pieces. So each
// panorama's depth is rendered twice, from the mesh and from the walls'
// sheets (lib/scan-mesh/panes.ts), and the two are made one here: where the
// panorama looked through a gap in a room's wall (a doorway, a glass
// panel), or found nothing at all, the sheet's depth is taken. What it saw
// through the gap then lies on the wall, a picture in its frame, in one
// plane with the frame and the wall round it.
import {
  BackSide,
  DoubleSide,
  BoxGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  RGBAFormat,
  RGFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLCubeRenderTarget,
  type CubeTexture,
  type PerspectiveCamera,
  type Texture,
} from "three";

/** Past this, metres, the mesh's depth found nothing (the far box round it). */
export const FOUND_NOTHING = 60;
/** Mesh this far past a room's wall, metres, is seen through a gap in it. */
const THROUGH = 0.12;

const combineMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { uRaw: { value: null as Texture | null }, uSheets: { value: null as Texture | null }, uOrigin: { value: new Vector3() } },
    vertexShader: /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`,
    fragmentShader: /* glsl */ `
uniform samplerCube uRaw;
uniform samplerCube uSheets;
uniform vec3 uOrigin;
varying vec3 vWorld;
void main() {
  vec3 direction = normalize(vWorld - uOrigin);
  float raw = texture(uRaw, direction).r;
  vec2 sheet = texture(uSheets, direction).rg;
  // Nothing found that way, and a sheet is: the sheet, marked with its kind
  // (green: 1 a room's wall, 0.75 a lower one, 0.5 a floor or a ceiling).
  bool nothing = raw > ${FOUND_NOTHING.toFixed(1)} && sheet.r < ${FOUND_NOTHING.toFixed(1)};
  // Seen through a gap in a room's wall (a doorway, a glass panel): what is
  // beyond lies on the wall, a picture in its frame. The scan's shards of
  // glass and of the room past it then sit in one plane with the frame and
  // the wall round it, and nothing tears.
  bool through = sheet.g > 0.9 && raw > sheet.r + ${THROUGH.toFixed(2)};
  bool use = nothing || through;
  gl_FragColor = vec4(use ? sheet.r : raw, use ? sheet.g : 0.0, 0.0, 1.0);
}
`,
    side: BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

/**
 * A panorama's depth from the mesh and from the walls' sheets
 * (lib/scan-mesh/panes.ts), as one cube: red the depth, green 1 where it is
 * a sheet's because the mesh had nothing there (glass, a window, a gap).
 */
/** A sheet's distance from `uOrigin`, and its kind in green. */
export function createKindMaterial(kind: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uOrigin: { value: new Vector3() } },
    vertexShader: /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`,
    fragmentShader: /* glsl */ `
uniform vec3 uOrigin;
varying vec3 vWorld;
void main() {
  gl_FragColor = vec4(distance(vWorld, uOrigin), ${kind.toFixed(2)}, 0.0, 1.0);
}
`,
    side: DoubleSide,
    toneMapped: false,
  });
}

export class DepthCombiner {
  private readonly scene = new Scene();
  private readonly box: Mesh;
  private readonly material = combineMaterial();

  constructor() {
    this.box = new Mesh(new BoxGeometry(10, 10, 10), this.material);
    this.box.frustumCulled = false;
    this.scene.add(this.box);
  }

  target(size: number, single: boolean): WebGLCubeRenderTarget {
    return new WebGLCubeRenderTarget(size, {
      type: HalfFloatType,
      format: single ? RGFormat : RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
  }

  combine(
    raw: CubeTexture,
    sheets: CubeTexture,
    out: WebGLCubeRenderTarget,
    origin: Vector3,
    camera: PerspectiveCamera,
    faces: (target: WebGLCubeRenderTarget, scene: Scene, camera: PerspectiveCamera) => void,
  ): void {
    this.box.position.copy(origin);
    this.box.updateMatrixWorld();
    this.material.uniforms.uOrigin.value.copy(origin);
    this.material.uniforms.uRaw.value = raw;
    this.material.uniforms.uSheets.value = sheets;
    faces(out, this.scene, camera);
  }

  dispose(): void {
    this.material.dispose();
    this.box.geometry.dispose();
  }
}
