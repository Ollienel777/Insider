// The panoramas around the player, in GPU memory (issue 118). Loads the
// nearest few lazily, keeps a small least-recently-used set, and each frame
// says which four the mesh's material should blend and by how much.
//
// A panorama is two cube maps: its six photos, and a depth cube rendered once
// from its position, which says how far it could see in every direction.
// Faces are fetched with `cache: "no-store"` and decoded straight to bitmaps:
// they live in memory only, and are closed as soon as the GPU has them.
//
// A 2k panorama is 100 MB of texels. Handing all six faces to the GPU in one
// go stalls the frame for a third of a second or more, which is a hitch every
// few steps of a run. So the photo cube is filled by hand, one face a frame,
// and its smaller copies are made on the frame after: no frame carries more
// than one face.
import {
  BackSide,
  BoxGeometry,
  CubeTexture,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  NoColorSpace,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  Vector3,
  WebGLCubeRenderTarget,
  type BufferGeometry,
  type ShaderMaterial,
  type WebGLRenderer,
} from "three";
import { conjugate, quatToMat3 } from "@/lib/scan-mesh/coords";
import { isAllowedAssetUrl, type ScanPano } from "@/lib/scan-mesh/manifest";
import { alignToCube, CUBE_LOOKUP_FLIP, panoDistance, panoWeights } from "@/lib/scan-mesh/skybox";
import { createDistanceMaterial, SLOTS } from "./projection";

/** Panoramas loaded ahead of need, nearest first. */
const LOAD_AHEAD = 4;
/** Panoramas blended for one standpoint. */
const KEEP = 3;
/** Fetches of whole panoramas at once. */
const CONCURRENT = 2;
/** How quickly a panorama's share follows its target, per second. */
const SHARE_RATE = 7;
const DEPTH_SIZE = 512;

type Status = "idle" | "loading" | "ready" | "failed";

interface Entry {
  pano: ScanPano;
  index: number;
  status: Status;
  cube: CubeTexture | null;
  /** The GPU texture behind `cube`: made and filled here, not by three.js. */
  raw: WebGLTexture | null;
  depth: WebGLCubeRenderTarget | null;
  origin: Vector3;
  toPano: Matrix3;
  share: number;
  lastWanted: number;
  attempts: number;
}

/** A panorama's photos on their way into the GPU, a face a frame. */
interface Upload {
  entry: Entry;
  raw: WebGLTexture;
  /** One image per GPU cube slot. */
  images: (ImageBitmap | HTMLCanvasElement)[];
  bitmaps: ImageBitmap[];
  /** The next slot to fill; 6 once only the smaller copies are left to make. */
  next: number;
}

export interface PanoUse {
  /** The panorama's place in the scan's list. */
  index: number;
  share: number;
}

/** The camera for each GPU cube face, +x -x +y -y +z -z: where it looks and its up. */
const CUBE_CAMERAS: readonly [Vector3, Vector3][] = [
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0)],
  [new Vector3(0, 1, 0), new Vector3(0, 0, 1)],
  [new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0)],
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
];

export function blankCube(): CubeTexture {
  const pixel = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas;
  };
  const cube = new CubeTexture(Array.from({ length: 6 }, pixel));
  cube.colorSpace = NoColorSpace;
  cube.needsUpdate = true;
  return cube;
}

export class PanoStore {
  private entries: Entry[] = [];
  private loading = 0;
  private disposed = false;
  private readonly align = alignToCube();
  private uploads: Upload[] = [];
  private readonly depthScene = new Scene();
  private readonly depthMaterial = createDistanceMaterial();
  private readonly depthCamera = new PerspectiveCamera(90, 1, 0.05, 4000);
  private readonly far: Mesh;
  private readonly abort = new AbortController();
  /** Called when a face link is refused: the engine fetches new links. */
  onStale: (() => void) | null = null;
  /** Set by `update` when a panorama is waiting to load and the links have run out. */
  needsLinks = false;

  constructor(
    private readonly renderer: WebGLRenderer,
    geometry: BufferGeometry,
    private readonly capacity: number,
  ) {
    this.depthScene.add(new Mesh(geometry, this.depthMaterial));
    // What a panorama sees through a hole in the mesh is far away, not nothing.
    const farMaterial = createDistanceMaterial();
    farMaterial.side = BackSide;
    this.far = new Mesh(new BoxGeometry(2000, 2000, 2000), farMaterial);
    this.depthScene.add(this.far);
  }

