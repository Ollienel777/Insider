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
  Scene,
  WebGLRenderer,
  type CubeTexture,
  type ShaderMaterial,
} from "three";
import { isAllowedAssetUrl, type MeshResolution, type PanoResolution, type ScanManifest } from "@/lib/scan-mesh/manifest";
import { applyLook, stepMove, TUNING, viewBob, type MoveState } from "@/lib/scan-mesh/movement";
import { parseObj } from "@/lib/scan-mesh/obj";
import { MeshWorld } from "./collider";
import { blankCube, PanoStore, type PanoUse } from "./panos";
import { createScanMaterial } from "./projection";

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
  /** The player's mouse sensitivity, as a multiple of the default. */
  sensitivity: number;
  panos: PanoUse[];
  panoCount: number;
  panosReady: number;
  panosLoading: number;
  faces: PanoResolution;
  locked: boolean;
  /** The browser refused to lock the mouse: the page says to drag instead. */
  lockRefused: boolean;
  fps: number;
  /** Seconds each loading step took, and the mesh file's size. */
  timings: { manifest: number | null; download: number | null; megabytes: number | null; build: number | null };
}

export interface WalkOptions {
  modelId: string;
  faces: PanoResolution;
  mesh: MeshResolution;
  reducedMotion: boolean;
  /** Exposes the engine on `window` for poking at from the console. */
  debug: boolean;
  onHud(hud: WalkHud): void;
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
  private geometry: BufferGeometry | null = null;
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
      sensitivity: 1,
      panos: [],
      panoCount: 0,
      panosReady: 0,
      panosLoading: 0,
      faces: options.faces,
      locked: false,
      lockRefused: false,
      fps: 0,
      timings: { manifest: null, download: null, megabytes: null, build: null },
    };

    const listen: AddEventListenerOptions = { signal: this.abort.signal };
    window.addEventListener("resize", this.resize, listen);
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
    this.resize();

    if (options.debug) (window as unknown as { __scanWalk?: ScanWalk }).__scanWalk = this;
    this.frame = requestAnimationFrame(this.tick);
    void this.load();
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
      this.scene.add(new Mesh(geometry, this.material));

      const capacity = this.options.faces === "4k" ? 3 : this.options.faces === "2k" ? 6 : 8;
      this.panos = new PanoStore(this.renderer, geometry, capacity);
      this.panos.onStale = () => void this.refreshLinks();
      this.panos.setPanos(manifest.panos);

      this.spawn(parsed.bounds);
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

  private readonly resize = (): void => {
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
    this.wire = new Mesh(this.geometry, material);
    this.scene.add(this.wire);
  }

  /** For the console (`?debug=1`): look somewhere, or show the depth check. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  setDebugView(on: boolean): void {
    this.material.uniforms.uDebug.value = on ? 1 : 0;
  }

  snapshot(): WalkHud {
    return { ...this.hud, panos: [...this.hud.panos], timings: { ...this.hud.timings } };
  }

  // ---- the frame ----

  private readonly tick = (time: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    const dt = this.last === 0 ? 0 : Math.min(0.1, (time - this.last) / 1000);
    this.last = time;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);

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

    const input = {
      forward: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
      right: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
      walk: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    };
    const next: MoveState = stepMove(state, input, this.yaw, dt, world);
    this.state = next;
    if (input.forward !== 0 || input.right !== 0) this.holdLift = false;
    if (!this.holdLift) this.eyeLift *= Math.exp(-5 * dt);

    const speed = Math.hypot(next.vx, next.vz);
    const bobTarget = viewBob(next.walked, speed, this.options.reducedMotion);
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
        dt,
        performance.now(),
        [this.material, this.backdropMaterial],
        this.blank,
        this.linksUsable(),
      );
      if (this.panos.needsLinks) void this.refreshLinks();
    }

    this.hud.position = [next.x, next.y, next.z];
    this.hud.grounded = next.grounded;
    this.hud.speed = speed;
  }

  private push(): void {
    if (this.disposed) return;
    const counts = this.panos?.counts();
    this.hud.panos = this.used;
    this.hud.panosReady = counts?.ready ?? 0;
    this.hud.panosLoading = counts?.loading ?? 0;
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
    this.material.dispose();
    this.backdropMaterial.dispose();
    this.backdrop.geometry.dispose();
    this.blank.dispose();
    this.renderer.dispose();
  }
}
