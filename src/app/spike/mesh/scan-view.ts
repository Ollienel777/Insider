// One scan, drawn from wherever the caller puts the eye (issue 118).
//
// The renderer the free-walk sandbox runs on, with no input, movement or
// frame loop of its own, so a game's first-person view can drive it the same
// way: give it a canvas and a scan, then each frame `setPose` and `render`.
// It loads the scan's mesh and panoramas, paints the mesh from them, and
// answers the two questions a walking controller asks of the floor and walls
// (`world`: lib/scan-mesh/movement.ts's MoveWorld). All of the scan lives in
// this tab's memory; nothing is stored.
//
// Frame: the scan's, y-up, metres. Yaw 0 looks down -z and grows turning
// left; pitch grows looking up (three.js's camera convention).
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Ray,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type CubeTexture,
  type ShaderMaterial,
} from "three";
import type { BlendMode } from "@/lib/scan-mesh/blend";
import type { Vec3 } from "@/lib/scan-mesh/coords";
import {
  isAllowedAssetUrl,
  type MeshResolution,
  type PanoResolution,
  type ScanDetail,
  type ScanManifest,
} from "@/lib/scan-mesh/manifest";
import { fitLevels, type LevelSample } from "@/lib/scan-mesh/levels";
import { TUNING, type MoveWorld } from "@/lib/scan-mesh/movement";
import { parseObj } from "@/lib/scan-mesh/obj";
import { feetUnder, linksFresh, poseVelocity, sharpLayer, viewStats, type ScanPose, type ViewStats } from "@/lib/scan-mesh/pose";
import { distanceToGroup, type TexturedGroup } from "@/lib/scan-mesh/textured";
import { MeshWorld } from "./collider";
import type { DetailReply, DetailRequest } from "./detail-worker";
import { matchExposure } from "./exposure-match";
import { HoleFill } from "./hole-fill";
import { blankCube, PanoStore, type PanoCounts, type PanoUse } from "./panos";
import { createPhotoMaterial, createPhotoUniforms, type PhotoUniforms } from "./photo-material";
import { createScanMaterial, SLOTS } from "./projection";

export type { ScanPose } from "@/lib/scan-mesh/pose";
export { eyePose, yawFromHeading } from "@/lib/scan-mesh/pose";

export type ScanPhase = "manifest" | "mesh" | "building" | "ready" | "no-mesh" | "error";

export interface ScanViewOptions {
  modelId: string;
  /** Panorama sharpness: `2k` by default. */
  faces?: PanoResolution;
  /** The walkable mesh: `50k` by default. */
  mesh?: MeshResolution;
  /** Whether to load the Matterpak's detailed mesh for the picture, where the scan has one. Default true. */
  detail?: boolean;
  /**
   * Whether the detailed mesh has the Matterpak's own textures under the
   * panoramas: a surface no panorama near the eye saw shows its texture.
   * Default true; off, the panoramas alone paint it, as they do the 50k mesh.
   */
  textured?: boolean;
  /** Whether to fill what no scanned surface covers from the pixels around it, and close the mesh's small holes. Default true. */
  fill?: boolean;
  /** Vertical field of view, degrees. */
  fov?: number;
  /** Called whenever `status()` has news: a phase, the detailed mesh, the exposure match. */
  onChange?: () => void;
}

export interface ScanDetailStatus {
  state: "none" | "loading" | "ready" | "failed" | "off";
  triangles: number;
  megabytes: number;
  seconds: number;
  reason?: string;
  /** The Matterpak's textures: how many, how many are in (small, and full size near the eye), and whether all have been fetched. */
  textures?: ScanTextureStatus;
  /** Small holes in the detailed mesh that were closed. */
  holes?: number;
}

export interface ScanTextureStatus {
  total: number;
  small: number;
  sharp: number;
  megabytes: number;
  /** Seconds from the mesh's arrival to every texture fetched. */
  seconds: number;
  done: boolean;
  /** What the textures take on the GPU, roughly, megabytes. */
  gpuMegabytes: number;
}

export interface ScanExposureStatus {
  pairs: number;
  low: number;
  high: number;
  on: boolean;
  before: number;
  after: number;
}

