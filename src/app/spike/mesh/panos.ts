// The panoramas around the player, in GPU memory (issue 118). Loads the
// nearest few lazily, keeps a small least-recently-used set, and each frame
// says which four the mesh's material should blend and by how much.
//
// A panorama is two cube maps: its six photos, and a depth cube rendered once
// from its position, which says how far it could see in every direction.
// Faces are fetched with `cache: "no-store"` and decoded straight to bitmaps:
// they live in memory only, and are closed as soon as the GPU has them.
import {
  BackSide,
  BoxGeometry,
  CubeTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
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
import { CUBE_LOOKUP_FLIP, cubeLayout, panoDistance, panoWeights } from "@/lib/scan-mesh/skybox";
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
  depth: WebGLCubeRenderTarget | null;
  origin: Vector3;
  toPano: Matrix3;
  share: number;
  lastWanted: number;
  attempts: number;
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
  private readonly layout = cubeLayout();
  private readonly depthScene = new Scene();
  private readonly depthMaterial = createDistanceMaterial();
  private readonly depthCamera = new PerspectiveCamera(90, 1, 0.05, 4000);
  private readonly far: Mesh;
  private readonly abort = new AbortController();
  /** Called when a face link is refused or has run out: the engine fetches new links. */
  onStale: (() => void) | null = null;

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
        const toPano = new Matrix3().fromArray(quatToMat3(conjugate(pano.rotation)));
        // Row r of the matrix is scaled by the lookup's flip on axis r.
        const e = toPano.elements;
        for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) e[col * 3 + row] *= CUBE_LOOKUP_FLIP[row];
        return {
          pano,
          index,
          status: "idle" as Status,
          cube: null,
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
   * `linksUsable` is false while the links have run out and new ones are on
   * their way. Returns what is in use, strongest first.
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
    const ranked = entries
      .filter((e) => e.pano.faces !== null)
      .map((e) => ({ e, d: panoDistance(eye, e.pano.position) }))
      .sort((a, b) => a.d - b.d);

    for (const { e } of ranked.slice(0, LOAD_AHEAD)) {
      e.lastWanted = now;
      if (e.status === "idle" && this.loading < CONCURRENT && linksUsable) void this.load(e);
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
    e.cube?.dispose();
    e.depth?.dispose();
    e.cube = null;
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
          return createImageBitmap(await response.blob());
        }),
      );
      if (this.disposed) return;
      const images = this.layout.map((slot) => {
        const source = bitmaps[slot.face];
        if (slot.identity) return source;
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d canvas");
        const [a, b, c, d] = slot.transform;
        context.setTransform(a, b, c, d, source.width / 2, source.height / 2);
        context.drawImage(source, -source.width / 2, -source.height / 2);
        return canvas;
      });
      const cube = new CubeTexture(images);
      cube.colorSpace = NoColorSpace;
      cube.generateMipmaps = true;
      cube.minFilter = LinearMipmapLinearFilter;
      cube.magFilter = LinearFilter;
      cube.needsUpdate = true;
      this.renderer.initTexture(cube);
      e.cube = cube;
      e.depth = this.renderDepth(e.origin);
      e.share = 0;
      e.status = "ready";
    } catch {
      if (this.disposed) return;
      // Most likely a link that ran out: ask for new ones and try again.
      e.status = "failed";
      this.onStale?.();
    } finally {
      for (const bitmap of bitmaps) bitmap.close();
      this.loading--;
    }
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
    for (const e of this.entries) this.release(e);
    this.entries = [];
    this.depthMaterial.dispose();
    (this.far.material as ShaderMaterial).dispose();
    this.far.geometry.dispose();
  }
}
