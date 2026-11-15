// A live scan's plan (scan-plan.ts) dressed from its own photographs (issue
// 118). Walls are flat and of one colour, so each room's walls are drawn in
// one flat colour, the one its photographs agree on; floors likewise, with a
// carpet's grain; the ceiling one colour under a drop ceiling's grid. Over the
// flat colour go the photographs' sharp details, as decals: a door, a board, a
// window, a cupboard, a sign, where a panorama saw it near and head-on (under
// 45 degrees and 4 m) and it differs plainly from the wall's colour. Each texel
// of a decal comes from one panorama only, so nothing doubles; where none saw
// it well, the flat colour stays, so nothing is smeared.
//
// Asking the photographs, per texel of an atlas over every surface:
// - Each panorama's depth cube (how far it sees in every direction, against
//   these same surfaces) says whether it sees the texel at all.
// - Of those that do, near enough and head-on enough, the best wins outright
//   (the "best" pass keeps the best score per texel; the paint pass takes the
//   panorama whose score is it).
// - The floor right under a panorama, where its tripod stood, is left out.
// Each surface's flat colour is the median of what its texels saw, which
// leaves a door, a sign or a board out of its wall's colour.
//
// The panoramas are fetched by this tab from the scan CDN, decoded, asked and
// let go one by one. Nothing is stored anywhere.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CubeTexture,
  CustomBlending,
  DataUtils,
  DoubleSide,
  Group,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  MaxEquation,
  Mesh,
  NearestFilter,
  NoColorSpace,
  NoBlending,
  OneFactor,
  OrthographicCamera,
  PerspectiveCamera,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  AddEquation,
  Matrix3,
  type WebGLRenderer,
} from "three";
import { conjugate, quatToMat3, type Quat, type Vec3 } from "@/lib/scan-mesh/coords";
import { isAllowedAssetUrl } from "@/lib/scan-mesh/manifest";
import { alignToCube, CUBE_LOOKUP_FLIP } from "@/lib/scan-mesh/skybox";
import type { Vec } from "./ground";
import { nearestOn } from "./motion";
import { fromCellFrame, onPlanFloor, PLAN, type ScanPlan } from "./scan-plan";

/** Every number the painting is tuned by. */
export const PHOTO = Object.freeze({
  /** The atlas's side, texels. */
  atlasPx: 4096,
  /** The finest a wall's or a piece of furniture's texel goes, metres; coarser when the building will not fit. */
  texelM: 0.02,
  /** A floor's or ceiling's texel, to the walls': they are only asked their colour. */
  flatScale: 5,
  /** Texels round each surface's patch, painted too, so a lookup at its edge never reaches a neighbour's. */
  gutterPx: 2,
  /** The floor and ceiling are painted in tiles this big. */
  tileM: 4,
  /** How sharply a panorama's share falls as its score falls below the best: higher, crisper, more seams. */
  sharpness: 60,
  /** A depth cube's face, pixels. */
  depthPx: 256,
  /** Panoramas fetched at once. */
  fetches: 12,
  /** The ceiling's tiles, metres: a drop ceiling's two feet. */
  ceilingTileM: 0.61,
});

export interface PhotoPano {
  position: Vec3;
  rotation: Quat;
  faces: string[];
}

interface Surface {
  o: Vector3;
  u: Vector3;
  v: Vector3;
  n: Vector3;
  w: number;
  h: number;
  kind: "floor" | "ceiling" | "wall" | "furniture";
  /** The piece of furniture it belongs to, or -1. */
  piece: number;
  /** Where its patch sits in the atlas, texels, without the gutter. */
  x: number;
  y: number;
  pw: number;
  ph: number;
}

/** Until the photographs say otherwise: an office's carpet, ceiling tile, white wall and desk. */
const FALLBACK: Record<Surface["kind"], [number, number, number]> = {
  floor: [0.55, 0.53, 0.5],
  ceiling: [0.88, 0.88, 0.86],
  wall: [0.86, 0.85, 0.83],
  furniture: [0.6, 0.56, 0.5],
};

const CUBE_CAMERAS: readonly [Vector3, Vector3][] = [
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0)],
  [new Vector3(0, 1, 0), new Vector3(0, 0, 1)],
  [new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0)],
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
];

