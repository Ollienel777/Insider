// The free-walk sandbox's scene (issue 118): loads one scan's mesh, lets the
// player run around inside it like a shooter, and paints it from the scan's
// panoramas. All of the scan lives in this tab's memory; nothing is stored.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  type Object3D,
  Scene,
  WebGLRenderer,
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
  type ScanPano,
} from "@/lib/scan-mesh/manifest";
import { applyLook, stepMove, TUNING, viewBob, type MoveState } from "@/lib/scan-mesh/movement";
import { parseObj } from "@/lib/scan-mesh/obj";
import { MeshWorld } from "./collider";
import { blankCube, PanoStore, type PanoUse } from "./panos";
import type { DetailReply, DetailRequest } from "./detail-worker";
import { matchExposure } from "./exposure-match";
import { createScanMaterial } from "./projection";
import { RECORD_STEP, WalkRecorder, type RecordOptions } from "./recorder";
import type { WalkSample } from "@/lib/scan-mesh/walk-stats";

export type WalkPhase = "manifest" | "mesh" | "building" | "ready" | "no-mesh" | "error";

export interface WalkHud {
  phase: WalkPhase;
  /** A line for the player when the phase is `error` or `no-mesh`. */
  message: string | null;
  triangles: number;
  /** The feet, y-up, metres. */
  position: [number, number, number] | null;
  grounded: boolean;
  speed: number;
  projection: boolean;
  /** How the panoramas are weighted (lib/scan-mesh/blend.ts). */
  blend: BlendMode;
  /** The player's mouse sensitivity, as a multiple of the default. */
  sensitivity: number;
  panos: PanoUse[];
  panoCount: number;
  /** Panoramas with a sharp cube on the GPU, and being given one. */
  panosReady: number;
  panosLoading: number;
  /** False while the picture around the start is still arriving: the player can look but not walk. */
  canMove: boolean;
  /** How much of the building is in memory. */
  building: WalkBuilding;
  /** The detailed mesh from the scan's Matterpak, which takes over the picture once in. */
  detail: { state: "none" | "loading" | "ready" | "failed" | "off"; triangles: number; megabytes: number; seconds: number; reason?: string };
  /** The exposure match: pairs of panoramas compared, the gains' range, and whether they are applied; null until solved. */
  exposure: { pairs: number; low: number; high: number; on: boolean; before: number; after: number } | null;
  faces: PanoResolution;
  locked: boolean;
  /** The browser refused to lock the mouse: the page says to drag instead. */
  lockRefused: boolean;
  fps: number;
  /** Seconds each loading step took, and the mesh file's size. */
  timings: { manifest: number | null; download: number | null; megabytes: number | null; build: number | null };
}

export interface WalkBuilding {
  /** Panoramas whose every byte is held, of how many. */
  held: number;
  total: number;
  /** Megabytes of face files held. */
  megabytes: number;
  /** Small cubes on the GPU (one per panorama, for good) and sharp ones. */
  low: number;
  sharp: number;
  /** A rough count of GPU memory the cubes take, megabytes. */
  gpuMegabytes: number;
  /** The longest gap between two frames in the last five seconds, ms. */
  worstFrame: number;
  /** Seconds from opening the page to the first sharp cube, and to holding every byte. */
  firstSharp: number | null;
  allHeld: number | null;
}

/**
 * Where another screen has the player this frame (the Run screen's first
 * person, components/run/fp/): the feet, y-up, the horizontal velocity, the
 * metres walked, and the look in this file's convention (yaw 0 down -z).
 */
export interface WalkPose {
  x: number;
  feetY: number;
  z: number;
  vx: number;
  vz: number;
  walked: number;
  yaw: number;
  pitch: number;
}

