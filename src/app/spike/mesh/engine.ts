// The free-walk sandbox (issue 118): lets the player run around inside one
// scan like a shooter. The scan itself is drawn by scan-view.ts, which this
// drives the way a game's first-person view would: input and movement here,
// then a pose and a render each frame.
import { BLEND_MODES, type BlendMode } from "@/lib/scan-mesh/blend";
import type { Vec3 } from "@/lib/scan-mesh/coords";
import type { MeshResolution, PanoResolution } from "@/lib/scan-mesh/manifest";
import { applyLook, stepMove, TUNING, viewBob, type MoveState } from "@/lib/scan-mesh/movement";
import type { ViewStats } from "@/lib/scan-mesh/pose";
import type { WalkSample } from "@/lib/scan-mesh/walk-stats";
import type { MeshWorld } from "./collider";
import type { PanoUse } from "./panos";
import { RECORD_STEP, WalkRecorder, type RecordOptions } from "./recorder";
import { ScanView, type ScanDetailStatus, type ScanFixes, type ScanPhase, type ScanViewStatus } from "./scan-view";

export type WalkPhase = ScanPhase;

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
  /** What is drawn: the panoramas as spheres, or the mesh. */
  shows: "spheres" | "mesh";
  /** Whether the blend's fixes for doubles and unseen points are on (lib/scan-mesh/combine.ts). */
  fixes: boolean;
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
  detail: ScanDetailStatus;
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

export interface WalkOptions {
  modelId: string;
  faces: PanoResolution;
  mesh: MeshResolution;
  /** Whether to load the Matterpak's detailed mesh when the scan has one. */
  detail: boolean;
  /** Whether to paint it with its own textures, and fill what nothing covers (scan-view.ts); both default on. */
  textured?: boolean;
  repair?: "all" | "none" | "shards" | "planes";
  /** What is drawn: the panoramas as spheres (the default), or the mesh. */
  view?: "spheres" | "mesh";
  fill?: boolean;
  reducedMotion: boolean;
  /** Exposes the engine on `window` for poking at from the console. */
  debug: boolean;
  onHud(hud: WalkHud): void;
}

const HUD_EVERY = 0.2;
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

/**
 * The sandbox's pace: a brisk walk and a stroll. Faster than this and the
 * player outruns the full-size panoramas, which take a second each to come in.
 */
const PACE = { ...TUNING, runSpeed: 3, walkSpeed: 1.5 };

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