const BAKE_VERTEX = /* glsl */ `
attribute vec2 atlas;
attribute vec3 bakeNormal;
attribute vec3 fallback;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vFallback;
varying vec2 vAtlas;
void main() {
  vWorld = position;
  vNormal = bakeNormal;
  vFallback = fallback;
  vAtlas = atlas;
  gl_Position = vec4(atlas * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** A panorama's score for this texel, plus 50 so a cleared target (0) is below any; discards what it cannot see. */
const SCORE = /* glsl */ `
uniform samplerCube uDepth;
uniform vec3 uOrigin;
uniform float uFloorY;
uniform float uCeilY;
varying vec3 vWorld;
varying vec3 vNormal;
float score() {
  vec3 ray = vWorld - uOrigin;
  float d = length(ray);
  vec3 dir = ray / max(d, 1e-4);
  float facing = dot(normalize(vNormal), -dir);
  // Never at a grazing angle (past about 62°), and never from across the building: that is where a photo smears.
  // A wall or a piece of furniture only near and head-on (under about 37 degrees, within 3.5 m): what a
  // photograph shows sharp. The floor and ceiling are only asked their colour, from further and aslant.
  bool level = vWorld.y < uFloorY + 0.05 || vWorld.y > uCeilY - 0.05;
  if (level ? (facing < 0.3 || d > 8.0) : (facing < 0.8 || d > 3.5)) discard;
  float seenTo = textureCube(uDepth, ray).r;
  if (d > seenTo * 1.015 + 0.05) discard;
  float s = 0.8 * log(facing) - 2.0 * log(max(d, 0.4));
  // The tripod, and the blur the scanner leaves under itself.
  if (ray.y < -0.9 && length(ray.xz) < 0.7) s -= 6.0;
  return s + 50.0;
}
`;

const DISTANCE_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export interface PhotoProgress {
  painted: number;
  total: number;
  done: boolean;
}

/**
 * The plan's surfaces as a drawn group (`group`), painted from `panos` a few
 * at a time by `step`, called once a frame with the renderer that draws them.
 */
export class PhotoSet {
  readonly group = new Group();
  private readonly surfaces: Surface[] = [];
  private readonly bakeGeometry: BufferGeometry;
  private readonly drawMaterial: ShaderMaterial;
  private readonly atlas: WebGLRenderTarget;
  private readonly resolveMaterial: ShaderMaterial;
  /** Where each surface's six vertices start in the drawn geometry, and the floor's runs with their rooms. */
  private readonly drawn: Mesh;
  private readonly floorRuns: { start: number; count: number; room: string }[] = [];
  private floorStart = 0;
  private readonly accum: WebGLRenderTarget;
  private readonly best: WebGLRenderTarget;
  private readonly bakeScene = new Scene();
  private readonly bakeMesh: Mesh;
  private readonly orthographic = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly depthScene = new Scene();
  private readonly depthCamera = new PerspectiveCamera(90, 1, 0.02, 200);
  private readonly scoreMaterial: ShaderMaterial;
  private readonly paintMaterial: ShaderMaterial;
  private readonly depths: (WebGLCubeRenderTarget | null)[];
  private readonly entries: { pano: PhotoPano; origin: Vector3; toPano: Matrix3 }[];
  private readonly order: number[];
  private readonly align = alignToCube();
  private readonly abort = new AbortController();
  private readonly ready = new Map<number, CubeTexture>();
  private nextDepth = 0;
  private nextScore = 0;
  private nextFetch = 0;
  private fetching = 0;
  private painted = 0;
  private failed = 0;
  private finished = false;
  private disposed = false;
  /** The atlas's texel, metres. */
  readonly texelM: number;
  /** Seconds the painting took, once done. */
  seconds: number | null = null;
  private readonly started = performance.now();

  constructor(
    private readonly plan: ScanPlan,
    panos: readonly PhotoPano[],
    /** Where the painting starts: the panoramas nearest here go first. */
    start: Vec,
    /** The room a point of the floor is in: walls and floors take their room's colour. */
    private readonly roomOf: (p: Vec) => string,
    private readonly onChange?: () => void,
  ) {
    this.collect();
    this.texelM = this.pack();
    const px = PHOTO.atlasPx;
    const target = (type: typeof HalfFloatType, format: typeof RGBAFormat | typeof RedFormat, mip = false) =>
      new WebGLRenderTarget(px, px, {
        type,
        format,
        minFilter: mip ? LinearMipmapLinearFilter : NearestFilter,
        magFilter: mip ? LinearFilter : NearestFilter,
        generateMipmaps: mip,
        depthBuffer: false,
        colorSpace: NoColorSpace,
      });
    this.accum = target(HalfFloatType, RGBAFormat);
    this.best = target(HalfFloatType, RGBAFormat);
    this.atlas = new WebGLRenderTarget(px, px, {
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
      colorSpace: NoColorSpace,
      anisotropy: 8,
    });

    // What is drawn: flat colours, a touch of shade by which way a face looks so corners read, a
    // dark baseboard along the walls' feet, the ceiling's tile grid and the carpet's grain.
    this.drawMaterial = new ShaderMaterial({
      uniforms: {
        uFloorY: { value: this.plan.floorY },
        uAngle: { value: this.plan.angle },
        uBase: { value: new Vector3(0.24, 0.23, 0.22) },
        uTile: { value: PHOTO.ceilingTileM },
        uAtlas: { value: this.atlas.texture },
        uHasAtlas: { value: 0 },
        uGrain: { value: 0.05 },
      },
      vertexShader: /* glsl */ `
attribute vec3 colour;
attribute float kind;
varying vec2 vUv;
varying vec3 vColour;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vKind;
void main() {
  vColour = colour;
  vUv = uv;
  vKind = kind;
  vNormal = normal;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`,
      fragmentShader: /* glsl */ `
uniform float uFloorY;
uniform float uAngle;
uniform vec3 uBase;
uniform float uTile;
uniform sampler2D uAtlas;
uniform float uGrain;
uniform float uHasAtlas;
varying vec2 vUv;
varying vec3 vColour;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vKind;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 c = vColour;
  vec3 n = normalize(vNormal);
  float shade = 1.0 + 0.035 * dot(n, normalize(vec3(-0.55, 0.6, -0.3)));
  float c0 = cos(uAngle), s0 = sin(uAngle);
  vec2 square = vec2(vWorld.x * c0 + vWorld.z * s0, -vWorld.x * s0 + vWorld.z * c0);
  if (vKind < 0.5 || vKind > 2.5) {
    // A wall or a piece of furniture: its photograph where it was seen sharp and differs from the flat colour.
    vec4 photo = uHasAtlas > 0.5 ? texture2D(uAtlas, vUv) : vec4(0.0);
    // At the edge of what was seen the filter mixes in the unseen (black): take the seen part's own colour.
    photo.rgb /= max(photo.a, 1e-3);
    // A feature differs plainly from its wall (a door, a board, a cupboard); paint a shade lighter or darker is the same wall.
    float differs = smoothstep(0.2, 0.36, distance(photo.rgb, c));
    float seen = smoothstep(0.85, 1.0, photo.a);
    if (vKind > 2.5) differs = 1.0;
    c = mix(c, photo.rgb, differs * seen);
    if (vKind < 0.5 && vWorld.y - uFloorY < 0.1) c = uBase;
  } else if (vKind < 1.5) {
    // The floor: a carpet's grain, as varied as the photographs' carpet.
    c *= 1.0 + uGrain * (2.0 * hash(floor(square / 0.02)) - 1.0) + 0.5 * uGrain * (2.0 * hash(floor(square / 0.11) + 7.0) - 1.0);
  } else if (vKind < 2.5) {
    // The ceiling: a drop ceiling's grid.
    vec2 g = abs(fract(square / uTile) - 0.5) * uTile;
    if (min(0.5 * uTile - g.x, 0.5 * uTile - g.y) < 0.012) c *= 0.82;
    shade = 1.0;
  }
  gl_FragColor = vec4(c * shade, 1.0);
}`,
      side: DoubleSide,
    });
    this.drawn = new Mesh(this.flatGeometry(), this.drawMaterial);
    this.drawn.name = "scan-set";
    this.group.add(this.drawn);

    // What the depth cubes see: every surface.
    const distance = new ShaderMaterial({
      uniforms: { uOrigin: { value: new Vector3() } },
      vertexShader: DISTANCE_VERTEX,
      fragmentShader: /* glsl */ `