export interface ScanViewStatus {
  phase: ScanPhase;
  /** A line for the player when the phase is `error` or `no-mesh`. */
  message: string | null;
  triangles: number;
  panoCount: number;
  detail: ScanDetailStatus;
  exposure: ScanExposureStatus | null;
  /** Seconds each loading step took, and the mesh file's size. */
  timings: { manifest: number | null; download: number | null; megabytes: number | null; build: number | null };
}

/** The renderer's own fixes to the blend (lib/scan-mesh/combine.ts), on by default; off only to compare. */
export interface ScanFixes {
  agree: boolean;
  fill: boolean;
}

/** Vertical field of view: about 103° across on a 16:9 screen, a shooter's default. */
export const DEFAULT_FOV = 71;
/** Fetch new links when the current ones have this little time left, ms. */
const LINK_MARGIN = 20_000;
const MEASURE_WIDTH = 160;
const MEASURE_HEIGHT = 90;
/** The textures are first decoded this many pixels square: all of them fit in GPU memory at once. */
const SMALL_TEXTURE = 512;
/** Textures of surfaces this close to the eye, metres, are shown sharper, this many pixels square... */
const SHARP_REACH = 4;
const SHARP_TEXTURE = 1024;
/** ...this many at most (each about 5.6 MB of GPU memory)... */
const SHARP_MAX = 12;
/** ...chosen again this often, seconds. */
const SHARP_EVERY = 0.3;
/** Textures put on the GPU in one frame at most: small ones, and full-size ones. */
const UPLOADS_SMALL = 4;
const UPLOADS_SHARP = 1;
/** Full-size panorama cubes kept on the GPU beside the textures, at most (each 2k one is about 134 MB). */
const SHARP_CUBES = 5;
const SOURCE_WIDTH = 160;
const SOURCE_HEIGHT = 90;

/** What paints the view, as parts of the frame (they sum to 1). */
export interface ViewSources {
  /** No surface at all: the panoramas' far view shows (a window, or a gap nothing closes). */
  void: number;
  /** A surface painted from the panoramas. */
  pano: number;
  /** The mesh's own texture, where no panorama near the eye saw the surface. */
  texture: number;
  /** A stand-in's own texture, made from the surface round it. */
  synth: number;
  /** A stand-in nothing painted: filled from the pixels around it. */
  smear: number;
  /** Stand-ins altogether (closed holes, planes carried across gaps), however painted. */
  standin: number;
}

class LoadError extends Error {}