export interface WalkOptions {
  modelId: string;
  faces: PanoResolution;
  mesh: MeshResolution;
  /** Whether to load the Matterpak's detailed mesh when the scan has one. */
  detail: boolean;
  reducedMotion: boolean;
  /** Exposes the engine on `window` for poking at from the console. */
  debug: boolean;
  onHud(hud: WalkHud): void;
  /**
   * Set when another screen walks the player: each frame the pose comes from
   * here (null holds the last one), and this engine takes no keys, mouse or
   * pointer lock of its own.
   */
  drive?: (dt: number) => WalkPose | null;
  /** Called after each frame is drawn, with the camera it was drawn from. */
  onFrame?: (camera: PerspectiveCamera) => void;
}

/** Vertical field of view: about 103° across on a 16:9 screen, a shooter's default. */
const FOV = 71;
const HUD_EVERY = 0.2;
/** Fetch new links when the current ones have this little time left, ms. */
const LINK_MARGIN = 20_000;
/** A mouse report longer than this, in counts, is a glitch, not a flick. */
const MOUSE_JUMP = 600;
/** A drag with the button held turns the view this much faster than a locked mouse, pixel for pixel. */
const DRAG_GAIN = 1.8;
/** The window the HUD's worst frame is taken over, ms. */
const WORST_OVER = 5000;
/** The longest the player is held at the start waiting for the picture around them, ms. */
const MOVE_WAIT = 10_000;
/** Radians per second of turning on the arrow keys. */
const KEY_TURN = 2.2;

const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ShiftLeft",
  "ShiftRight",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
]);

class LoadError extends Error {}