uniform vec3 uOrigin;
varying vec3 vWorld;
void main() { gl_FragColor = vec4(distance(vWorld, uOrigin), 0.0, 0.0, 1.0); }`,
      side: DoubleSide,
    });
    this.depthScene.add(new Mesh(this.drawGeometry(), distance));

    this.bakeGeometry = this.bakeGeometryOf();
    const add = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor };
    this.scoreMaterial = new ShaderMaterial({
      uniforms: { uDepth: { value: null }, uOrigin: { value: new Vector3() }, uFloorY: { value: this.plan.floorY }, uCeilY: { value: this.plan.ceilingY } },
      vertexShader: BAKE_VERTEX,
      fragmentShader: `${SCORE}\nvoid main() { gl_FragColor = vec4(score(), 0.0, 0.0, 1.0); }`,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    });
    this.paintMaterial = new ShaderMaterial({
      uniforms: {
        uDepth: { value: null },
        uOrigin: { value: new Vector3() },
        uFloorY: { value: this.plan.floorY },
        uCeilY: { value: this.plan.ceilingY },
        uPhoto: { value: null },
        uToPano: { value: new Matrix3() },
        uBest: { value: this.best.texture },
        uSharp: { value: PHOTO.sharpness },
      },
      vertexShader: BAKE_VERTEX,
      fragmentShader: /* glsl */ `${SCORE}
uniform samplerCube uPhoto;
uniform mat3 uToPano;
uniform sampler2D uBest;
uniform float uSharp;
varying vec2 vAtlas;
void main() {
  float s = score();
  float best = texture2D(uBest, vAtlas).r;
  float w = exp(uSharp * (s - best));
  vec3 colour = textureCube(uPhoto, uToPano * (vWorld - uOrigin)).rgb;
  gl_FragColor = vec4(colour * w, w);
}`,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      ...add,
    });
    this.resolveMaterial = new ShaderMaterial({
      uniforms: { uAccum: { value: this.accum.texture } },
      vertexShader: BAKE_VERTEX,
      fragmentShader: /* glsl */ `
