// Fills what nothing paints on screen (issue 118): a stand-in surface (a
// closed hole, a plane carried across a gap, a level's floor or ceiling
// plane) where no panorama in use saw it and it has no texture of its own
// yet (photo-material.ts leaves alpha under 1 there). Each such pixel takes
// the colour of the painted pixels nearest it, never void and never grey.
// It is the last resort: the panoramas, then a texture made for the patch
// (lib/scan-mesh/inpaint.ts), come first.
//
// Push-pull: the frame is rendered with alpha 1 where a scanned surface
// drew and 0 elsewhere, then halved again and again, each level averaging
// the colours of its covered pixels (premultiplied by alpha), and rebuilt
// from the coarsest level up, each pixel keeping its own colour as far as it
// is covered and taking the coarser level's for the rest. A covered pixel
// comes out exactly as rendered.
import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from "three";

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Halves a level: the mean of four texels, colour premultiplied. */
const DOWN = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec4 a = texture2D(uSource, vUv + uTexel * vec2(-0.5, -0.5));
  vec4 b = texture2D(uSource, vUv + uTexel * vec2(0.5, -0.5));
  vec4 c = texture2D(uSource, vUv + uTexel * vec2(-0.5, 0.5));
  vec4 d = texture2D(uSource, vUv + uTexel * vec2(0.5, 0.5));
  gl_FragColor = (a + b + c + d) * 0.25;
}
`;

/** A level rebuilt: its own colour where covered, the coarser level's (already whole) for the rest. */
const UP = /* glsl */ `
uniform sampler2D uOwn;
uniform sampler2D uCoarse;
/** 1 at the coarsest level, which has no coarser one: its own colour, unpremultiplied. */
uniform float uTop;
varying vec2 vUv;
void main() {
  vec4 own = texture2D(uOwn, vUv);
  vec3 coarse = texture2D(uCoarse, vUv).rgb;
  vec3 whole = own.a > 1e-4 ? own.rgb / own.a : vec3(0.5);
  vec3 colour = uTop > 0.5 ? whole : own.rgb + (1.0 - clamp(own.a, 0.0, 1.0)) * coarse;
  gl_FragColor = vec4(colour, 1.0);
}
`;

/** Stops halving at this size: a few texels across is enough to have seen something. */
const SMALLEST = 4;

export class HoleFill {
  private frame: WebGLRenderTarget | null = null;
  private down: WebGLRenderTarget[] = [];
  private up: WebGLRenderTarget[] = [];
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad = new Mesh(new PlaneGeometry(2, 2));
  private readonly scene = new Scene();
  private readonly downMaterial = new ShaderMaterial({
    uniforms: { uSource: { value: null }, uTexel: { value: new Vector2() } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: DOWN,
    depthTest: false,
    depthWrite: false,
  });
  private readonly upMaterial = new ShaderMaterial({
    uniforms: { uOwn: { value: null }, uCoarse: { value: null }, uTop: { value: 0 } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: UP,
    depthTest: false,
    depthWrite: false,
  });
  private width = 0;
  private height = 0;

  constructor(private readonly renderer: WebGLRenderer) {
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private target(width: number, height: number, samples = 0): WebGLRenderTarget {
    return new WebGLRenderTarget(width, height, {
      type: samples > 0 ? undefined : HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: samples > 0,
      samples,
    });
  }

  private fit(): void {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const width = Math.max(1, Math.floor(size.x));
    const height = Math.max(1, Math.floor(size.y));
    if (width === this.width && height === this.height && this.frame) return;
    this.release();
    this.width = width;
    this.height = height;
    this.frame = this.target(width, height, 4);
    let w = width;
    let h = height;
    while (w > SMALLEST || h > SMALLEST) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      this.down.push(this.target(w, h));
      this.up.push(this.target(w, h));
    }
  }

  private pass(material: ShaderMaterial, to: WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(to);
    this.renderer.render(this.scene, this.camera);
  }

  /** Draws `scene` to `to` (null: the screen), its uncovered pixels filled. The clear colour's alpha must be 0. */
  render(scene: Scene, camera: Camera, to: WebGLRenderTarget | null): void {
    this.fit();
    const frame = this.frame as WebGLRenderTarget;
    const renderer = this.renderer;
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(frame);
    renderer.clear();
    renderer.render(scene, camera);

    const { down, up, downMaterial, upMaterial } = this;
    let source: Texture = frame.texture;
    let sw = this.width;
    let sh = this.height;
    for (const level of down) {
      downMaterial.uniforms.uSource.value = source;
      downMaterial.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.pass(downMaterial, level);
      source = level.texture;
      sw = level.width;
      sh = level.height;
    }
    for (let i = down.length - 1; i >= 0; i--) {
      upMaterial.uniforms.uOwn.value = down[i].texture;
      upMaterial.uniforms.uCoarse.value = i === down.length - 1 ? down[i].texture : up[i + 1].texture;
      upMaterial.uniforms.uTop.value = i === down.length - 1 ? 1 : 0;
      this.pass(upMaterial, up[i]);
    }
    upMaterial.uniforms.uOwn.value = frame.texture;
    upMaterial.uniforms.uCoarse.value = up.length > 0 ? up[0].texture : frame.texture;
    upMaterial.uniforms.uTop.value = up.length > 0 ? 0 : 1;
    this.pass(upMaterial, to);
    renderer.setRenderTarget(before);
  }

  private release(): void {
    this.frame?.dispose();
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.frame = null;
    this.down = [];
    this.up = [];
  }

  dispose(): void {
    this.release();
    this.quad.geometry.dispose();
    this.downMaterial.dispose();
    this.upMaterial.dispose();
  }
}
