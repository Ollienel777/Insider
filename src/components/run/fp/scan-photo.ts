// A live scan's plan (scan-plan.ts) dressed in the scan's own photographs
// (issue 118): every wall face, floor and ceiling tile and piece of furniture
// is a flat surface, and each is painted once, at load, from the panoramas
// into one texture atlas, on the GPU. Then it is drawn unlit, as it was
// photographed. Nothing depends on where the player stands, so nothing swims,
// smears or doubles as they walk.
//
// Painting, per texel of a surface:
// - Each panorama's depth cube (how far it sees in every direction, against
//   these same surfaces) says whether it sees the texel at all.
// - Of those that do, the best is the nearest and most head-on. Its score is
//   kept per texel (the "best" pass, a max over every panorama); then each
//   panorama adds its colour weighted by how close its score comes to the
//   best, so neighbours feather into one another without a seam.
// - The floor right under a panorama, where its tripod stood, is left to its
//   neighbours.
// - A texel no panorama sees takes its surface's median colour.
//
// The panoramas are fetched by this tab from the scan CDN, decoded, painted
// and let go one by one. Nothing is stored anywhere.
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
  NoBlending,
  NoColorSpace,
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
import { fromCellFrame, onPlanFloor, PLAN, type ScanPlan } from "./scan-plan";