uniform sampler2D uAccum;
varying vec2 vAtlas;
void main() {
  vec4 a = texture2D(uAccum, vAtlas);
  gl_FragColor = a.a > 1e-3 ? vec4(a.rgb / a.a, 1.0) : vec4(0.0);
}`,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      blending: NoBlending,
    });
    this.bakeMesh = new Mesh(this.bakeGeometry, this.scoreMaterial);
    this.bakeMesh.frustumCulled = false;
    this.bakeScene.add(this.bakeMesh);

    this.entries = panos.map((pano) => {
      const own = quatToMat3(conjugate(pano.rotation));
      const { rotation } = this.align;
      const elements: number[] = [];
      for (let col = 0; col < 3; col++) {
        const [x, y, z] = [own[col * 3], own[col * 3 + 1], own[col * 3 + 2]];
        for (let row = 0; row < 3; row++) {
          const r = rotation[row];
          elements.push((r[0] * x + r[1] * y + r[2] * z) * CUBE_LOOKUP_FLIP[row]);
        }
      }
      return { pano, origin: new Vector3(...pano.position), toPano: new Matrix3().fromArray(elements) };
    });
    this.depths = this.entries.map(() => null);
    this.order = this.entries
      .map((e, i) => ({ i, d: Math.hypot(e.origin.x - start.x, e.origin.z - start.y) }))
      .sort((p, q) => p.d - q.d)
      .map((p) => p.i);
  }

  progress(): PhotoProgress {
    return { painted: this.painted + this.failed, total: this.entries.length, done: this.finished };
  }

  // ---- the surfaces ----

  private piece = -1;

  private surface(o: Vector3, u: Vector3, v: Vector3, w: number, h: number, kind: Surface["kind"]): void {
    if (w < 1e-3 || h < 1e-3) return;
    const n = new Vector3().crossVectors(u, v).normalize();
    this.surfaces.push({ o, u: u.clone().normalize(), v: v.clone().normalize(), n, w, h, kind, piece: kind === "furniture" ? this.piece : -1, x: 0, y: 0, pw: 0, ph: 0 });
  }

  private collect(): void {
    const { plan } = this;
    const { floor, floorY: y0, ceilingY: y1 } = plan;
    const half = PLAN.thickM / 2;
    const up = new Vector3(0, 1, 0);
    const at = (p: Vec, y: number) => new Vector3(p.x, y, p.y);
    // Floor and ceiling tiles on the building's square, where there is floor.
    const tile = PHOTO.tileM;
    const uA = floor.u0;
    const vA = floor.v0;
    const uB = floor.u0 + floor.cols * floor.cell;
    const vB = floor.v0 + floor.rows * floor.cell;
    for (let tu = uA; tu < uB - 1e-6; tu += tile) {
      for (let tv = vA; tv < vB - 1e-6; tv += tile) {
        const w = Math.min(tile, uB - tu);
        const h = Math.min(tile, vB - tv);
        let any = false;
        for (let a = 0.125; a < w && !any; a += 0.25) {
          for (let b = 0.125; b < h && !any; b += 0.25) {
            const p = fromCellFrame(floor, tu + a, tv + b);
            if (onPlanFloor(floor, p.x, p.y)) any = true;
          }
        }
        if (!any) continue;
        const o = fromCellFrame(floor, tu, tv);
        const pu = fromCellFrame(floor, tu + 1, tv);
        const pv = fromCellFrame(floor, tu, tv + 1);
        const du = new Vector3(pu.x - o.x, 0, pu.y - o.y);
        const dv = new Vector3(pv.x - o.x, 0, pv.y - o.y);
        // u × v must point up for the floor and down for the ceiling.
        const floorUp = new Vector3().crossVectors(du, dv).y > 0;
        if (floorUp) {
          this.surface(at(o, y0), du, dv, w, h, "floor");
          this.surface(at(o, y1), dv, du, h, w, "ceiling");
        } else {
          this.surface(at(o, y0), dv, du, h, w, "floor");
          this.surface(at(o, y1), du, dv, w, h, "ceiling");
        }
      }
    }
    // Wall faces that look onto floor, and their ends.
    const H = y1 - y0;
    for (const wall of plan.walls) {
      const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
      if (len < 1e-3 || wall.door) continue;
      const d = new Vector3((wall.b.x - wall.a.x) / len, 0, (wall.b.y - wall.a.y) / len);
      const mid = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
      for (const s of [1, -1]) {
        const n = { x: -d.z * s, y: d.x * s };
        const probe = (k: number) => onPlanFloor(floor, wall.a.x + (wall.b.x - wall.a.x) * k + n.x * 0.3, wall.a.y + (wall.b.y - wall.a.y) * k + n.y * 0.3);
        if (![0.1, 0.3, 0.5, 0.7, 0.9].some(probe) && !onPlanFloor(floor, mid.x + n.x * 0.3, mid.y + n.y * 0.3)) continue;
        const a = { x: wall.a.x + n.x * half, y: wall.a.y + n.y * half };
        const b = { x: wall.b.x + n.x * half, y: wall.b.y + n.y * half };
        // u along the wall and v up, with u × v pointing out of this face.
        if (s === 1) this.surface(at(a, y0), d.clone(), up, len, H, "wall");
        else this.surface(at(b, y0), d.clone().negate(), up, len, H, "wall");
      }
      for (const [end, out] of [[wall.a, -1], [wall.b, 1]] as const) {
        // The end faces along the wall, outwards: u × up = out × d.
        const n = new Vector3(-d.z, 0, d.x);
        const p = at({ x: end.x + n.x * half * out, y: end.y + n.z * half * out }, y0);
        this.surface(p, n.clone().multiplyScalar(-out), up, PLAN.thickM, H, "wall");
      }
    }
    // Lintels over the doorways: both faces and the underside.
    const doorTop = Math.min(y0 + 2.1, y1 - 0.1);
    for (const door of plan.doorways) {
      if (!door.lintel) continue;
      const len = Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y);
      if (len < 1e-3) continue;
      const d = new Vector3((door.b.x - door.a.x) / len, 0, (door.b.y - door.a.y) / len);
      const n = new Vector3(-d.z, 0, d.x);
      const pa = at({ x: door.a.x + n.x * half, y: door.a.y + n.z * half }, doorTop);
      const qa = at({ x: door.a.x - n.x * half, y: door.a.y - n.z * half }, doorTop);
      const qb = at({ x: door.b.x - n.x * half, y: door.b.y - n.z * half }, doorTop);
      this.surface(pa, d.clone(), up, len, y1 - doorTop, "wall");
      this.surface(qb, d.clone().negate(), up, len, y1 - doorTop, "wall");
      this.surface(qa, d.clone(), n.clone(), len, PLAN.thickM, "wall");
    }
    // Furniture. A desk (no higher than a desk) is its top, its two ends and a modesty panel along the
    // long side nearer a wall; anything higher is a box, its top and four sides. Each face faces out.
    const panel = 0.025;
    const nearWall = (p: Vector3) => Math.min(...plan.walls.map((w) => Math.hypot(nearestOn(w, { x: p.x, y: p.z }).x - p.x, nearestOn(w, { x: p.x, y: p.z }).y - p.z)));
    for (const box of plan.furniture) {
      this.piece++;
      const c = box.corners.map((p) => new Vector3(p.x, y0, p.y));
      const tall = box.top - y0;
      const centre = c.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(0.25);
      const top = (o: Vector3, e1: Vector3, e3: Vector3, w: number, h: number, y: number) => {
        const at = o.clone().setY(y);
        if (new Vector3().crossVectors(e1, e3).y > 0) this.surface(at, e1, e3, w, h, "furniture");
        else this.surface(at, e3, e1, h, w, "furniture");
      };
      /** An upright face from p to q, `bottom` to `height` over the floor, facing away from `inside`. */
      const side = (p: Vector3, q: Vector3, bottom: number, height: number, inside: Vector3) => {
        const along = q.clone().sub(p);
        const out = new Vector3().crossVectors(along, up);
        const base = (v: Vector3) => v.clone().setY(y0 + bottom);
        if (out.dot(p.clone().sub(inside)) > 0) this.surface(base(p), along, up, along.length(), height - bottom, "furniture");
        else this.surface(base(q), along.clone().negate(), up, along.length(), height - bottom, "furniture");
      };
      top(c[0], c[1].clone().sub(c[0]), c[3].clone().sub(c[0]), c[1].distanceTo(c[0]), c[3].distanceTo(c[0]), box.top);
      if (tall > 1.0) {
        for (let k = 0; k < 4; k++) side(c[k], c[(k + 1) % 4], 0, tall, centre);
        continue;
      }
      // The top's edge, all round.
      for (let k = 0; k < 4; k++) side(c[k], c[(k + 1) % 4], tall - 0.04, tall, centre);
      // The long sides and the short ends.
      const edges = [0, 1, 2, 3].map((k) => ({ p: c[k], q: c[(k + 1) % 4], len: c[k].distanceTo(c[(k + 1) % 4]) }));
      const long = edges.filter((e) => e.len >= Math.max(...edges.map((x) => x.len)) - 1e-6);
      const ends = edges.filter((e) => !long.includes(e)).slice(0, 2);
      const back = [...long].sort((a, b) => nearWall(a.p.clone().add(a.q).multiplyScalar(0.5)) - nearWall(b.p.clone().add(b.q).multiplyScalar(0.5)))[0];
      const plate = (e: { p: Vector3; q: Vector3 }, bottom: number) => {
        // A panel set just inside the edge, both faces.
        const inward = centre.clone().sub(e.p.clone().add(e.q).multiplyScalar(0.5)).setY(0).normalize().multiplyScalar(0.03);
        const p = e.p.clone().add(inward);
        const q = e.q.clone().add(inward);
        const behind = inward.clone().normalize().multiplyScalar(panel);
        side(p, q, bottom, tall - 0.04, p.clone().add(q).multiplyScalar(0.5).add(behind));
        side(p.clone().add(behind), q.clone().add(behind), bottom, tall - 0.04, p.clone().add(q).multiplyScalar(0.5));
      };
      if (back) plate(back, 0.15);
      for (const e of ends.length === 2 ? ends : long.filter((e) => e !== back)) plate(e, 0);
    }
  }

  /** Shelf-packs the surfaces into the atlas at the finest texel that fits; returns the texel size. */
  private pack(): number {
    const px = PHOTO.atlasPx;
    const g = PHOTO.gutterPx;
    let texel = PHOTO.texelM;
    for (let attempt = 0; attempt < 30; attempt++, texel *= 1.12) {
      const order = [...this.surfaces].sort((p, q) => q.h - p.h);
      let x = 0;
      let y = 0;
      let shelf = 0;
      let fits = true;
      for (const s of order) {
        const t = s.kind === "floor" || s.kind === "ceiling" ? texel * PHOTO.flatScale : texel;
        s.pw = Math.max(1, Math.ceil(s.w / t));
        s.ph = Math.max(1, Math.ceil(s.h / t));
        const bw = s.pw + 2 * g;
        const bh = s.ph + 2 * g;
        if (bw > px) {
          fits = false;
          break;
        }
        if (x + bw > px) {
          x = 0;
          y += shelf;
          shelf = 0;
        }
        if (y + bh > px) {
          fits = false;
          break;
        }
        s.x = x + g;
        s.y = y + g;
        x += bw;
        shelf = Math.max(shelf, bh);
      }
      if (fits) return texel;
    }
    return texel;
  }

  /**
   * What is drawn: every surface but the floor as its own quad (six vertices
   * each, in the surfaces' order), then the floor as runs of its cells, each
   * run in one room, then one quad under the whole floor so no crack shows
   * where the cells stop short of a wall.
   */
  private flatGeometry(): BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const kinds: number[] = [];
    const uvs: number[] = [];
    const px = PHOTO.atlasPx;
    const KIND: Record<Surface["kind"], number> = { wall: 0, floor: 1, ceiling: 2, furniture: 3 };
    const quad = (corners: Vector3[], n: Vector3, kind: number, patch?: Surface) => {
      const at: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        positions.push(corners[k].x, corners[k].y, corners[k].z);
        normals.push(n.x, n.y, n.z);
        kinds.push(kind);
        uvs.push(patch ? (patch.x + at[k][0] * patch.pw) / px : 0, patch ? (patch.y + at[k][1] * patch.ph) / px : 0);
      }
    };
    for (const s of this.surfaces) {
      // Floor tiles are drawn as cell runs below; their six vertices stay, out of sight, so indices hold.
      const corners = [
        s.o.clone(),
        s.o.clone().addScaledVector(s.u, s.w),
        s.o.clone().addScaledVector(s.u, s.w).addScaledVector(s.v, s.h),
        s.o.clone().addScaledVector(s.v, s.h),
      ];
      if (s.kind === "floor") corners.forEach((c) => (c.y -= 0.02));
      quad(corners, s.n, KIND[s.kind], s);
    }
    const { floor, floorY } = this.plan;
    const up = new Vector3(0, 1, 0);
    const at = (u: number, v: number) => {
      const p = fromCellFrame(floor, u, v);
      return new Vector3(p.x, floorY, p.y);
    };
    const roomCell = new Map<number, string>();
    const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < floor.cols && j < floor.rows && floor.cells[j * floor.cols + i] === 1;
    const roomAt = (i: number, j: number) => {
      const k = j * floor.cols + i;
      let room = roomCell.get(k);
      if (room === undefined) {
        const p = fromCellFrame(floor, floor.u0 + (i + 0.5) * floor.cell, floor.v0 + (j + 0.5) * floor.cell);
        room = this.roomOf(p);
        roomCell.set(k, room);
      }
      return room;
    };
    for (let j = 0; j < floor.rows; j++) {
      let i = 0;
      while (i < floor.cols) {
        if (!filled(i, j)) {
          i++;
          continue;
        }
        const room = roomAt(i, j);
        let e = i + 1;
        while (e < floor.cols && filled(e, j) && roomAt(e, j) === room) e++;
        const ua = floor.u0 + i * floor.cell;
        const ub = floor.u0 + e * floor.cell;
        const va = floor.v0 + j * floor.cell;
        const vb = va + floor.cell;
        const corners = [at(ua, va), at(ub, va), at(ub, vb), at(ua, vb)];
        // Face up whichever way the square turns.
        const n = new Vector3().subVectors(corners[1], corners[0]).cross(new Vector3().subVectors(corners[3], corners[0]));
        if (n.y < 0) corners.reverse();
        this.floorRuns.push({ start: positions.length / 3, count: 6, room });
        quad(corners, up, 1);
        i = e;
      }
    }
    this.floorStart = positions.length / 3;
    const [uA, uB, vA, vB] = [floor.u0, floor.u0 + floor.cols * floor.cell, floor.v0, floor.v0 + floor.rows * floor.cell];
    quad([at(uA, vA), at(uB, vA), at(uB, vB), at(uA, vB)].map((c) => c.setY(floorY - 0.01)), up, 1);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute("kind", new BufferAttribute(new Float32Array(kinds), 1));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    const colours = new Float32Array(positions.length);
    for (let v = 0; v < kinds.length; v++) {
      const kind = (["wall", "floor", "ceiling", "furniture"] as const)[kinds[v]];
      colours.set(FALLBACK[kind], v * 3);
    }
    geometry.setAttribute("colour", new BufferAttribute(colours, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** The surfaces as the depth cubes see them: one quad each, its corners at its patch's corners in the atlas. */
  private drawGeometry(): BufferGeometry {
    const px = PHOTO.atlasPx;
    const positions: number[] = [];
    const uvs: number[] = [];
    for (const s of this.surfaces) {
      const corners: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
        [1, 1],
        [0, 1],
      ];
      for (const [a, b] of corners) {
        const p = s.o.clone().addScaledVector(s.u, a * s.w).addScaledVector(s.v, b * s.h);
        positions.push(p.x, p.y, p.z);
        uvs.push((s.x + a * s.pw) / px, (s.y + b * s.ph) / px);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** The surfaces as painted: each patch with its gutter, in atlas space, carrying where it is in the world. */
  private bakeGeometryOf(): BufferGeometry {
    const px = PHOTO.atlasPx;
    const g = PHOTO.gutterPx;
    const positions: number[] = [];
    const atlas: number[] = [];
    const normals: number[] = [];
    const fallback: number[] = [];
    for (const s of this.surfaces) {
      // The gutter, in the surface's own fraction.
      const ga = g / s.pw;
      const gb = g / s.ph;
      const corners: [number, number][] = [
        [-ga, -gb],
        [1 + ga, -gb],
        [1 + ga, 1 + gb],
        [-ga, -gb],
        [1 + ga, 1 + gb],
        [-ga, 1 + gb],
      ];
      for (const [a, b] of corners) {
        const p = s.o.clone().addScaledVector(s.u, a * s.w).addScaledVector(s.v, b * s.h);
        positions.push(p.x, p.y, p.z);
        atlas.push((s.x + a * s.pw) / px, (s.y + b * s.ph) / px);
        normals.push(s.n.x, s.n.y, s.n.z);
        fallback.push(...FALLBACK[s.kind]);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("atlas", new BufferAttribute(new Float32Array(atlas), 2));
    geometry.setAttribute("bakeNormal", new BufferAttribute(new Float32Array(normals), 3));
    geometry.setAttribute("fallback", new BufferAttribute(new Float32Array(fallback), 3));
    return geometry;
  }

  // ---- the panoramas ----

  private async fetchCube(index: number): Promise<void> {
    const { pano } = this.entries[index];
    try {
      if (!pano.faces.every(isAllowedAssetUrl)) throw new Error("link");
      const blobs = await Promise.all(
        pano.faces.map(async (url) => {
          const response = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: this.abort.signal });
          if (!response.ok) throw new Error(`face ${response.status}`);
          return response.blob();
        }),
      );
      const images: ImageBitmap[] = [];
      for (let slot = 0; slot < 6; slot++) {
        const { face, identity, transform } = this.align.layout[slot];
        const image = await createImageBitmap(blobs[face], { premultiplyAlpha: "none", colorSpaceConversion: "none" });
        if (identity) {
          images.push(image);
          continue;
        }
        const size = image.width;
        const canvas = new OffscreenCanvas(size, size);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d canvas");
        const [a, b, c, d] = transform;
        context.setTransform(a, b, c, d, size / 2, size / 2);
        context.drawImage(image, -size / 2, -size / 2);
        image.close();
        images.push(canvas.transferToImageBitmap());
      }
      if (this.disposed) {
        images.forEach((i) => i.close());
        return;
      }
      const cube = new CubeTexture(images);
      cube.colorSpace = NoColorSpace;
      cube.generateMipmaps = false;
      cube.minFilter = LinearFilter;
      cube.needsUpdate = true;
      this.ready.set(index, cube);
    } catch {
      if (!this.disposed) this.failed++;
    } finally {
      this.fetching--;
    }
  }

  private renderDepth(renderer: WebGLRenderer, origin: Vector3): WebGLCubeRenderTarget {
    const single = renderer.extensions.has("EXT_color_buffer_float");
    const target = new WebGLCubeRenderTarget(PHOTO.depthPx, {
      type: HalfFloatType,
      format: single ? RedFormat : RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    const mesh = this.depthScene.children[0] as Mesh;
    (mesh.material as ShaderMaterial).uniforms.uOrigin.value.copy(origin);
    const camera = this.depthCamera;
    camera.position.copy(origin);
    CUBE_CAMERAS.forEach(([look, up], i) => {
      camera.up.copy(up);
      camera.lookAt(origin.x + look.x, origin.y + look.y, origin.z + look.z);
      camera.updateMatrixWorld();
      renderer.setRenderTarget(target, i);
      renderer.setClearColor(new Color(1000, 0, 0), 1);
      renderer.clear();
      renderer.render(this.depthScene, camera);
    });
    return target;
  }

  private pass(renderer: WebGLRenderer, target: WebGLRenderTarget, material: ShaderMaterial): void {
    this.bakeMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.bakeScene, this.orthographic);
  }

  /** A bounded piece of the painting, once a frame. */
  step(renderer: WebGLRenderer): void {
    if (this.disposed || this.finished) return;
    const before = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new Color());
    const alpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      // The photos are fetched from the start, while the depth cubes and scores are worked out.
      while (this.fetching < PHOTO.fetches && this.ready.size + this.fetching < 16 && this.nextFetch < this.order.length) {
        this.fetching++;
        void this.fetchCube(this.order[this.nextFetch++]);
      }
      const t0 = performance.now();
      // First every panorama's depth cube and its score: they need no photo.
      while (this.nextDepth < this.entries.length && performance.now() - t0 < 6) {
        if (this.nextDepth === 0) {
          for (const t of [this.accum, this.best]) {
            renderer.setRenderTarget(t);
            renderer.setClearColor(new Color(0, 0, 0), 0);
            renderer.clear();
          }
        }
        this.depths[this.nextDepth] = this.renderDepth(renderer, this.entries[this.nextDepth].origin);
        this.nextDepth++;
      }
      if (this.nextDepth < this.entries.length) return;
      while (this.nextScore < this.entries.length && performance.now() - t0 < 6) {
        const i = this.nextScore++;
        this.scoreMaterial.uniforms.uDepth.value = this.depths[i]!.texture;
        this.scoreMaterial.uniforms.uOrigin.value.copy(this.entries[i].origin);
        this.pass(renderer, this.best, this.scoreMaterial);
      }
      if (this.nextScore < this.entries.length) return;

      // Then the photos, nearest the start first, as they arrive.
      const [index, cube] = this.ready.entries().next().value ?? [];
      if (index !== undefined && cube) {
        this.ready.delete(index);
        const e = this.entries[index];
        const u = this.paintMaterial.uniforms;
        u.uDepth.value = this.depths[index]!.texture;
        u.uOrigin.value.copy(e.origin);
        u.uToPano.value.copy(e.toPano);
        u.uPhoto.value = cube;
        this.pass(renderer, this.accum, this.paintMaterial);
        u.uPhoto.value = null;
        cube.dispose();
        for (const image of cube.images as ImageBitmap[]) image.close();
        this.painted++;
        this.onChange?.();
      }
      if (this.painted + this.failed >= this.entries.length && this.fetching === 0 && this.ready.size === 0) {
        this.finish(renderer);
      }
    } finally {
      renderer.setRenderTarget(before);
      renderer.setClearColor(clear, alpha);
      renderer.autoClear = autoClear;
    }
  }

  /** Each surface's colour: the median of what its well-seen texels saw, gathered by room. */
  private finish(renderer: WebGLRenderer): void {
    const full = PHOTO.atlasPx;
    // The atlas averaged down by `k` each way, what was seen only: enough to ask a surface its colour.
    const k = 4;
    const px = full / k;
    const down = new WebGLRenderTarget(px, px, { type: HalfFloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
    const average = new ShaderMaterial({
      uniforms: { uAccum: { value: this.accum.texture } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
uniform sampler2D uAccum;
varying vec2 vUv;
void main() {
  vec4 sum = vec4(0.0);
  ivec2 base = ivec2(floor(vUv * ${px.toFixed(1)})) * ${k};
  for (int y = 0; y < ${k}; y++) {
    for (int x = 0; x < ${k}; x++) {
      vec4 a = texelFetch(uAccum, base + ivec2(x, y), 0);
      if (a.a > 1e-3) sum += vec4(a.rgb / a.a, 1.0);
    }
  }
  gl_FragColor = sum.a > 0.0 ? vec4(sum.rgb / sum.a, sum.a) : vec4(0.0);
}`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new BufferGeometry(), average);
    quad.geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    quad.geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    quad.frustumCulled = false;
    const scene = new Scene();
    scene.add(quad);
    renderer.setRenderTarget(down);
    renderer.render(scene, this.orthographic);
    const accum = new Uint16Array(px * px * 4);
    renderer.readRenderTargetPixels(down, 0, 0, px, px, accum);
    down.dispose();
    average.dispose();
    quad.geometry.dispose();
    const half = DataUtils.fromHalfFloat;
    type Rgb = [number, number, number];
    const wallsBy = new Map<string, Rgb[]>();
    const floorsBy = new Map<string, Rgb[]>();
    const ceiling: Rgb[] = [];
    const base: Rgb[] = [];
    const pieces = new Map<number, Rgb[]>();
    const ownWall = new Map<number, Rgb[]>();
    const allWalls: Rgb[] = [];
    const allFloors: Rgb[] = [];
    const allPieces: Rgb[] = [];
    const push = (map: Map<string | number, Rgb[]>, key: string | number, value: Rgb) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    const wallRoom = this.surfaces.map((s) =>
      s.kind === "wall" ? this.roomOf({ x: s.o.x + s.u.x * s.w * 0.5 + s.n.x * 0.4, y: s.o.z + s.u.z * s.w * 0.5 + s.n.z * 0.4 }) : "",
    );
    const grains: number[] = [];
    this.surfaces.forEach((s, si) => {
      for (let y = Math.ceil(s.y / k - 0.5); (y + 0.5) * k < s.y + s.ph; y++) {
        for (let x = Math.ceil(s.x / k - 0.5); (x + 0.5) * k < s.x + s.pw; x++) {
          const at4 = (y * px + x) * 4;
          if (half(accum[at4 + 3]) <= 0) continue;
          const c: Rgb = [half(accum[at4]), half(accum[at4 + 1]), half(accum[at4 + 2])];
          const a = ((x + 0.5) * k - s.x) / s.pw;
          const b = ((y + 0.5) * k - s.y) / s.ph;
          if (s.kind === "wall") {
            if (b * s.h < 0.1) base.push(c);
            else if (b * s.h > 0.3) {
              push(wallsBy, wallRoom[si], c);
              push(ownWall, si, c);
              allWalls.push(c);
            }
          } else if (s.kind === "floor") {
            const at = { x: s.o.x + s.u.x * a * s.w + s.v.x * b * s.h, y: s.o.z + s.u.z * a * s.w + s.v.z * b * s.h };
            push(floorsBy, this.roomOf(at), c);
            allFloors.push(c);
            grains.push(c[0] + c[1] + c[2]);
          } else if (s.kind === "ceiling") ceiling.push(c);
          else {
            push(pieces, s.piece, c);
            allPieces.push(c);
          }
        }
      }
    });
    const memo = new Map<Rgb[], Rgb>();
    const median = (values: Rgb[] | undefined, fallback: Rgb): Rgb => {
      if (!values || values.length < 8) return fallback;
      const known = memo.get(values);
      if (known) return known;
      const found = middle(values);
      memo.set(values, found);
      return found;
    };
    const middle = (values: Rgb[]): Rgb => {
      // By brightness, so the colour is one texel's own and not a mix of three.
      const sorted = [...values].sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
      // A little over the middle: what the photographs show of a wall in shade is the same wall, lit.
      return sorted[Math.floor(sorted.length * 0.75)];
    };
    const wallAll = median(allWalls, FALLBACK.wall);
    const floorAll = median(allFloors, FALLBACK.floor);
    const pieceAll = median(allPieces, FALLBACK.furniture);
    const colour = this.drawn.geometry.getAttribute("colour") as BufferAttribute;
    const set = (start: number, count: number, c: Rgb) => {
      for (let v = start; v < start + count; v++) colour.setXYZ(v, c[0], c[1], c[2]);
    };
    const ceilingColour = median(ceiling, FALLBACK.ceiling);
    // A wall face keeps its own colour only near its room's: one whose photographs were mostly a window's view is room paint.
    const wallColour = (si: number): Rgb => {
      const room = median(wallsBy.get(wallRoom[si]), wallAll);
      const own = (ownWall.get(si)?.length ?? 0) >= 24 ? median(ownWall.get(si), room) : room;
      return Math.hypot(own[0] - room[0], own[1] - room[1], own[2] - room[2]) < 0.12 ? own : room;
    };
    this.surfaces.forEach((s, si) => {
      if (s.kind === "floor") return;
      const c =
        // A wall face its photographs saw well enough takes their colour (so its decals sit on their own paint);
        // one they barely saw takes its room's walls' colour.
        s.kind === "wall" ? wallColour(si) : s.kind === "ceiling" ? ceilingColour : median(pieces.get(s.piece), pieceAll);
      set(si * 6, 6, c);
    });
    for (const run of this.floorRuns) set(run.start, run.count, median(floorsBy.get(run.room), floorAll));
    set(this.floorStart, 6, floorAll);
    colour.needsUpdate = true;
    const b = median(base, [0.24, 0.23, 0.22]);
    (this.drawMaterial.uniforms.uBase.value as Vector3).set(b[0], b[1], b[2]);
    // The carpet's grain: as much as its colour varies, within reason.
    if (grains.length > 16) {
      const mean = grains.reduce((sum, g) => sum + g, 0) / grains.length;
      const spread = Math.sqrt(grains.reduce((sum, g) => sum + (g - mean) ** 2, 0) / grains.length) / Math.max(mean, 1e-3);
      this.drawMaterial.uniforms.uGrain.value = Math.min(0.12, Math.max(0.03, spread));
    }
    // The decals: every surface's photograph, from its one best panorama.
    this.bakeMesh.material = this.resolveMaterial;
    renderer.setRenderTarget(this.atlas);
    renderer.setClearColor(new Color(0, 0, 0), 0);
    renderer.clear();
    renderer.render(this.bakeScene, this.orthographic);
    this.drawMaterial.uniforms.uHasAtlas.value = 1;
    this.finished = true;
    this.seconds = (performance.now() - this.started) / 1000;
    // What only the asking needed.
    this.accum.dispose();
    this.best.dispose();
    for (const d of this.depths) d?.dispose();
    this.onChange?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    for (const cube of this.ready.values()) {
      cube.dispose();
      for (const image of cube.images as ImageBitmap[]) image.close();
    }
    this.ready.clear();
    this.atlas.dispose();
    this.resolveMaterial.dispose();
    this.accum.dispose();
    this.best.dispose();
    for (const d of this.depths) d?.dispose();
    this.bakeGeometry.dispose();
    this.drawn.geometry.dispose();
    (this.depthScene.children[0] as Mesh | undefined)?.geometry.dispose();
    this.drawMaterial.dispose();
    this.scoreMaterial.dispose();
    this.paintMaterial.dispose();
  }
}

/**
 * The scan's panoramas on the floor at `floorY`, with links to their faces at
 * `faces`, asked of the scan route afresh (the links are good for minutes).
 * The model id goes in the body, so no request log shows it.
 */
export async function fetchPhotoPanos(modelId: string, floorY: number, faces: "low" | "high" | "2k" = "high"): Promise<PhotoPano[]> {
  const response = await fetch("/api/scan-mesh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ m: modelId, faces, mesh: "50k" }),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as { panos?: { position: Vec3; rotation: Quat; faces: string[] | null }[] } | null;
  return (body?.panos ?? [])
    .filter((p): p is { position: Vec3; rotation: Quat; faces: string[] } => p.faces !== null && p.faces.length === 6)
    .filter((p) => p.position[1] - floorY > 0.6 && p.position[1] - floorY < 2.6)
    .map((p) => ({ position: p.position, rotation: p.rotation, faces: p.faces }));
}
