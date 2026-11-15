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
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
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
import { TUNING, type MoveWorld } from "@/lib/scan-mesh/movement";
import { parseObj } from "@/lib/scan-mesh/obj";
import { feetUnder, linksFresh, poseVelocity, sharpLayer, viewStats, type ScanPose, type ViewStats } from "@/lib/scan-mesh/pose";
import { MeshWorld } from "./collider";
import type { DetailReply, DetailRequest } from "./detail-worker";
import { matchExposure } from "./exposure-match";
import { blankCube, PanoStore, type PanoCounts, type PanoUse } from "./panos";
import { createScanMaterial } from "./projection";

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

class LoadError extends Error {}

export class ScanView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  /** Resolves true once the scan can be walked and drawn, false if it can't. */
  readonly ready: Promise<boolean>;
  private readonly blank: CubeTexture;
  private readonly material: ShaderMaterial;
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
    this.renderer.setClearColor(new Color().setRGB(0.027, 0.035, 0.047), 1);
    this.blank = blankCube();
    this.material = createScanMaterial(this.blank);
    this.backdropMaterial = createScanMaterial(this.blank, true);
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
    if (this.panos) {
      this.used = this.panos.update(
        [x, y, z],
        velocity,
        dt,
        [this.material, this.backdropMaterial],
        this.blank,
        this.linksUsable(),
      );
      if (this.panos.needsLinks) void this.refreshLinks();
      this.startExposure();
    }
    this.renderer.render(this.scene, this.camera);
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

  /** Each scan position's id, camera and floor spot: for a game to stand its board's nodes on (the Run screen's first person). */
  scanPoints(): { id: string; position: Vec3; floor: Vec3 | null }[] {
    return (this.manifest?.panos ?? []).map((p) => ({ id: p.id, position: p.position, floor: p.floor }));
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
    return this.panos?.nearest(eye) ?? -1;
  }

  /** Whether the picture around `eye` has arrived, so a player can be let loose there. */
  settled(eye: Vec3): boolean {
    return !this.panos || this.panos.settled(eye);
  }

  status(): ScanViewStatus {
    return {
      ...this.state,
      detail: { ...this.state.detail },
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
    this.backdropMaterial.uniforms.uProjection.value = amount;
  }

  setBlend(mode: BlendMode): void {
    if (this.panos) this.panos.mode = mode;
  }

  get blend(): BlendMode {
    return this.panos?.mode ?? "view";
  }

  /** Apply the exposure gains or not: to see what they do. */
  setExposure(on: boolean): void {
    if (this.panos) this.panos.useGains = on;
    if (this.state.exposure) this.state.exposure = { ...this.state.exposure, on };
  }

  setFixes(fixes: Partial<ScanFixes>): void {
    for (const material of [this.material, this.backdropMaterial]) {
      if (fixes.agree !== undefined) material.uniforms.uAgree.value = fixes.agree ? 1 : 0;
      if (fixes.fill !== undefined) material.uniforms.uFill.value = fixes.fill ? 1 : 0;
    }
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
      state.timings.build = (performance.now() - at) / 1000;
      state.triangles = parsed.index.length / 3;
      this.drawn = new Mesh(geometry, this.material);
      this.scene.add(this.drawn);

      const sharp = sharpLayer(this.faces);
      this.panos = new PanoStore(this.renderer, geometry, sharp.capacity, sharp.size);
      this.panos.onStale = () => void this.refreshLinks();
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
   * whose floors are clean. Only the mesh file is pulled from the archive.
   */
  private loadDetail(detail: ScanDetail | null): void {
    const status = this.state.detail;
    if (this.options.detail === false) {
      status.state = "off";
      return;
    }
    if (!detail || detail.bytes === null || !isAllowedAssetUrl(detail.url)) return;
    status.state = "loading";
    // The 9 MB or so of mesh first: the full-size faces, hundreds of megabytes, wait for it.
    if (this.panos) this.panos.holdSharp = true;
    const release = () => {
      if (this.panos) this.panos.holdSharp = false;
    };
    try {
      const worker = new Worker(new URL("./detail-worker.ts", import.meta.url), { type: "module" });
      this.detailWorker = worker;
      worker.onmessage = (event: MessageEvent<DetailReply>) => {
        worker.terminate();
        this.detailWorker = null;
        release();
        const reply = event.data;
        if (this.disposed) return;
        if ("failed" in reply) {
          status.state = "failed";
          status.reason = reply.failed;
          this.push();
          return;
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(reply.positions, 3));
        geometry.setIndex(new BufferAttribute(reply.index, 1));
        geometry.computeBoundingSphere();
        this.detailGeometry = geometry;
        if (this.drawn) this.drawn.geometry = geometry;
        if (this.wire) this.wire.geometry = geometry;
        this.panos?.setGeometry(geometry);
        Object.assign(status, { state: "ready", triangles: reply.index.length / 3, megabytes: reply.megabytes, seconds: reply.seconds });
        this.push();
      };
      worker.onerror = (event) => {
        worker.terminate();
        this.detailWorker = null;
        release();
        status.state = "failed";
        status.reason = `worker: ${event.message}`;
        this.push();
      };
      const request: DetailRequest = { url: detail.url, bytes: detail.bytes };
      worker.postMessage(request);
    } catch {
      release();
      status.state = "failed";
    }
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

  /** The Matterpak's detailed mesh, once in (`status().detail`): what a game asks for the furniture. */
  get detailMesh(): BufferGeometry | null {
    return this.detailGeometry;
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
    this.material.dispose();
    this.backdropMaterial.dispose();
    this.backdrop.geometry.dispose();
    this.blank.dispose();
    this.renderer.dispose();
  }
}