  setPanos(panos: readonly ScanPano[]): void {
    if (this.entries.length === 0) {
      this.entries = panos.map((pano, index) => {
        // World to the panorama's own frame, then the turn that lines the scan's
        // faces up with the GPU's, then the lookup's flip.
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
        const toPano = new Matrix3().fromArray(elements);
        return {
          pano,
          index,
          status: "idle" as Status,
          cube: null,
          raw: null,
          depth: null,
          origin: new Vector3(...pano.position),
          toPano,
          share: 0,
          lastWanted: 0,
          attempts: 0,
        };
      });
      return;
    }
    // Fresh links for the same scan: keep what is loaded, swap the links.
    const byId = new Map(panos.map((p) => [p.id, p]));
    for (const entry of this.entries) {
      const fresh = byId.get(entry.pano.id);
      if (!fresh) continue;
      entry.pano = { ...entry.pano, faces: fresh.faces, resolution: fresh.resolution };
      if (entry.status === "failed" && entry.attempts < 3) entry.status = "idle";
    }
  }

  get count(): number {
    return this.entries.length;
  }

  counts(): { ready: number; loading: number; failed: number } {
    let ready = 0;
    let failed = 0;
    for (const e of this.entries) {
      if (e.status === "ready") ready++;
      if (e.status === "failed") failed++;
    }
    return { ready, loading: this.loading, failed };
  }

  /** The panorama nearest `eye`, by index, or -1. */
  nearest(eye: readonly [number, number, number]): number {
    let best = -1;
    let least = Infinity;
    for (const e of this.entries) {
      const d = panoDistance(eye, e.pano.position);
      if (d < least) {
        least = d;
        best = e.index;
      }
    }
    return best;
  }

  /**
   * One frame: start what should be loading, move the shares toward their
   * targets, and write the four strongest panoramas into `materials`.
   * `linksUsable` is false once the links have run out; `needsLinks` then says
   * whether anything is waiting on new ones. Returns what is in use, strongest
   * first.
   */
  update(
    eye: readonly [number, number, number],
    dt: number,
    now: number,
    materials: readonly ShaderMaterial[],
    blank: CubeTexture,
    linksUsable: boolean,
  ): PanoUse[] {
    const entries = this.entries;
    if (entries.length === 0) return [];
    this.pump();
    const ranked = entries
      .filter((e) => e.pano.faces !== null)
      .map((e) => ({ e, d: panoDistance(eye, e.pano.position) }))
      .sort((a, b) => a.d - b.d);

    this.needsLinks = false;
    for (const { e } of ranked.slice(0, LOAD_AHEAD)) {
      e.lastWanted = now;
      if (e.status !== "idle") continue;
      if (!linksUsable) this.needsLinks = true;
      else if (this.loading < CONCURRENT) void this.load(e);
    }

    const ready = ranked.filter(({ e }) => e.status === "ready");
    const targets = panoWeights(
      ready.map(({ d }) => d),
      KEEP,
    );
    const blend = 1 - Math.exp(-SHARE_RATE * dt);
    const target = new Map<Entry, number>();
    ready.forEach(({ e }, i) => target.set(e, targets[i]));
    for (const e of entries) {
      if (e.status !== "ready") continue;
      e.share += ((target.get(e) ?? 0) - e.share) * blend;
      if (e.share < 1e-4 && (target.get(e) ?? 0) === 0) e.share = 0;
      if (e.share > 0) e.lastWanted = now;
    }

    this.evict();

    const used = entries
      .filter((e) => e.status === "ready" && e.share > 0)
      .sort((a, b) => b.share - a.share)
      .slice(0, SLOTS);
    for (const material of materials) {
      const u = material.uniforms;
      for (let slot = 0; slot < SLOTS; slot++) {
        const e = used[slot];
        u[`uPano${slot}`].value = e?.cube ?? blank;
        u[`uDepth${slot}`].value = e?.depth?.texture ?? blank;
        (u.uPanoShare.value as number[])[slot] = e ? e.share : 0;
        if (e) {
          (u.uPanoPos.value as Vector3[])[slot].copy(e.origin);
          (u.uPanoInv.value as Matrix3[])[slot].copy(e.toPano);
        }
      }
    }
    return used.map((e) => ({ index: e.index, share: e.share }));
  }

  private evict(): void {
    const loaded = this.entries.filter((e) => e.status === "ready");
    if (loaded.length <= this.capacity) return;
    loaded.sort((a, b) => a.lastWanted - b.lastWanted);
    for (const e of loaded.slice(0, loaded.length - this.capacity)) {
      if (e.share > 0) continue;
      this.release(e);
      e.status = "idle";
    }
  }