export class ScanView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  /** Resolves true once the scan can be walked and drawn, false if it can't. */
  readonly ready: Promise<boolean>;
  private readonly blank: CubeTexture;
  /** The panoramas alone, for a mesh with no texture of its own: the 50k mesh, shown until the detailed one is in. */
  private readonly material: ShaderMaterial;
  /** The panoramas' uniforms, shared by every material that paints by the photo rule (photo-material.ts). */
  private readonly photo: PhotoUniforms;
  private readonly backdropMaterial: ShaderMaterial;
  private readonly backdrop: Mesh;
  private readonly abort = new AbortController();
  private readonly faces: PanoResolution;
  private readonly meshResolution: MeshResolution;
  /** The walkable mesh (collision, floors), and the one drawn: the detailed mesh once it is in. */
  private geometry: BufferGeometry | null = null;
  private drawn: Mesh | null = null;
  private detailGeometry: BufferGeometry | null = null;
  private detailWorker: Worker | null = null;
  private wire: Mesh | null = null;
  private meshWorld: MeshWorld | null = null;
  private panos: PanoStore | null = null;
  private manifest: ScanManifest | null = null;
  private refreshing = false;
  private exposureStarted = false;
  private disposed = false;
  private pose: ScanPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private lastPose: ScanPose | null = null;
  /** Set by the caller for this frame, else worked out from the last two poses. */
  private velocity: [number, number] | null = null;
  private used: PanoUse[] = [];
  private readonly state: ScanViewStatus;
  /** The textured mesh: its groups, each one's material and textures, and what has arrived but isn't on the GPU yet. */
  private groups: TexturedGroup[] = [];
  private groupMaterials: ShaderMaterial[] = [];
  private small: (Texture | null)[] = [];
  private sharp: (Texture | null)[] = [];
  private sharpWanted = new Set<number>();
  private sharpClock = 0;
  private arrived: { group: number; sharp: boolean; image: ImageBitmap }[] = [];
  private readonly fill: HoleFill | null;
  private readonly fillMaterial: ShaderMaterial;
  private fillMeshes: Mesh[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: ScanViewOptions,
  ) {
    this.faces = options.faces ?? "2k";
    this.meshResolution = options.mesh ?? "50k";
    this.camera = new PerspectiveCamera(options.fov ?? DEFAULT_FOV, 1, 0.05, 3000);
    this.camera.rotation.order = "YXZ";
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.fill = options.fill === false ? null : new HoleFill(this.renderer);
    // Alpha 0 marks a pixel no surface covered, for the fill.
    this.renderer.setClearColor(new Color().setRGB(0.027, 0.035, 0.047), this.fill ? 0 : 1);
    this.blank = blankCube();
    this.material = createScanMaterial(this.blank);
    this.photo = createPhotoUniforms(this.blank);
    this.backdropMaterial = createPhotoMaterial(this.photo, "backdrop");
    this.fillMaterial = createPhotoMaterial(this.photo, "stand-in");
    this.backdrop = new Mesh(new BoxGeometry(1000, 1000, 1000), this.backdropMaterial);
    this.backdrop.renderOrder = -1;
    this.backdrop.frustumCulled = false;
    this.scene.add(this.backdrop);
    this.state = {
      phase: "manifest",
      message: null,
      triangles: 0,
      panoCount: 0,
      detail: { state: "none", triangles: 0, megabytes: 0, seconds: 0 },
      exposure: null,
      timings: { manifest: null, download: null, megabytes: null, build: null },
    };
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
    this.ready = this.load();
  }

  // ---- the caller's side ----

  /** Where the eye is and where it looks, for the next `render`. `velocity` (m/s, x and z) helps the panoramas ahead load first. */
  setPose(pose: ScanPose, velocity?: readonly [number, number]): void {
    this.pose = { ...pose };
    this.velocity = velocity ? [velocity[0], velocity[1]] : null;
  }

  /** Draws the scan from the last pose. `dt` is the seconds since the last frame (it paces the blend's fades). */
  render(dt = 1 / 60): void {
    if (this.disposed) return;
    const { x, y, z, yaw, pitch } = this.pose;
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.backdrop.position.copy(this.camera.position);
    const velocity = this.velocity ?? poseVelocity(this.lastPose, this.pose, dt);
    this.lastPose = { ...this.pose };
    this.velocity = null;
    this.showTextures(dt);
    if (this.panos) {
      this.used = this.panos.update(
        [x, y, z],
        velocity,
        dt,
        [this.material, { uniforms: this.photo }],
        this.blank,
        this.linksUsable(),
      );
      if (this.panos.needsLinks) void this.refreshLinks();
      this.startExposure();
    }
    this.draw(null);
  }

  /** Renders the current view to `target` (null: the screen), filled where no surface covers it. */
  draw(target: WebGLRenderTarget | null): void {
    if (this.fill) {
      this.fill.render(this.scene, this.camera, target);
      return;
    }
    const before = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(before);
  }

  /** The drawing size, CSS pixels. */
  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** The floor and walls, for a walking controller (null until the mesh is in). */
  get world(): MoveWorld | null {
    return this.meshWorld;
  }

  /** The floor's height under (x, z), searching down from `fromY` at most `depth` metres; null over a hole. */
  floorAt(x: number, fromY: number, z: number, depth = 3): number | null {
    return this.meshWorld?.floorBelow(x, fromY, z, depth) ?? null;
  }

  /** The scan positions, y-up, in the scan's order: where the picture is exact. */
  scanPositions(): Vec3[] {
    return (this.manifest?.panos ?? []).map((p) => p.position);
  }

  /** Where the feet stand under scan position `index`, or null. */
  feetAt(index: number): Vec3 | null {
    const pano = this.manifest?.panos[index];
    if (!pano) return null;
    const [x, y, z] = pano.position;
    return feetUnder(pano.position, this.floorAt(x, y, z, 3), pano.floor);
  }

  /** The scan position nearest `eye`, by index, or -1. */
  nearestScan(eye: Vec3): number {
    if (this.panos) return this.panos.nearest(eye);
    let best = -1;
    let near = Infinity;
    (this.manifest?.panos ?? []).forEach((p, i) => {
      const d = Math.hypot(p.position[0] - eye[0], p.position[1] - eye[1], p.position[2] - eye[2]);
      if (d < near) {
        near = d;
        best = i;
      }
    });
    return best;
  }

  /** Whether the picture around `eye` has arrived, so a player can be let loose there. */
  settled(eye: Vec3): boolean {
    if (this.groups.length > 0) {
      // The textured mesh: settled once the textures near the eye are in.
      return this.groups.every((g, i) => this.small[i] !== null || !g.image || distanceToGroup(g, eye) > SHARP_REACH || this.state.detail.textures?.done);
    }
    return !this.panos || this.panos.settled(eye);
  }

  status(): ScanViewStatus {
    return {
      ...this.state,
      detail: { ...this.state.detail, textures: this.state.detail.textures ? { ...this.state.detail.textures } : undefined },
      exposure: this.state.exposure ? { ...this.state.exposure } : null,
      timings: { ...this.state.timings },
    };
  }

  /** The panoramas in the blend this frame, strongest first. */
  inUse(): PanoUse[] {
    return this.used;
  }

  counts(): PanoCounts | null {
    return this.panos?.counts() ?? null;
  }

  // ---- looks, to compare and to debug ----

  /** 1 shows the panoramas, 0 the bare mesh, and in between a mix. */
  setProjection(amount: number): void {
    this.material.uniforms.uProjection.value = amount;
    this.photo.uProjection.value = amount;
  }

  setBlend(mode: BlendMode): void {
    if (this.panos) this.panos.mode = mode;
  }

  get blend(): BlendMode {
    return this.panos?.mode ?? "photo";
  }

  /** Apply the exposure gains or not: to see what they do. */
  setExposure(on: boolean): void {
    if (this.panos) this.panos.useGains = on;
    if (this.state.exposure) this.state.exposure = { ...this.state.exposure, on };
  }

  setFixes(fixes: Partial<ScanFixes>): void {
    if (fixes.agree !== undefined) this.material.uniforms.uAgree.value = fixes.agree ? 1 : 0;
    if (fixes.fill !== undefined) this.material.uniforms.uFill.value = fixes.fill ? 1 : 0;
  }

  /** 0 the picture, 1 the coverage, 2 the doubles (projection.ts says what the colours mean). */
  setDebugView(mode: number): void {
    this.material.uniforms.uDebug.value = mode;
  }

  /** The mesh's edges over the picture: how to judge whether the panoramas line up. */
  toggleWire(): void {
    if (!this.geometry) return;
    if (this.wire) {
      this.scene.remove(this.wire);
      (this.wire.material as MeshBasicMaterial).dispose();
      this.wire = null;
      return;
    }
    const material = new MeshBasicMaterial({
      color: new Color().setRGB(0.95, 0.66, 0.23),
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.wire = new Mesh(this.drawn?.geometry ?? this.geometry, material);
    this.scene.add(this.wire);
  }

  /** The current view's coverage and doubles, from a small copy rendered in the debug looks (lib/scan-mesh/pose.ts's `viewStats`). */
  measure(): ViewStats {
    if (this.groups.length > 0) {
      // The photo rule: one panorama a point, so nothing doubles; what no panorama saw has its texture.
      const sources = this.measureSources();
      return { mesh: 1 - sources.void - sources.standin, unseen: 0, unseenNear: 0, unseenClose: 0, unseenMixed: 0, ghost: 0, spread: 0, doubled: 0, filled: sources.void };
    }
    const target = new WebGLRenderTarget(MEASURE_WIDTH, MEASURE_HEIGHT);
    const pixels = new Uint8Array(MEASURE_WIDTH * MEASURE_HEIGHT * 4);
    const coverage = new Uint8Array(pixels.length);
    const before = this.renderer.getRenderTarget();
    const debug = this.material.uniforms.uDebug.value;
    this.backdrop.visible = false;
    try {
      this.renderer.setRenderTarget(target);
      for (const [mode, out] of [
        [1, coverage],
        [2, pixels],
      ] as const) {
        this.material.uniforms.uDebug.value = mode;
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        this.renderer.readRenderTargetPixels(target, 0, 0, MEASURE_WIDTH, MEASURE_HEIGHT, out);
      }
    } finally {
      this.material.uniforms.uDebug.value = debug;
      this.backdrop.visible = true;
      this.renderer.setRenderTarget(before);
      target.dispose();
    }
    return viewStats(coverage, pixels);
  }

  // ---- loading ----

  private push(): void {
    if (!this.disposed) this.options.onChange?.();
  }

  private async fetchManifest(): Promise<ScanManifest> {
    // The id goes in the body so the server's request log never shows it.
    const response = await fetch("/api/scan-mesh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ m: this.options.modelId, faces: this.faces, mesh: this.meshResolution }),
      cache: "no-store",
      signal: this.abort.signal,
    });
    const body = (await response.json().catch(() => null)) as (ScanManifest & { message?: string }) | null;
    if (!response.ok || !body) {
      throw new LoadError(body?.message ?? "The scan couldn't be loaded.");
    }
    return body;
  }

  private async load(): Promise<boolean> {
    const state = this.state;
    try {
      let at = performance.now();
      const manifest = await this.fetchManifest();
      if (this.disposed) return false;
      this.manifest = manifest;
      state.timings.manifest = (performance.now() - at) / 1000;
      state.panoCount = manifest.panos.length;
      if (!manifest.mesh || !isAllowedAssetUrl(manifest.mesh.url)) {
        state.phase = "no-mesh";
        state.message = "No mesh for this scan. It can only be toured in the embedded viewer.";
        this.push();
        return false;
      }

      state.phase = "mesh";
      this.push();
      at = performance.now();
      const response = await fetch(manifest.mesh.url, {
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: this.abort.signal,
      });
      if (!response.ok) throw new LoadError("The scan's mesh couldn't be downloaded. Reload to try again.");
      const text = await response.text();
      if (this.disposed) return false;
      state.timings.download = (performance.now() - at) / 1000;
      state.timings.megabytes = text.length / 1e6;

      state.phase = "building";
      this.push();
      // Let the caller paint before the parse holds the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      at = performance.now();
      const parsed = parseObj(text);
      if (parsed.index.length === 0) {
        state.phase = "no-mesh";
        state.message = "This scan's mesh is empty.";
        this.push();
        return false;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(parsed.positions, 3));
      geometry.setIndex(new BufferAttribute(parsed.index, 1));
      geometry.computeBoundingSphere();
      this.geometry = geometry;
      this.meshWorld = new MeshWorld(geometry, TUNING.stepUp);
      this.addLevels(this.meshWorld);
      state.timings.build = (performance.now() - at) / 1000;
      state.triangles = parsed.index.length / 3;
      this.drawn = new Mesh(geometry, this.material);
      this.scene.add(this.drawn);

      const sharp = sharpLayer(this.faces);
      this.panos = new PanoStore(this.renderer, geometry, Math.min(sharp.capacity, SHARP_CUBES), sharp.size);
      this.panos.onStale = () => void this.refreshLinks();
      const sight = new Ray();
      const world = this.meshWorld;
      this.panos.blocked = (eye, origin) => {
        sight.origin.set(eye[0], eye[1], eye[2]);
        sight.direction.set(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]);
        const reach = sight.direction.length();
        sight.direction.divideScalar(Math.max(reach, 1e-6));
        return world.bvh.raycastFirst(sight, DoubleSide, 0, Math.max(0, reach - 0.3)) !== null;
      };
      this.panos.setPanos(manifest.panos);

      this.loadDetail(manifest.detail);
      state.phase = "ready";
      this.push();
      return true;
    } catch (error) {
      if (this.disposed) return false;
      state.phase = "error";
      state.message = error instanceof LoadError ? error.message : "The scan couldn't be loaded.";
      this.push();
      return false;
    }
  }

  private async refreshLinks(): Promise<void> {
    if (this.refreshing || this.disposed) return;
    this.refreshing = true;
    try {
      const manifest = await this.fetchManifest();
      if (this.disposed) return;
      this.manifest = { ...manifest, mesh: this.manifest?.mesh ?? manifest.mesh };
      this.panos?.setPanos(manifest.panos);
    } catch {
      // Keep what is loaded; the next stale link asks again.
    } finally {
      // Not straight away: a scan whose links keep failing must not hammer the API.
      setTimeout(() => (this.refreshing = false), 5000);
    }
  }

  /** Whether the links in hand still have time on them. New ones are asked for only when a panorama needs one. */
  private linksUsable(): boolean {
    return linksFresh(this.manifest?.validUntil, Date.now(), LINK_MARGIN);
  }

  /**
   * Fetch the Matterpak's detailed mesh in a worker and, once in, draw it and
   * see the panoramas' occlusion against it. Walking stays on the 50k mesh,
   * whose floors are clean. Then, where the Matterpak has them, its textures
   * stream in, nearest the eye first: each part of the mesh then has its own
   * texture under the panoramas, for what none of them near the eye saw.
   */
  private loadDetail(detail: ScanDetail | null): void {
    const status = this.state.detail;
    if (this.options.detail === false) {
      status.state = "off";
      return;
    }
    if (!detail || detail.bytes === null || !isAllowedAssetUrl(detail.url)) return;
    status.state = "loading";
    const textured = this.options.textured !== false;
    // The 9 MB or so of mesh first: the full-size faces, hundreds of megabytes, wait for it.
    if (this.panos) this.panos.holdSharp = true;
    const release = () => {
      if (this.panos) this.panos.holdSharp = false;
    };
    const fail = (reason: string) => {
      this.detailWorker?.terminate();
      this.detailWorker = null;
      release();
      if (status.state === "loading") {
        status.state = "failed";
        status.reason = reason;
      }
      this.push();
    };
    try {
      const worker = new Worker(new URL("./detail-worker.ts", import.meta.url), { type: "module" });
      this.detailWorker = worker;
      worker.onmessage = (event: MessageEvent<DetailReply>) => {
        const reply = event.data;
        if (this.disposed) return;
        if (reply.kind === "failed") return fail(reply.failed);
        if (reply.kind === "mesh") {
          this.useDetail(reply);
          release();
          if (reply.textured === 0) {
            worker.terminate();
            this.detailWorker = null;
          }
          return;
        }
        if (reply.kind === "fill") {
          this.useFill(reply.fill, reply.holes);
          return;
        }
        if (reply.kind === "texture") {
          this.arrived.push(reply);
          return;
        }
        const textures = this.state.detail.textures;
        if (textures) Object.assign(textures, { done: true, megabytes: reply.megabytes, seconds: reply.seconds });
        this.push();
      };
      worker.onerror = (event) => fail(`worker: ${event.message}`);
      const request: DetailRequest = { kind: "load", url: detail.url, bytes: detail.bytes, textures: textured, small: SMALL_TEXTURE, sharp: SHARP_TEXTURE };
      worker.postMessage(request);
    } catch {
      release();
      status.state = "failed";
    }
  }

  private useDetail(reply: Extract<DetailReply, { kind: "mesh" }>): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(reply.positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(reply.uvs, 2));
    geometry.setIndex(new BufferAttribute(reply.index, 1));
    geometry.computeBoundingSphere();
    this.detailGeometry = geometry;
    if (reply.textured > 0) {
      this.groups = reply.groups;
      reply.groups.forEach((g, i) => geometry.addGroup(g.start, g.count, i));
      this.groupMaterials = reply.groups.map(() => this.material);
      this.small = reply.groups.map(() => null);
      this.sharp = reply.groups.map(() => null);
    }
    if (this.drawn) {
      this.drawn.geometry = geometry;
      this.drawn.material = reply.textured > 0 ? this.groupMaterials : this.material;
    }
    if (this.wire) this.wire.geometry = geometry;
    this.panos?.setGeometry(geometry);
    Object.assign(this.state.detail, {
      state: "ready",
      triangles: reply.index.length / 3,
      megabytes: reply.megabytes,
      seconds: reply.seconds,
      textures: reply.textured > 0 ? { total: reply.textured, small: 0, sharp: 0, megabytes: 0, seconds: 0, done: false, gpuMegabytes: 0 } : undefined,
    });
    this.push();
  }

  private useFill(triangles: Float32Array, holes: number): void {
    this.state.detail.holes = holes;
    if (!this.fill || triangles.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(triangles, 3));
    geometry.computeBoundingSphere();
    this.addFill(new Mesh(geometry, this.fillMaterial));
    // A closed hole hides what is behind it from a panorama, like the surface it stands for.
    this.panos?.addOccluder(geometry);
  }

  private addFill(mesh: Mesh): void {
    this.fillMeshes.push(mesh);
    this.scene.add(mesh);
  }

  /**
   * A floor plane and a ceiling plane for each level, just behind the mesh's
   * own (lib/scan-mesh/levels.ts), from the floor under each scan position
   * and the ceiling over it, so a hole in either shows a surface at the right
   * height rather than the level below or nothing.
   */
  private addLevels(world: MeshWorld): void {
    const manifest = this.manifest;
    if (!this.fill || !manifest) return;
    const ray = new Ray(new Vector3(), new Vector3(0, 1, 0));
    const samples: LevelSample[] = [];
    manifest.panos.forEach((pano, i) => {
      const feet = this.feetAt(i);
      if (!feet) return;
      ray.origin.set(pano.position[0], pano.position[1], pano.position[2]);
      const up = world.bvh.raycastFirst(ray, DoubleSide, 0, 8);
      samples.push({ x: feet[0], z: feet[2], floor: feet[1], ceiling: up ? up.point.y : null });
    });
    for (const level of fitLevels(samples)) {
      const [x0, z0] = level.min;
      const [x1, z1] = level.max;
      const positions: number[] = [];
      for (const y of [level.floor, level.ceiling]) {
        positions.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
      }
      const plane = new BufferGeometry();
      plane.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
      plane.computeBoundingSphere();
      this.addFill(new Mesh(plane, this.fillMaterial));
    }
  }

  /**
   * One frame of the textures: put on the GPU a few of those that have
   * arrived, and choose which are shown full size.
   */
  private showTextures(dt: number): void {
    if (this.groups.length === 0) return;
    let small = 0;
    let sharp = 0;
    const later: { group: number; sharp: boolean; image: ImageBitmap }[] = [];
    for (const item of this.arrived) {
      if (item.sharp ? sharp >= UPLOADS_SHARP : small >= UPLOADS_SMALL) {
        later.push(item);
        continue;
      }
      if (item.sharp) sharp++;
      else small++;
      this.applyTexture(item.group, item.sharp, item.image);
    }
    this.arrived = later;

    this.sharpClock -= dt;
    const textures = this.state.detail.textures;
    if (this.sharpClock <= 0) {
      this.sharpClock = SHARP_EVERY;
      this.chooseSharp();
      this.detailWorker?.postMessage({ kind: "eye", eye: [this.pose.x, this.pose.y, this.pose.z] } satisfies DetailRequest);
      if (textures) {
        textures.small = this.small.filter(Boolean).length;
        textures.sharp = this.sharp.filter(Boolean).length;
        const bytes = [...this.small, ...this.sharp].reduce((sum, t) => sum + ((t?.userData.bytes as number | undefined) ?? 0), 0);
        textures.gpuMegabytes = bytes / 1e6;
      }
    }
  }

  private applyTexture(group: number, sharp: boolean, image: ImageBitmap): void {
    if (sharp && !this.sharpWanted.has(group)) {
      image.close();
      return;
    }
    const texture = new Texture(image);
    texture.flipY = false;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    // RGBA, and a third again for the smaller copies; the image is let go once uploaded.
    texture.userData.bytes = image.width * image.height * 4 * (4 / 3);
    this.renderer.initTexture(texture);
    image.close();
    const slot = sharp ? this.sharp : this.small;
    slot[group]?.dispose();
    slot[group] = texture;
    this.showGroup(group);
  }

  private showGroup(group: number): void {
    const map = this.sharp[group] ?? this.small[group];
    if (!map) return;
    const material = this.groupMaterials[group];
    if (material === this.material) this.groupMaterials[group] = createPhotoMaterial(this.photo, "mesh", map);
    else material.uniforms.uMap.value = map;
  }

  /** The textures within reach of the eye, nearest first, at full size; the rest small. */
  private chooseSharp(): void {
    const eye: [number, number, number] = [this.pose.x, this.pose.y, this.pose.z];
    const near = this.groups
      .map((g, i) => ({ i, d: distanceToGroup(g, eye), c: Math.hypot(g.centre[0] - eye[0], g.centre[1] - eye[1], g.centre[2] - eye[2]) }))
      .filter(({ i, d }) => d <= SHARP_REACH && this.small[i] !== null)
      // Nearest first; among the boxes the eye stands in, the one whose middle is nearest.
      .sort((a, b) => a.d - b.d || a.c - b.c)
      .slice(0, SHARP_MAX)
      .map(({ i }) => i);
    const wanted = new Set(near);
    for (const i of this.sharpWanted) {
      if (wanted.has(i)) continue;
      this.sharp[i]?.dispose();
      this.sharp[i] = null;
      this.showGroup(i);
    }
    const asked = near.filter((i) => !this.sharpWanted.has(i));
    this.sharpWanted = wanted;
    if (asked.length > 0) this.detailWorker?.postMessage({ kind: "sharp", groups: asked } satisfies DetailRequest);
  }

  /**
   * Whether the picture is whole: every texture in and on the GPU, every
   * panorama's small cube and depth made from the latest mesh, and full-size
   * cubes for the panoramas in use.
   */
  imagingReady(): boolean {
    const textures = this.state.detail.textures;
    if (this.state.detail.state === "loading" || (textures && (!textures.done || this.arrived.length > 0))) return false;
    const counts = this.panos?.counts();
    if (!this.panos || !counts) return true;
    return counts.low + counts.failed >= counts.total && this.panos.depthsCurrent && counts.sharpLoading === 0 && counts.sharp >= Math.min(SLOTS, counts.total - counts.failed);
  }

  /**
   * What paints the current view (`ViewSources`), from a small copy rendered
   * in the photo materials' source colours (photo-material.ts): red the
   * panoramas' part, green a texture's, blue a stand-in, alpha 0 nothing.
   */
  measureSources(): ViewSources {
    const target = new WebGLRenderTarget(SOURCE_WIDTH, SOURCE_HEIGHT);
    const pixels = new Uint8Array(SOURCE_WIDTH * SOURCE_HEIGHT * 4);
    const before = this.renderer.getRenderTarget();
    const clear = this.renderer.getClearColor(new Color());
    const alpha = this.renderer.getClearAlpha();
    const backdrop = this.backdrop.visible;
    try {
      this.backdrop.visible = false;
      this.photo.uDebug.value = 3;
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(clear, 0);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.readRenderTargetPixels(target, 0, 0, SOURCE_WIDTH, SOURCE_HEIGHT, pixels);
    } finally {
      this.photo.uDebug.value = 0;
      this.backdrop.visible = backdrop;
      this.renderer.setClearColor(clear, alpha);
      this.renderer.setRenderTarget(before);
      target.dispose();
    }
    const out: ViewSources = { void: 0, pano: 0, texture: 0, synth: 0, smear: 0, standin: 0 };
    const count = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) {
        out.void += 1 / count;
        continue;
      }
      const pano = pixels[i] / 255;
      const own = pixels[i + 1] / 255;
      out.pano += pano / count;
      if (pixels[i + 2] >= 128) {
        out.standin += 1 / count;
        out.synth += own / count;
        out.smear += Math.max(0, 1 - pano - own) / count;
      } else out.texture += (1 - pano) / count;
    }
    return out;
  }

  /** Once every panorama has its small cube, compare neighbours' colours and even out their exposures. */
  private startExposure(): void {
    const panos = this.panos;
    const world = this.meshWorld;
    if (this.exposureStarted || !panos || !world) return;
    const counts = panos.counts();
    if (counts.total === 0 || counts.low < counts.total) return;
    this.exposureStarted = true;
    void matchExposure(panos.exposureSources(), world, this.abort.signal).then(({ gains, pairs, before, after }) => {
      if (this.disposed || gains.size === 0) return;
      panos.setGains(gains);
      const all = [...gains.values()].flat();
      this.state.exposure = { pairs, low: Math.min(...all), high: Math.max(...all), on: panos.useGains, before, after };
      this.push();
    });
  }

  /** The bounding-volume tree over the walkable mesh, for the debug recorder's rays. */
  get meshTree(): MeshWorld | null {
    return this.meshWorld;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.panos?.dispose();
    if (this.wire) (this.wire.material as MeshBasicMaterial).dispose();
    this.geometry?.dispose();
    this.detailGeometry?.dispose();
    this.detailWorker?.terminate();
    for (const item of this.arrived) item.image.close();
    for (const texture of [...this.small, ...this.sharp]) texture?.dispose();
    for (const material of this.groupMaterials) if (material !== this.material) material.dispose();
    for (const mesh of this.fillMeshes) mesh.geometry.dispose();
    this.fillMaterial.dispose();
    this.fill?.dispose();
    this.material.dispose();
    this.backdropMaterial.dispose();
    this.backdrop.geometry.dispose();
    this.blank.dispose();
    this.renderer.dispose();
  }
}