/** Every number the painting is tuned by. */
export const PHOTO = Object.freeze({
  /** The atlas's side, texels. */
  atlasPx: 4096,
  /** The finest a texel goes, metres; coarser when the building will not fit. */
  texelM: 0.02,
  /** Texels round each surface's patch, painted too, so a lookup at its edge never reaches a neighbour's. */
  gutterPx: 3,
  /** The floor and ceiling are painted in tiles this big. */
  tileM: 4,
  /** How sharply a panorama's share falls as its score falls below the best: higher, crisper, more seams. */
  sharpness: 5,
  /** A depth cube's face, pixels. */
  depthPx: 256,
  /** Panoramas fetched at once. */
  fetches: 12,
  /** The atlas is redrawn from what is painted after every this many panoramas. */
  resolveEvery: 4,
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
  /** Where its patch sits in the atlas, texels, without the gutter. */
  x: number;
  y: number;
  pw: number;
  ph: number;
}

const FALLBACK: Record<Surface["kind"], [number, number, number]> = {
  floor: [0.42, 0.4, 0.38],
  ceiling: [0.82, 0.82, 0.8],
  wall: [0.72, 0.7, 0.66],
  furniture: [0.4, 0.38, 0.36],
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
varying vec3 vWorld;
varying vec3 vNormal;
float score() {
  vec3 ray = vWorld - uOrigin;
  float d = length(ray);
  vec3 dir = ray / max(d, 1e-4);
  float facing = dot(normalize(vNormal), -dir);
  if (facing < 0.06) discard;
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
  private readonly accum: WebGLRenderTarget;
  private readonly best: WebGLRenderTarget;
  private readonly bakeScene = new Scene();
  private readonly bakeMesh: Mesh;
  private readonly orthographic = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly depthScene = new Scene();
  private readonly depthCamera = new PerspectiveCamera(90, 1, 0.02, 200);
  private readonly scoreMaterial: ShaderMaterial;
  private readonly paintMaterial: ShaderMaterial;
  private readonly resolveMaterial: ShaderMaterial;
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
  private sinceResolve = 0;
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
    this.atlas = new WebGLRenderTarget(px, px, {
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
      colorSpace: NoColorSpace,
      anisotropy: 8,
    });
    this.accum = target(HalfFloatType, RGBAFormat);
    this.best = target(HalfFloatType, RedFormat);

    // What is drawn: every surface, unlit, from the atlas.
    this.drawMaterial = new ShaderMaterial({
      uniforms: { uAtlas: { value: this.atlas.texture } },
      vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uAtlas, vUv).rgb, 1.0);
}`,
      side: DoubleSide,
    });
    const drawn = new Mesh(this.drawGeometry(), this.drawMaterial);
    drawn.name = "scan-photo";
    this.group.add(drawn);

    // What the depth cubes see: the same surfaces.
    const distance = new ShaderMaterial({
      uniforms: { uOrigin: { value: new Vector3() } },
      vertexShader: DISTANCE_VERTEX,
      fragmentShader: /* glsl */ `
uniform vec3 uOrigin;
varying vec3 vWorld;
void main() { gl_FragColor = vec4(distance(vWorld, uOrigin), 0.0, 0.0, 1.0); }`,
      side: DoubleSide,
    });
    this.depthScene.add(new Mesh(drawn.geometry, distance));

    this.bakeGeometry = this.bakeGeometryOf();
    const add = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor };
    this.scoreMaterial = new ShaderMaterial({
      uniforms: { uDepth: { value: null }, uOrigin: { value: new Vector3() } },
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
varying vec3 vFallback;
void main() {
  vec4 a = texture2D(uAccum, vAtlas);
  gl_FragColor = vec4(a.a > 1e-3 ? a.rgb / a.a : vFallback, 1.0);
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

  private surface(o: Vector3, u: Vector3, v: Vector3, w: number, h: number, kind: Surface["kind"]): void {
    if (w < 1e-3 || h < 1e-3) return;
    const n = new Vector3().crossVectors(u, v).normalize();
    this.surfaces.push({ o, u: u.clone().normalize(), v: v.clone().normalize(), n, w, h, kind, x: 0, y: 0, pw: 0, ph: 0 });
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
      if (len < 1e-3) continue;
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
    // Furniture: the top and four sides of each box.
    for (const box of plan.furniture) {
      const c = box.corners.map((p) => new Vector3(p.x, y0, p.y));
      const e1 = c[1].clone().sub(c[0]);
      const e3 = c[3].clone().sub(c[0]);
      const w = e1.length();
      const h = e3.length();
      const tall = box.top - y0;
      const topO = c[0].clone().setY(box.top);
      // The top faces up.
      if (new Vector3().crossVectors(e1, e3).y > 0) this.surface(topO, e1, e3, w, h, "furniture");
      else this.surface(topO, e3, e1, h, w, "furniture");
      // Sides, round the box; each faces out.
      const centre = c.reduce((s, p) => s.add(p), new Vector3()).multiplyScalar(0.25);
      for (let k = 0; k < 4; k++) {
        const p = c[k];
        const q = c[(k + 1) % 4];
        const along = q.clone().sub(p);
        const out = new Vector3().crossVectors(along, up);
        if (out.dot(p.clone().sub(centre)) > 0) this.surface(p.clone(), along, up, along.length(), tall, "furniture");
        else this.surface(q.clone(), along.clone().negate(), up, along.length(), tall, "furniture");
      }
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
        s.pw = Math.max(1, Math.ceil(s.w / texel));
        s.ph = Math.max(1, Math.ceil(s.h / texel));
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

  /** The surfaces as drawn: one quad each, its corners at its patch's corners in the atlas. */
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

  private resolve(renderer: WebGLRenderer): void {
    this.pass(renderer, this.atlas, this.resolveMaterial);
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
          for (const t of [this.accum, this.best, this.atlas]) {
            renderer.setRenderTarget(t);
            renderer.setClearColor(new Color(0, 0, 0), 0);
            renderer.clear();
          }
          this.resolve(renderer);
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
        this.sinceResolve++;
        if (this.sinceResolve >= PHOTO.resolveEvery || this.painted <= 2) {
          this.sinceResolve = 0;
          this.resolve(renderer);
        }
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

  /** Each surface's unseen texels take its median colour, then the atlas is drawn for good. */
  private finish(renderer: WebGLRenderer): void {
    const px = PHOTO.atlasPx;
    const small = 512;
    const k = px / small;
    const down = new WebGLRenderTarget(small, small, { type: HalfFloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
    const average = new ShaderMaterial({
      uniforms: { uAccum: { value: this.accum.texture } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
uniform sampler2D uAccum;
varying vec2 vUv;
void main() {
  vec4 sum = vec4(0.0);
  vec2 base = floor(vUv * ${small.toFixed(1)}) * ${k.toFixed(1)};
  for (int y = 0; y < ${k}; y++) {
    for (int x = 0; x < ${k}; x++) {
      vec4 a = texelFetch(uAccum, ivec2(base) + ivec2(x, y), 0);
      if (a.a > 1e-3) sum += vec4(a.rgb / a.a, 1.0);
    }
  }
  gl_FragColor = sum.a > 0.0 ? vec4(sum.rgb / sum.a, 1.0) : vec4(0.0);
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
    const raw = new Uint16Array(small * small * 4);
    renderer.readRenderTargetPixels(down, 0, 0, small, small, raw);
    down.dispose();
    average.dispose();
    quad.geometry.dispose();
    const fallback = this.bakeGeometry.getAttribute("fallback") as BufferAttribute;
    this.surfaces.forEach((s, si) => {
      const values: [number, number, number][] = [];
      for (let y = Math.floor(s.y / k); y < Math.ceil((s.y + s.ph) / k); y++) {
        for (let x = Math.floor(s.x / k); x < Math.ceil((s.x + s.pw) / k); x++) {
          const o = (y * small + x) * 4;
          if (DataUtils.fromHalfFloat(raw[o + 3]) <= 0) continue;
          values.push([DataUtils.fromHalfFloat(raw[o]), DataUtils.fromHalfFloat(raw[o + 1]), DataUtils.fromHalfFloat(raw[o + 2])]);
        }
      }
      if (values.length === 0) return;
      const median = [0, 1, 2].map((c) => values.map((v) => v[c]).sort((p, q) => p - q)[Math.floor(values.length / 2)]);
      for (let vtx = 0; vtx < 6; vtx++) fallback.setXYZ(si * 6 + vtx, median[0], median[1], median[2]);
    });
    fallback.needsUpdate = true;
    this.resolve(renderer);
    this.finished = true;
    this.seconds = (performance.now() - this.started) / 1000;
    // What only the painting needed.
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
    this.accum.dispose();
    this.best.dispose();
    for (const d of this.depths) d?.dispose();
    this.bakeGeometry.dispose();
    (this.group.children[0] as Mesh | undefined)?.geometry.dispose();
    this.drawMaterial.dispose();
    this.scoreMaterial.dispose();
    this.paintMaterial.dispose();
    this.resolveMaterial.dispose();
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