export class ScanWalk {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 3000);
  private readonly blank: CubeTexture;
  private readonly material: ShaderMaterial;
  private readonly backdropMaterial: ShaderMaterial;
  private readonly backdrop: Mesh;
  private readonly keys = new Set<string>();
  private readonly abort = new AbortController();
  /** The walkable mesh (collision, floors), and the one drawn: the detailed mesh once it is in. */
  private geometry: BufferGeometry | null = null;
  private drawn: Mesh | null = null;
  private detailGeometry: BufferGeometry | null = null;
  private detailWorker: Worker | null = null;
  private wire: Mesh | null = null;
  private world: MeshWorld | null = null;
  private panos: PanoStore | null = null;
  private manifest: ScanManifest | null = null;
  private refreshing = false;
  private state: MoveState | null = null;
  private yaw = 0;
  private pitch = 0;
  private bob = 0;
  private projection = true;
  private sensitivity = 1;
  private projectionShown = 1;
  private locked = false;
  /** Where a drag last was, while the button is held and the mouse is not locked. */
  private drag: [number, number] | null = null;
  private disposed = false;
  private frame = 0;
  private last = 0;
  private sinceHud = 0;
  private frames = 0;
  private fps = 0;
  private used: PanoUse[] = [];
  private exposureStarted = false;
  /** The debug recorder's walk, while one is running. */
  private recorder: WalkRecorder | null = null;
  private readonly opened = performance.now();
  /** When the scene became walkable, for the wait's time limit. */
  private readyAt = 0;
  private canMove = false;
  /** Recent frames: when each ended and how long after the one before, ms. */
  private gaps: [number, number][] = [];
  private hud: WalkHud;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: WalkOptions,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(new Color().setRGB(0.027, 0.035, 0.047), 1);
    this.camera.rotation.order = "YXZ";
    this.blank = blankCube();
    this.material = createScanMaterial(this.blank);
    this.backdropMaterial = createScanMaterial(this.blank, true);
    this.backdrop = new Mesh(new BoxGeometry(1000, 1000, 1000), this.backdropMaterial);
    this.backdrop.renderOrder = -1;
    this.backdrop.frustumCulled = false;
    this.scene.add(this.backdrop);
    this.hud = {
      phase: "manifest",
      message: null,
      triangles: 0,
      position: null,
      grounded: false,
      speed: 0,
      projection: true,
      blend: "view",
      exposure: null,
      detail: { state: "none", triangles: 0, megabytes: 0, seconds: 0 },
      sensitivity: 1,
      panos: [],
      panoCount: 0,
      panosReady: 0,
      panosLoading: 0,
      canMove: false,
      building: {
        held: 0,
        total: 0,
        megabytes: 0,
        low: 0,
        sharp: 0,
        gpuMegabytes: 0,
        worstFrame: 0,
        firstSharp: null,
        allHeld: null,
      },
      faces: options.faces,
      locked: false,
      lockRefused: false,
      fps: 0,
      timings: { manifest: null, download: null, megabytes: null, build: null },
    };

    const listen: AddEventListenerOptions = { signal: this.abort.signal };
    window.addEventListener("resize", this.resize, listen);
    if (!options.drive) this.listen(canvas, listen);
    this.resize();

    if (options.debug) (window as unknown as { __scanWalk?: ScanWalk }).__scanWalk = this;
    this.frame = requestAnimationFrame(this.tick);
    void this.load();
  }

  /** The keys, the mouse and the pointer lock, when this engine walks the player itself. */
  private listen(canvas: HTMLCanvasElement, listen: AddEventListenerOptions): void {
    window.addEventListener("keydown", this.keyDown, listen);
    window.addEventListener("keyup", this.keyUp, listen);
    window.addEventListener("blur", () => this.keys.clear(), listen);
    document.addEventListener("pointerlockchange", this.lockChange, listen);
    document.addEventListener("mousemove", this.mouseMove, listen);
    canvas.addEventListener("click", this.requestLock, listen);
    document.addEventListener("pointerlockerror", this.lockRefused, listen);
    // Drag to look: the way to turn the view wherever the lock is refused (an embedded pane, a remote session).
    canvas.addEventListener("pointerdown", this.dragStart, listen);
    canvas.addEventListener("pointermove", this.dragMove, listen);
    canvas.addEventListener("pointerup", this.dragEnd, listen);
    canvas.addEventListener("pointercancel", this.dragEnd, listen);
  }

  /** Puts another screen's pieces (guards, markers) into the scene, drawn over the scan. */
  addToScene(object: Object3D): void {
    this.scene.add(object);
  }

  /** The walkable mesh, once loaded: for another screen to collide and look against. */
  get walkable(): MeshWorld | null {
    return this.world;
  }

  /** The scan positions as the manifest gave them, once loaded. */
  scanPanos(): readonly ScanPano[] {
    return this.manifest?.panos ?? [];
  }

  // ---- loading ----

  private async fetchManifest(): Promise<ScanManifest> {
    const { modelId, faces, mesh } = this.options;
    const query = new URLSearchParams({ m: modelId, faces, mesh });
    const response = await fetch(`/api/scan-mesh?${query}`, { cache: "no-store", signal: this.abort.signal });
    const body = (await response.json().catch(() => null)) as (ScanManifest & { message?: string }) | null;
    if (!response.ok || !body) {
      throw new LoadError(body?.message ?? "The scan couldn't be loaded.");
    }
    return body;
  }

  private async load(): Promise<void> {
    try {
      let at = performance.now();
      const manifest = await this.fetchManifest();
      if (this.disposed) return;
      this.manifest = manifest;
      this.hud.timings.manifest = (performance.now() - at) / 1000;
      this.hud.panoCount = manifest.panos.length;
      if (!manifest.mesh || !isAllowedAssetUrl(manifest.mesh.url)) {
        this.hud.phase = "no-mesh";
        this.hud.message = "No mesh for this scan. It can only be toured in the embedded viewer.";
        this.push();
        return;
      }

      this.hud.phase = "mesh";
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
      if (this.disposed) return;
      this.hud.timings.download = (performance.now() - at) / 1000;
      this.hud.timings.megabytes = text.length / 1e6;

      this.hud.phase = "building";
      this.push();
      // Let the HUD paint before the parse holds the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      at = performance.now();
      const parsed = parseObj(text);
      if (parsed.index.length === 0) {
        this.hud.phase = "no-mesh";
        this.hud.message = "This scan's mesh is empty.";
        this.push();
        return;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(parsed.positions, 3));
      geometry.setIndex(new BufferAttribute(parsed.index, 1));
      geometry.computeBoundingSphere();
      this.geometry = geometry;
      this.world = new MeshWorld(geometry, TUNING.stepUp);
      this.hud.timings.build = (performance.now() - at) / 1000;
      this.hud.triangles = parsed.index.length / 3;
      this.drawn = new Mesh(geometry, this.material);
      this.scene.add(this.drawn);

      // The sharp layer's size: six 2k cubes are about 800 MB of GPU memory.
      const { faces } = this.options;
      const capacity = faces === "4k" ? 3 : faces === "2k" ? 6 : 8;
      const sharpSize = faces === "4k" ? 4096 : faces === "2k" ? 2048 : faces === "high" ? 1024 : 512;
      this.panos = new PanoStore(this.renderer, geometry, capacity, sharpSize);
      this.panos.onStale = () => void this.refreshLinks();
      this.panos.setPanos(manifest.panos);

      this.spawn(parsed.bounds);
      this.loadDetail(manifest.detail);
      this.readyAt = performance.now();
      this.hud.phase = "ready";
      this.push();
    } catch (error) {
      if (this.disposed) return;
      this.hud.phase = "error";
      this.hud.message = error instanceof LoadError ? error.message : "The scan couldn't be loaded.";
      this.push();
    }
  }

  /** Stand at the first scan position, facing the second; with none, in the middle of the mesh. */
  private spawn(bounds: { min: [number, number, number]; max: [number, number, number] } | null): void {
    const panos = this.manifest?.panos ?? [];
    if (panos.length > 0) {
      this.standAt(0);
      if (panos.length > 1) {
        const [ax, , az] = panos[0].position;
        const [bx, , bz] = panos[1].position;
        this.yaw = Math.atan2(-(bx - ax), -(bz - az));
      }
      return;
    }
    const b = bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
    const x = (b.min[0] + b.max[0]) / 2;
    const z = (b.min[2] + b.max[2]) / 2;
    const floor = this.world?.floorBelow(x, b.max[1], z, b.max[1] - b.min[1] + 1) ?? b.min[1];
    this.state = { x, y: floor, z, vx: 0, vz: 0, walked: 0, grounded: true };
  }

  /**
   * Put the player on scan position `index`, with the eye exactly where the
   * scan camera stood: there the projection is exact, whatever the mesh is
   * like. The camera's height is rarely the player's eye height, so the
   * difference is held as a lift until the player moves, then eased away.
   */
  standAt(index: number): void {
    const pano = this.manifest?.panos[index];
    if (!pano || !this.world) return;
    const [x, y, z] = pano.position;
    const floor = this.world.floorBelow(x, y, z, 3) ?? pano.floor?.[1] ?? y - 1.4;
    this.state = { x, y: floor, z, vx: 0, vz: 0, walked: 0, grounded: true };
    this.eyeLift = y - (floor + TUNING.eyeHeight);
    this.holdLift = true;
  }

  private eyeLift = 0;
  private holdLift = false;

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
    const until = this.manifest?.validUntil;
    return !until || Date.parse(until) - Date.now() > LINK_MARGIN;
  }

  // ---- input ----

  /** Fits the drawing to the canvas: on a window resize, and when another screen resizes the canvas. */
  readonly resize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  };

  private readonly requestLock = (): void => {
    if (this.locked || this.hud.phase !== "ready") return;
    // Raw mouse input where the browser has it: no pointer acceleration.
    try {
      const raw = this.canvas.requestPointerLock({ unadjustedMovement: true }) as unknown as Promise<void> | undefined;
      raw?.catch?.(() => {
        try {
          const plain = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
          plain?.catch?.(() => this.lockRefused());
        } catch {
          this.lockRefused();
        }
      });
    } catch {
      this.lockRefused();
    }
  };

  private readonly lockRefused = (): void => {
    if (this.hud.lockRefused) return;
    this.hud.lockRefused = true;
    this.push();
  };

  private readonly dragStart = (event: PointerEvent): void => {
    if (this.locked || event.button !== 0 || this.hud.phase !== "ready") return;
    this.drag = [event.clientX, event.clientY];
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // No capture: the drag still works while the pointer stays over the view.
    }
  };

  private readonly dragMove = (event: PointerEvent): void => {
    if (this.locked || !this.drag) return;
    const [x, y] = this.drag;
    this.drag = [event.clientX, event.clientY];
    const look = applyLook(this.yaw, this.pitch, (event.clientX - x) * DRAG_GAIN, (event.clientY - y) * DRAG_GAIN, TUNING.lookSpeed * this.sensitivity);
    this.yaw = look.yaw;
    this.pitch = look.pitch;
  };

  private readonly dragEnd = (): void => {
    this.drag = null;
  };

  private readonly lockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.keys.clear();
    this.drag = null;
    this.hud.locked = this.locked;
    if (this.locked) this.hud.lockRefused = false;
    this.push();
  };

  private readonly mouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    // Some browsers report one huge jump as the pointer locks or the window regains focus.
    if (Math.abs(event.movementX) > MOUSE_JUMP || Math.abs(event.movementY) > MOUSE_JUMP) return;
    const look = applyLook(this.yaw, this.pitch, event.movementX, event.movementY, TUNING.lookSpeed * this.sensitivity);
    this.yaw = look.yaw;
    this.pitch = look.pitch;
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (MOVE_KEYS.has(event.code)) {
      this.keys.add(event.code);
      event.preventDefault();
      return;
    }
    if (event.code === "Minus" || event.code === "NumpadSubtract") this.setSensitivity(this.sensitivity / 1.1);
    if (event.code === "Equal" || event.code === "NumpadAdd") this.setSensitivity(this.sensitivity * 1.1);
    if (event.repeat) return;
    if (event.code === "KeyT") this.setProjection(!this.projection);
    if (event.code === "KeyG") this.toggleWire();
    if (event.code === "KeyE") this.setExposure(!(this.hud.exposure?.on ?? true));
    if (event.code === "KeyB") this.setBlend(this.hud.blend === "view" ? "nearest" : "view");
    if (event.code === "KeyP" && this.state && this.panos) {
      this.standAt(this.panos.nearest([this.state.x, this.state.y + TUNING.eyeHeight + this.eyeLift, this.state.z]));
    }
    if (event.code === "KeyN" && this.state && this.panos && this.panos.count > 0) {
      const here = this.panos.nearest([this.state.x, this.state.y + TUNING.eyeHeight + this.eyeLift, this.state.z]);
      this.standAt((here + 1) % this.panos.count);
    }
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  setSensitivity(value: number): void {
    this.sensitivity = Math.min(5, Math.max(0.2, value));
    this.hud.sensitivity = this.sensitivity;
    this.push();
  }

  setProjection(on: boolean): void {
    this.projection = on;
    this.hud.projection = on;
    this.push();
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

  /** For the console (`?debug=1`): look somewhere, or show the depth check. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Apply the exposure gains or not: to see what they do. */
  setExposure(on: boolean): void {
    if (this.panos) this.panos.useGains = on;
    if (this.hud.exposure) this.hud.exposure = { ...this.hud.exposure, on };
    this.push();
  }

  /**
   * Fetch the Matterpak's detailed mesh in a worker and, once in, draw it and
   * see the panoramas' occlusion against it. Walking stays on the 50k mesh,
   * whose floors are clean. Only the mesh file is pulled from the archive.
   */
  private loadDetail(detail: ScanDetail | null): void {
    const hud = this.hud.detail;
    if (!this.options.detail) {
      hud.state = "off";
      return;
    }
    if (!detail || detail.bytes === null || !isAllowedAssetUrl(detail.url)) return;
    hud.state = "loading";
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
          hud.state = "failed";
          hud.reason = reply.failed;
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
        Object.assign(hud, { state: "ready", triangles: reply.index.length / 3, megabytes: reply.megabytes, seconds: reply.seconds });
        this.push();
      };
      worker.onerror = (event) => {
        worker.terminate();
        this.detailWorker = null;
        release();
        hud.state = "failed";
        hud.reason = `worker: ${event.message}`;
        this.push();
      };
      const request: DetailRequest = { url: detail.url, bytes: detail.bytes };
      worker.postMessage(request);
    } catch {
      release();
      hud.state = "failed";
    }
  }

  /** Once every panorama has its small cube, compare neighbours' colours and even out their exposures. */
  private startExposure(): void {
    const panos = this.panos;
    const world = this.world;
    if (this.exposureStarted || !panos || !world) return;
    const counts = panos.counts();
    if (counts.total === 0 || counts.low < counts.total) return;
    this.exposureStarted = true;
    void matchExposure(panos.exposureSources(), world, this.abort.signal).then(({ gains, pairs, before, after }) => {
      if (this.disposed || gains.size === 0) return;
      panos.setGains(gains);
      const all = [...gains.values()].flat();
      this.hud.exposure = { pairs, low: Math.min(...all), high: Math.max(...all), on: panos.useGains, before, after };
      this.push();
    });
  }

  /** Switch the rule that weights the panoramas: to judge the difference by eye, or to measure it. */
  setBlend(mode: BlendMode): void {
    if (this.panos) this.panos.mode = mode;
    this.hud.blend = mode;
    this.push();
  }

  /**
   * For the console (`&debug=1`): walk `path` at a constant speed, one fixed
   * step a frame, and resolve with each frame's numbers (recorder.ts). The
   * player's keys do nothing meanwhile.
   */
  record(options: RecordOptions): Promise<WalkSample[]> {
    if (!this.options.debug || this.recorder || !this.state || options.path.length < 2) return Promise.resolve([]);
    return new Promise((resolve) => {
      this.recorder = new WalkRecorder(options, (samples) => {
        this.recorder = null;
        resolve(samples);
      });
    });
  }

  /** The scan positions, y-up, in the scan's order: for choosing a route to record. */
  panoPositions(): Vec3[] {
    return (this.manifest?.panos ?? []).map((p) => p.position);
  }

  setDebugView(on: boolean): void {
    this.material.uniforms.uDebug.value = on ? 1 : 0;
  }

  snapshot(): WalkHud {
    return {
      ...this.hud,
      panos: [...this.hud.panos],
      timings: { ...this.hud.timings },
      building: { ...this.hud.building },
      detail: { ...this.hud.detail },
    };
  }

  // ---- the frame ----

  private readonly tick = (time: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    const dt = this.last === 0 ? 0 : Math.min(0.1, (time - this.last) / 1000);
    if (this.last !== 0) this.gaps.push([time, time - this.last]);
    while (this.gaps.length > 0 && time - this.gaps[0][0] > WORST_OVER) this.gaps.shift();
    this.last = time;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.world) this.options.onFrame?.(this.camera);
    if (this.recorder && this.world) {
      this.recorder.capture(this.renderer, this.scene, this.camera, this.world, this.used, this.panos?.mode ?? "view");
    }

    this.frames++;
    this.sinceHud += dt;
    if (this.sinceHud >= HUD_EVERY) {
      this.fps = this.frames / this.sinceHud;
      this.frames = 0;
      this.sinceHud = 0;
      this.push();
    }
  };

  private step(dt: number): void {
    const { keys } = this;
    const state = this.state;
    const world = this.world;
    if (!state || !world) return;

    const turn = (keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0);
    const tilt = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
    if (turn !== 0 || tilt !== 0) {
      const look = applyLook(this.yaw, this.pitch, -turn * KEY_TURN * dt, -tilt * KEY_TURN * dt, 1);
      this.yaw = look.yaw;
      this.pitch = look.pitch;
    }

    // The player looks around from the first frame, and walks once there is a
    // picture to walk into (or the wait has gone on too long).
    if (!this.canMove) {
      const eye: [number, number, number] = [state.x, state.y + TUNING.eyeHeight + this.eyeLift, state.z];
      const waited = performance.now() - this.readyAt;
      if (!this.panos || this.panos.settled(eye) || waited > MOVE_WAIT) {
        this.canMove = true;
        this.hud.canMove = true;
        this.push();
      }
    }
    const go = this.canMove ? 1 : 0;
    const input = {
      forward: go * ((keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0)),
      right: go * ((keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0)),
      walk: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    };
    const recorder = this.recorder;
    let next: MoveState;
    if (recorder) {
      // A recorded walk: a fixed step a frame, straight along the route.
      dt = RECORD_STEP;
      const [x, y, z] = recorder.eye();
      const [vx, vz] = recorder.velocity();
      next = { x, y: y - TUNING.eyeHeight, z, vx, vz, walked: recorder.walked, grounded: true };
      this.eyeLift = 0;
      this.holdLift = false;
      this.yaw = recorder.yaw;
      this.pitch = 0;
    } else if (this.options.drive) {
      // Another screen walks the player: its pose, as is.
      const pose = this.options.drive(dt);
      next = pose
        ? { x: pose.x, y: pose.feetY, z: pose.z, vx: pose.vx, vz: pose.vz, walked: pose.walked, grounded: true }
        : { ...state, vx: 0, vz: 0 };
      if (pose) {
        this.yaw = pose.yaw;
        this.pitch = pose.pitch;
      }
      this.eyeLift = 0;
      this.holdLift = false;
    } else {
      next = stepMove(state, input, this.yaw, dt, world);
    }
    this.state = next;
    if (input.forward !== 0 || input.right !== 0) this.holdLift = false;
    if (!this.holdLift) this.eyeLift *= Math.exp(-5 * dt);

    const speed = Math.hypot(next.vx, next.vz);
    const bobTarget = recorder ? 0 : viewBob(next.walked, speed, this.options.reducedMotion);
    this.bob += (bobTarget - this.bob) * (1 - Math.exp(-30 * dt));
    const eyeY = next.y + TUNING.eyeHeight + this.eyeLift;
    this.camera.position.set(next.x, eyeY + this.bob, next.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.backdrop.position.copy(this.camera.position);

    const toward = this.projection ? 1 : 0;
    this.projectionShown += (toward - this.projectionShown) * (1 - Math.exp(-12 * dt));
    this.material.uniforms.uProjection.value = this.projectionShown;
    this.backdropMaterial.uniforms.uProjection.value = this.projectionShown;

    if (this.panos) {
      // Shares follow where the player stands, not the bob.
      const eye: [number, number, number] = [next.x, eyeY, next.z];
      this.used = this.panos.update(
        eye,
        [next.vx, next.vz],
        dt,
        [this.material, this.backdropMaterial],
        this.blank,
        this.linksUsable(),
      );
      if (this.panos.needsLinks) void this.refreshLinks();
      this.startExposure();
    }

    this.hud.position = [next.x, next.y, next.z];
    this.hud.grounded = next.grounded;
    this.hud.speed = speed;
  }

  private push(): void {
    if (this.disposed) return;
    const counts = this.panos?.counts();
    this.hud.panos = this.used;
    this.hud.panosReady = counts?.sharp ?? 0;
    this.hud.panosLoading = counts?.sharpLoading ?? 0;
    if (counts) {
      const b = this.hud.building;
      const now = (performance.now() - this.opened) / 1000;
      b.held = counts.held;
      b.total = counts.total;
      b.megabytes = counts.bytes / 1e6;
      b.low = counts.low;
      b.sharp = counts.sharp;
      b.gpuMegabytes = counts.gpu / 1e6;
      if (b.firstSharp === null && counts.sharp > 0) b.firstSharp = now;
      if (b.allHeld === null && counts.total > 0 && counts.held + counts.failed >= counts.total) b.allHeld = now;
    }
    this.hud.building.worstFrame = this.gaps.reduce((worst, [, gap]) => Math.max(worst, gap), 0);
    this.hud.fps = this.fps;
    this.options.onHud(this.snapshot());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (this.options.debug) delete (window as unknown as { __scanWalk?: ScanWalk }).__scanWalk;
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