export class ScanWalk {
  /** The scan, drawn from the pose this sets each frame. */
  readonly view: ScanView;
  private readonly keys = new Set<string>();
  private readonly abort = new AbortController();
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
  /** The debug recorder's walk, while one is running. */
  private recorder: WalkRecorder | null = null;
  private readonly opened = performance.now();
  /** When the scene became walkable, for the wait's time limit. */
  private readyAt = 0;
  private canMove = false;
  /** Recent frames: when each ended and how long after the one before, ms. */
  private gaps: [number, number][] = [];
  private eyeLift = 0;
  private holdLift = false;
  private fixes = true;
  private hud: WalkHud;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: WalkOptions,
  ) {
    this.view = new ScanView(canvas, {
      modelId: options.modelId,
      faces: options.faces,
      mesh: options.mesh,
      detail: options.detail,
      textured: options.textured,
      repair: options.repair,
      view: options.view,
      fill: options.fill,
      onChange: () => this.push(),
    });
    this.hud = {
      phase: "manifest",
      message: null,
      triangles: 0,
      position: null,
      grounded: false,
      speed: 0,
      projection: true,
      blend: "photo",
      shows: options.view === "mesh" ? "mesh" : "spheres",
      fixes: true,
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
    void this.view.ready.then((ok) => {
      if (!ok || this.disposed) return;
      this.spawn();
      this.readyAt = performance.now();
      this.push();
    });
  }

  /** Stand at the first scan position, facing the second; with none, on whatever floor is under the origin. */
  private spawn(): void {
    const positions = this.view.scanPositions();
    if (positions.length > 0) {
      this.standAt(0);
      if (positions.length > 1) {
        const [ax, , az] = positions[0];
        const [bx, , bz] = positions[1];
        this.yaw = Math.atan2(-(bx - ax), -(bz - az));
      }
      return;
    }
    this.state = { x: 0, y: this.view.floorAt(0, 100, 0, 200) ?? 0, z: 0, vx: 0, vz: 0, walked: 0, grounded: true };
  }

  /**
   * Put the player on scan position `index`, with the eye exactly where the
   * scan camera stood: there the projection is exact, whatever the mesh is
   * like. The camera's height is rarely the player's eye height, so the
   * difference is held as a lift until the player moves, then eased away.
   */
  standAt(index: number): void {
    const feet = this.view.feetAt(index);
    const camera = this.view.scanPositions()[index];
    if (!feet || !camera) return;
    this.state = { x: feet[0], y: feet[1], z: feet[2], vx: 0, vz: 0, walked: 0, grounded: true };
    this.eyeLift = camera[1] - (feet[1] + TUNING.eyeHeight);
    this.holdLift = true;
  }

  /** The walkable mesh, for the console and the recorder. */
  get world(): MeshWorld | null {
    return this.view.meshTree;
  }

  // ---- input ----

  private readonly resize = (): void => {
    this.view.resize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight);
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
    if (event.code === "KeyG") this.view.toggleWire();
    if (event.code === "KeyV") {
      this.view.setSpheres(this.view.shows === "mesh");
      this.push();
    }
    if (event.code === "KeyE") this.setExposure(!(this.hud.exposure?.on ?? true));
    if (event.code === "KeyB") this.setBlend(BLEND_MODES[(BLEND_MODES.indexOf(this.hud.blend) + 1) % BLEND_MODES.length]);
    if (event.code === "KeyF") this.setFixes({ agree: !this.fixes, fill: !this.fixes });
    const count = this.view.scanPositions().length;
    if ((event.code === "KeyP" || event.code === "KeyN") && this.state && count > 0) {
      const here = this.view.nearestScan(this.eye());
      this.standAt(event.code === "KeyP" ? here : (here + 1) % count);
    }
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private eye(): Vec3 {
    const s = this.state;
    return s ? [s.x, s.y + TUNING.eyeHeight + this.eyeLift, s.z] : [0, 0, 0];
  }

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

  /** For the console (`?debug=1`): look somewhere. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Apply the exposure gains or not: to see what they do. */
  setExposure(on: boolean): void {
    this.view.setExposure(on);
    this.push();
  }

  /** Switch the rule that weights the panoramas: to judge the difference by eye, or to measure it. */
  setBlend(mode: BlendMode): void {
    this.view.setBlend(mode);
    this.hud.blend = mode;
    this.push();
  }

  /** The blend's fixes off, to compare (scan-view.ts): `F`, or the console. */
  setFixes(fixes: Partial<ScanFixes>): void {
    this.view.setFixes(fixes);
    this.fixes = fixes.agree ?? fixes.fill ?? this.fixes;
    this.hud.fixes = this.fixes;
    this.push();
  }

  /** For the console: this view's coverage and doubles (lib/scan-mesh/pose.ts). */
  measure(): ViewStats {
    return this.view.measure();
  }

  setDebugView(mode: number): void {
    this.view.setDebugView(mode);
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
    return this.view.scanPositions();
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
    this.view.render(this.step(dt));
    const world = this.view.meshTree;
    if (this.recorder && world) {
      this.recorder.capture(this.view.renderer, (target) => this.view.draw(target), this.view.camera, world, this.view.inUse(), this.view.blend);
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

  /** Moves the player and hands the view its pose; returns the step taken, seconds. */
  private step(dt: number): number {
    const { keys } = this;
    const state = this.state;
    const world = this.view.world;
    if (!state || !world) return dt;

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
      const waited = performance.now() - this.readyAt;
      if (this.view.settled(this.eye()) || waited > MOVE_WAIT) {
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
    } else {
      next = stepMove(state, input, this.yaw, dt, world, PACE);
    }
    this.state = next;
    if (input.forward !== 0 || input.right !== 0) this.holdLift = false;
    if (!this.holdLift) this.eyeLift *= Math.exp(-5 * dt);

    const speed = Math.hypot(next.vx, next.vz);
    const bobTarget = recorder ? 0 : viewBob(next.walked, speed, this.options.reducedMotion);
    this.bob += (bobTarget - this.bob) * (1 - Math.exp(-30 * dt));
    const eyeY = next.y + TUNING.eyeHeight + this.eyeLift;

    const toward = this.projection ? 1 : 0;
    this.projectionShown += (toward - this.projectionShown) * (1 - Math.exp(-12 * dt));
    this.view.setProjection(this.projectionShown);
    this.view.setPose({ x: next.x, y: eyeY + this.bob, z: next.z, yaw: this.yaw, pitch: this.pitch }, [next.vx, next.vz]);

    this.hud.position = [next.x, next.y, next.z];
    this.hud.grounded = next.grounded;
    this.hud.speed = speed;
    return dt;
  }

  private push(): void {
    if (this.disposed) return;
    const status: ScanViewStatus = this.view.status();
    this.hud.phase = status.phase;
    this.hud.message = status.message;
    this.hud.triangles = status.triangles;
    this.hud.panoCount = status.panoCount;
    this.hud.detail = status.detail;
    this.hud.exposure = status.exposure;
    this.hud.timings = status.timings;
    this.hud.blend = this.view.blend;
    this.hud.shows = this.view.shows;
    const counts = this.view.counts();
    this.hud.panos = this.view.inUse();
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
    const textures = status.detail.textures;
    if (textures) {
      // The textured mesh: the building is its textures, under the panoramas.
      const b = this.hud.building;
      b.held = textures.small;
      b.total = textures.total;
      b.megabytes = textures.megabytes;
      b.low = textures.small;
      b.sharp = textures.sharp;
      b.gpuMegabytes = textures.gpuMegabytes + (counts ? counts.gpu / 1e6 : 0);
      if (b.allHeld === null && textures.done) b.allHeld = (performance.now() - this.opened) / 1000;
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
    this.view.dispose();
  }
}