  private release(e: Entry): void {
    if (e.cube) this.renderer.properties.remove(e.cube);
    if (e.raw) this.renderer.getContext().deleteTexture(e.raw);
    e.depth?.dispose();
    e.cube = null;
    e.raw = null;
    e.depth = null;
    e.share = 0;
  }

  private async load(e: Entry): Promise<void> {
    const faces = e.pano.faces;
    if (!faces || !faces.every(isAllowedAssetUrl)) {
      e.status = "failed";
      return;
    }
    e.status = "loading";
    e.attempts++;
    this.loading++;
    let bitmaps: ImageBitmap[] = [];
    try {
      bitmaps = await Promise.all(
        faces.map(async (url) => {
          const response = await fetch(url, {
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: this.abort.signal,
          });
          if (!response.ok) throw new Error(`face ${response.status}`);
          // Decoded off the main thread, in the form the GPU takes as it is.
          return createImageBitmap(await response.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
        }),
      );
      if (this.disposed) throw new Error("gone");
      const size = bitmaps[0].width;
      if (!bitmaps.every((b) => b.width === size && b.height === size)) throw new Error("faces differ in size");
      const images = this.align.layout.map((slot) => {
        const source = bitmaps[slot.face];
        if (slot.identity) return source;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d canvas");
        const [a, b, c, d] = slot.transform;
        context.setTransform(a, b, c, d, size / 2, size / 2);
        context.drawImage(source, -size / 2, -size / 2);
        return canvas;
      });
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const raw = gl.createTexture();
      if (!raw) throw new Error("no texture");
      this.renderer.state.bindTexture(gl.TEXTURE_CUBE_MAP, raw);
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, Math.floor(Math.log2(size)) + 1, gl.RGBA8, size, size);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.renderer.state.unbindTexture();
      this.uploads.push({ entry: e, raw, images, bitmaps, next: 0 });
    } catch {
      for (const bitmap of bitmaps) bitmap.close();
      this.loading--;
      if (this.disposed) return;
      // Most likely a link that ran out: ask for new ones and try again.
      e.status = "failed";
      this.onStale?.();
    }
  }

  /** One step of the upload at the head of the queue: a face, or the smaller copies and the depth cube. */
  private pump(): void {
    const job = this.uploads[0];
    if (!job) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const state = this.renderer.state;
    state.bindTexture(gl.TEXTURE_CUBE_MAP, job.raw);
    if (job.next < 6) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + job.next, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, job.images[job.next]);
      state.unbindTexture();
      job.next++;
      return;
    }
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    state.unbindTexture();
    this.uploads.shift();
    for (const bitmap of job.bitmaps) bitmap.close();
    this.loading--;

    // three.js binds this texture and never uploads to it: it has no version.
    const e = job.entry;
    const cube = new CubeTexture();
    cube.colorSpace = NoColorSpace;
    const properties = this.renderer.properties.get(cube) as { __webglTexture?: WebGLTexture; __webglInit?: boolean };
    properties.__webglTexture = job.raw;
    properties.__webglInit = true;
    e.cube = cube;
    e.raw = job.raw;
    e.depth = this.renderDepth(e.origin);
    e.share = 0;
    e.status = "ready";
  }

  /** How far the mesh is from `origin` in every direction, as a cube map. */
  private renderDepth(origin: Vector3): WebGLCubeRenderTarget {
    const target = new WebGLCubeRenderTarget(DEPTH_SIZE, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    const renderer = this.renderer;
    const before = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const level = renderer.getActiveMipmapLevel();
    this.depthMaterial.uniforms.uOrigin.value.copy(origin);
    (this.far.material as ShaderMaterial).uniforms.uOrigin.value.copy(origin);
    this.far.position.copy(origin);
    this.far.updateMatrixWorld();
    const camera = this.depthCamera;
    camera.position.copy(origin);
    CUBE_CAMERAS.forEach(([look, up], i) => {
      camera.up.copy(up);
      camera.lookAt(origin.x + look.x, origin.y + look.y, origin.z + look.z);
      camera.updateMatrixWorld();
      renderer.setRenderTarget(target, i);
      renderer.clear();
      renderer.render(this.depthScene, camera);
    });
    renderer.setRenderTarget(before, face, level);
    return target;
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    for (const job of this.uploads) {
      this.renderer.getContext().deleteTexture(job.raw);
      for (const bitmap of job.bitmaps) bitmap.close();
    }
    this.uploads = [];
    for (const e of this.entries) this.release(e);
    this.entries = [];
    this.depthMaterial.dispose();
    (this.far.material as ShaderMaterial).dispose();
    this.far.geometry.dispose();
  }
}
