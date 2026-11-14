// Scan controls for the first-person spike: the page owns the pointer and the
// keys and drives the Matterport camera through the SDK. This file is the part
// to tune for feel. The real scan view (epic #98, T5) will import it as it is.
//
// What the player can do in a scan: stand on a scan position, look around, and
// travel to another position. There is no free walking in the embed player, so
// "smooth walking" means making travel between positions feel continuous:
// steady speed, no stop between hops while a key is held, and a choice of the
// next position that matches where the player is looking and heading.
//
// What a real scan measured (issue 109, on localhost):
// - Forward is (-sin yaw, -cos yaw) on x and z, with `pose.rotation.y` as yaw in
//   degrees. `Camera.rotate(+h, +v)` turns right and looks up.
// - `Sweep.moveTo` with FLY takes its `transitionTime` plus about 35 ms, eased
//   in and out, so the camera is still for an instant at every position. A
//   position seen for the first time can add one stalled frame of 60 to 190 ms.
// - A `moveTo` sent while another is in flight resolves at once and does
//   nothing. Hops cannot overlap, so the next one starts on arrival.
// - `Camera.rotate` works during a flight, and thirty calls 16 ms apart all
//   land. So looking never has to wait for walking.
// - A near position's floor point is below the screen when the player looks
//   level (1 m away is 56 degrees down). Aim by bearing, not by screen position.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The part of the SDK's camera pose the controls read. */
export interface Pose {
  position: Vec3;
  /** Degrees: `x` is pitch (negative looks down), `y` is yaw. */
  rotation: { x: number; y: number };
}

/** The defaults. `TUNING` starts as a copy, and the sandbox changes it with keys. */
export const DEFAULT_TUNING = Object.freeze({
  /** Walking speed. A hop's travel time is its length over this. */
  walkMetresPerSecond: 4,
  /** No hop is asked to take less than this, however short. */
  minStepMs: 220,
  /** No hop is asked to take more than this, however long. */
  maxStepMs: 1300,
  /** What the player adds to a hop's `transitionTime` (measured: about 35 ms). */
  stepOverheadMs: 35,
  /** W from a standstill: a position further than this from the centre of the view is not walked to. */
  aimDegrees: 35,
  /** The same, while a walk is under way: wider, so a bend in a corridor does not stop it. */
  walkAimDegrees: 65,
  /** The same, for stepping back or to a side (S, A, D). */
  sideAimDegrees: 60,
  /**
   * The hop length the walk likes best. Every hop eases in and out, so many short
   * hops stutter and one very long hop flies: a stride of about this length reads
   * as walking.
   */
  strideMetres: 2.5,
  /** A position costs this many degrees of aim for each metre its distance is off the stride. */
  distanceCostDegreesPerMetre: 5,
  /** While walking, each degree a hop turns away from the last one costs this many degrees of aim. */
  momentumWeight: 0.25,
  /** The aimed position is kept until another beats it by this many degrees, so the ring does not flicker. */
  stickyDegrees: 6,
  /** A position nearer than this is where the player stands. */
  minHopMetres: 0.3,
  /** Mouse look with the pointer locked: degrees per pixel. */
  lookDegreesPerPixel: 0.12,
  /** Drag to look, when the pointer is not locked: degrees per pixel. */
  dragDegreesPerPixel: 0.2,
  /** How fast `Camera.rotate` plays a turn, in degrees a second. High means "now". */
  lookSpeed: 3000,
  /** A single mouse event larger than this is a browser glitch and is dropped. */
  maxLookPixelsPerEvent: 250,
  /** Turning with Q and E or the left and right arrows. */
  turnDegreesPerSecond: 110,
  /** Walking forward turns the view this share of the way toward each hop. 0 turns steering off. */
  steerShare: 0.6,
  /** Steering waits this long after the mouse last moved, so it never fights the player. */
  steerIdleMs: 250,
  steerDegreesPerSecond: 90,
  /** The view dips this many pixels on each hop, like a footstep. 0 turns it off. */
  bobPixels: 3,
  invertY: false,
});
export type Tuning = { -readonly [K in keyof typeof DEFAULT_TUNING]: (typeof DEFAULT_TUNING)[K] };
/** The live values. The sandbox page changes them with keys; the game can leave them alone. */
export const TUNING: Tuning = { ...DEFAULT_TUNING };

/** How long to ask the camera to take over `metres`, so the whole hop keeps the walking speed. */
export function stepMs(metres: number, tuning: Tuning = TUNING): number {
  const ms = (metres / tuning.walkMetresPerSecond) * 1000 - tuning.stepOverheadMs;
  return Math.max(tuning.minStepMs, Math.min(tuning.maxStepMs, Math.round(ms)));
}

// ---- geometry: all on the floor plane (x and z) ---------------------------------

/** An angle in degrees, wrapped into (-180, 180]. */
export function wrapDegrees(degrees: number): number {
  const d = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

export function flatDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Which way the camera faces on the floor plane, as a unit vector. */
export function forwardOf(yawDegrees: number): { x: number; z: number } {
  const yaw = (yawDegrees * Math.PI) / 180;
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** How many degrees `point` is to the right of the centre of the view (negative: to the left; 180: behind). */
export function bearingOf(pose: Pose, point: Vec3): number {
  const f = forwardOf(pose.rotation.y);
  const dx = point.x - pose.position.x;
  const dz = point.z - pose.position.z;
  // Right of forward is (-f.z, f.x).
  return wrapDegrees((Math.atan2(dx * -f.z + dz * f.x, dx * f.x + dz * f.z) * 180) / Math.PI);
}

// ---- which position a key travels to --------------------------------------------

/** What the walk asks for: which way, and whether it follows straight on from another hop. */
export interface WalkIntent {
  /** Degrees right of the view: 0 forward (W), 180 back (S), -90 and 90 to the sides (A and D). */
  heading: number;
  /** True from the second hop of an unbroken walk. */
  chained: boolean;
}

export interface Aim {
  pose: Pose;
  /** Positions the player may travel to from where they stand. The game decides these. */
  hops: readonly string[];
  floorPoint: (sweepId: string) => Vec3;
  /** See `WalkIntent`. Default 0, forward. */
  heading?: number;
  /** See `WalkIntent`. Default false. */
  chained?: boolean;
  /** Where the last hop started, for a walk under way: the walk prefers to keep its line. */
  cameFrom?: Vec3 | null;
  /** The position aimed at a moment ago. It is kept unless another is clearly better. */
  sticky?: string | null;
}

export interface ScoredHop {
  id: string;
  /** Degrees right of the heading asked for. */
  bearing: number;
  metres: number;
  /** Lower is better. In degrees of aim. */
  cost: number;
}

/** Every position the heading can reach, best first. */
export function scoreHops(aim: Aim, tuning: Tuning = TUNING): ScoredHop[] {
  const heading = aim.heading ?? 0;
  const reach = heading === 0 ? (aim.chained ? tuning.walkAimDegrees : tuning.aimDegrees) : tuning.sideAimDegrees;
  const here = aim.pose.position;
  const line = aim.chained && heading === 0 && aim.cameFrom && flatDistance(aim.cameFrom, here) > 0.2 ? aim.cameFrom : null;
  const scored: ScoredHop[] = [];
  for (const id of aim.hops) {
    const point = aim.floorPoint(id);
    const metres = flatDistance(here, point);
    if (metres < tuning.minHopMetres) continue;
    const bearing = wrapDegrees(bearingOf(aim.pose, point) - heading);
    if (Math.abs(bearing) > reach) continue;
    let cost = Math.abs(bearing) + tuning.distanceCostDegreesPerMetre * Math.abs(metres - tuning.strideMetres);
    if (line) {
      const was = Math.atan2(here.x - line.x, here.z - line.z);
      const next = Math.atan2(point.x - here.x, point.z - here.z);
      cost += tuning.momentumWeight * Math.abs(wrapDegrees(((next - was) * 180) / Math.PI));
    }
    scored.push({ id, bearing, metres, cost });
  }
  return scored.sort((a, b) => a.cost - b.cost || (a.id < b.id ? -1 : 1));
}

/**
 * The position a key travels to: the legal hop that best fits the heading,
 * preferring the one in the middle of the view, then the one a stride away,
 * then (while walking) the one that keeps the walk's line. Null when none is inside the aim
 * window: the player is looking at a wall.
 */
export function pickTarget(aim: Aim, tuning: Tuning = TUNING): string | null {
  const scored = scoreHops(aim, tuning);
  if (scored.length === 0) return null;
  const kept = aim.sticky ? scored.find((s) => s.id === aim.sticky) : undefined;
  if (kept && kept.cost <= scored[0].cost + tuning.stickyDegrees) return kept.id;
  return scored[0].id;
}

// ---- the walk: which hop starts when, free of the DOM ---------------------------

export interface WalkerOptions {
  /** The position this intent would travel to right now, or null. */
  target: (intent: WalkIntent) => string | null;
  /** Travels there, and resolves on arrival. */
  step: (sweepId: string, intent: WalkIntent) => Promise<void>;
  /** Called as each hop starts. */
  onHop?: (sweepId: string, intent: WalkIntent) => void;
  now?: () => number;
}

export interface Walker {
  /** True while the camera is travelling. */
  readonly moving: boolean;
  /** True while a walk key is held with nowhere to go: the player is facing a wall. */
  readonly blocked: boolean;
  /** How long the last hop took end to end, in ms. 0 before the first. */
  readonly lastHopMs: number;
  press(heading: number): void;
  release(heading: number): void;
  releaseAll(): void;
  /** Call once a frame: a held key starts walking the moment a position comes into aim. */
  tick(): void;
}

/** A `step` that comes back faster than this did not travel (the player drops a move sent mid-flight). */
export const DROPPED_STEP_MS = 40;
/** After a dropped or failed step, how long to wait before trying again. */
export const RETRY_MS = 120;

/**
 * The walk's state. While a key is held, each arrival starts the next hop at
 * once. A key tapped during a hop still buys one more hop. A held key with no
 * position in aim waits, and goes as soon as the player turns to face one.
 */
export function createWalker({ target, step, onHop, now = () => performance.now() }: WalkerOptions): Walker {
  const held: number[] = [];
  let queued: number | null = null;
  let moving = false;
  let blocked = false;
  let lastHopMs = 0;
  let retryAt = 0;

  const run = async () => {
    if (moving) return;
    moving = true;
    let chained = false;
    try {
      for (;;) {
        const heading = held.length > 0 ? held[held.length - 1] : queued;
        queued = null;
        if (heading === null) break;
        const intent: WalkIntent = { heading, chained };
        const next = target(intent);
        blocked = next === null;
        if (next === null) break;
        const started = now();
        onHop?.(next, intent);
        try {
          await step(next, intent);
        } catch {
          retryAt = now() + RETRY_MS;
          break;
        }
        const took = now() - started;
        if (took < DROPPED_STEP_MS) {
          retryAt = now() + RETRY_MS;
          break;
        }
        lastHopMs = took;
        chained = true;
      }
    } finally {
      moving = false;
    }
  };

  return {
    get moving() {
      return moving;
    },
    get blocked() {
      return blocked && held.length > 0;
    },
    get lastHopMs() {
      return lastHopMs;
    },
    press(heading) {
      if (held.includes(heading)) return;
      held.push(heading);
      if (moving) queued = heading;
      else void run();
    },
    release(heading) {
      const i = held.indexOf(heading);
      if (i >= 0) held.splice(i, 1);
      if (held.length === 0) blocked = false;
    },
    releaseAll() {
      held.length = 0;
      queued = null;
      blocked = false;
    },
    tick() {
      if (!moving && (held.length > 0 || queued !== null) && now() >= retryAt) void run();
    },
  };
}

// ---- the wiring: pointer, keys and the frame loop -------------------------------

export interface ScanControlsState {
  /** The pointer is locked: the mouse looks without a button held. */
  locked: boolean;
  moving: boolean;
  blocked: boolean;
}

export interface ScanControlsOptions {
  sdk: any;
  /** The element over the player that takes the pointer. */
  layer: HTMLElement;
  /**
   * The position a walk key would travel to right now, or null. Usually
   * `pickTarget` on the latest pose. With no intent it answers for W.
   */
  target: (intent?: WalkIntent) => string | null;
  /**
   * Travels to a position, and resolves when the camera has arrived. In the
   * spike this flies the camera. In the game it plays the engine's move, and
   * the camera follows the player's node.
   */
  step: (sweepId: string, intent?: WalkIntent) => Promise<void>;
  /** Degrees a position is right of the view, usually `bearingOf`. Given, walking forward steers toward each hop. */
  bearingTo?: (sweepId: string) => number | null;
  /** The element that dips on each hop, usually the one holding the player and the layer. Left out, nothing dips. */
  bob?: HTMLElement | null;
  /** Called when the lock, the walk or the block changes, for a hint on screen. */
  onState?: (state: ScanControlsState) => void;
}

export interface ScanControls extends ScanControlsState {
  dispose(): void;
}

const WALK_KEYS: Record<string, number> = { w: 0, arrowup: 0, s: 180, arrowdown: 180, a: -90, d: 90 };
const TURN_KEYS: Record<string, number> = { q: -1, arrowleft: -1, e: 1, arrowright: 1 };

/**
 * Wires looking and walking, and returns the handle that removes them.
 *
 * - Click the view to lock the pointer: the mouse then looks, as in a game, and
 *   Esc lets go. Where the lock is refused, dragging looks instead.
 * - W or the up arrow walks forward while held. S steps back, A and D step to a
 *   side, all without turning. Q and E or the left and right arrows turn.
 */
export function attachScanControls({ sdk, layer, target, step, bearingTo, bob, onState }: ScanControlsOptions): ScanControls {
  const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let drag: [number, number] | null = null;
  let locked = false;
  let lookX = 0;
  let lookY = 0;
  let mouseAt = -Infinity;
  let turn = 0;
  const turning = new Map<string, number>();
  let steer = 0;
  let frame = 0;
  let last = performance.now();
  let told = "";
  let disposed = false;

  const walker = createWalker({
    target,
    step,
    onHop(sweepId, intent) {
      // Steer: a hop off to one side turns the view part of the way to it, so a held W follows a corridor's bends.
      const off = intent.heading === 0 && !calm ? (bearingTo?.(sweepId) ?? 0) : 0;
      steer = off * TUNING.steerShare;
      if (bob && TUNING.bobPixels > 0 && !calm && typeof bob.animate === "function") {
        const ms = Math.max(TUNING.minStepMs, walker.lastHopMs || 400);
        bob.animate([{ transform: "translateY(0)" }, { transform: `translateY(${TUNING.bobPixels}px)` }, { transform: "translateY(0)" }], {
          duration: ms,
          easing: "ease-in-out",
        });
      }
    },
  });

  const tell = () => {
    const state: ScanControlsState = { locked, moving: walker.moving, blocked: walker.blocked };
    const key = `${state.locked}${state.moving}${state.blocked}`;
    if (key === told) return;
    told = key;
    onState?.(state);
  };

  // ---- looking
  const look = (dx: number, dy: number) => {
    const limit = TUNING.maxLookPixelsPerEvent;
    if (Math.abs(dx) > limit || Math.abs(dy) > limit) return;
    lookX += dx;
    lookY += dy;
    mouseAt = performance.now();
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (!locked && typeof layer.requestPointerLock === "function") {
      // Raw input where the browser has it: no acceleration, as a game expects. A refusal leaves dragging.
      try {
        const asked = (layer.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void> | void)({ unadjustedMovement: true });
        if (asked && typeof asked.catch === "function") {
          asked.catch(() => {
            const again = layer.requestPointerLock() as Promise<void> | void;
            if (again && typeof again.catch === "function") again.catch(() => {});
          });
        }
      } catch {
        // No lock here: dragging still looks.
      }
    }
    drag = [e.clientX, e.clientY];
    try {
      layer.setPointerCapture(e.pointerId);
    } catch {
      // A locked pointer cannot be captured, and need not be.
    }
  };
  const move = (e: PointerEvent) => {
    if (locked) {
      look(e.movementX, e.movementY);
      return;
    }
    if (!drag) return;
    const k = TUNING.dragDegreesPerPixel / TUNING.lookDegreesPerPixel;
    look((e.clientX - drag[0]) * k, (e.clientY - drag[1]) * k);
    drag = [e.clientX, e.clientY];
  };
  const up = () => {
    drag = null;
  };
  const lockChange = () => {
    locked = document.pointerLockElement === layer;
    drag = null;
    lookX = 0;
    lookY = 0;
    tell();
  };

  // ---- keys
  const typing = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  };
  const keyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    const key = e.key.toLowerCase();
    if (key in WALK_KEYS) {
      e.preventDefault();
      if (!e.repeat) walker.press(WALK_KEYS[key]);
    } else if (key in TURN_KEYS) {
      e.preventDefault();
      turning.set(key, TURN_KEYS[key]);
      turn = [...turning.values()].reduce((sum, v) => sum + v, 0);
    }
  };
  const keyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key in WALK_KEYS) walker.release(WALK_KEYS[key]);
    else if (key in TURN_KEYS) {
      turning.delete(key);
      turn = [...turning.values()].reduce((sum, v) => sum + v, 0);
    }
  };
  const letGo = () => {
    walker.releaseAll();
    turning.clear();
    turn = 0;
    drag = null;
    steer = 0;
  };
  const hidden = () => {
    if (document.hidden) letGo();
  };

  // ---- one frame: every turn of the view goes out as a single rotate
  const tick = (at: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.1, Math.max(0, (at - last) / 1000));
    last = at;

    let h = lookX * TUNING.lookDegreesPerPixel;
    const v = lookY * TUNING.lookDegreesPerPixel * (TUNING.invertY ? 1 : -1);
    lookX = 0;
    lookY = 0;
    h += turn * TUNING.turnDegreesPerSecond * dt;
    if (steer !== 0) {
      // The player's own hand always wins over steering.
      if (at - mouseAt < TUNING.steerIdleMs || turn !== 0 || !walker.moving) steer = 0;
      else {
        const part = Math.sign(steer) * Math.min(Math.abs(steer), TUNING.steerDegreesPerSecond * dt);
        steer -= part;
        h += part;
      }
    }
    if (h !== 0 || v !== 0) {
      const sent = sdk.Camera.rotate(h, v, { speed: TUNING.lookSpeed });
      if (sent && typeof sent.catch === "function") sent.catch(() => {});
    }

    walker.tick();
    tell();
  };

  layer.addEventListener("pointerdown", down);
  layer.addEventListener("pointermove", move);
  layer.addEventListener("pointerup", up);
  layer.addEventListener("pointercancel", up);
  document.addEventListener("pointerlockchange", lockChange);
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  window.addEventListener("blur", letGo);
  frame = requestAnimationFrame(tick);

  return {
    get locked() {
      return locked;
    },
    get moving() {
      return walker.moving;
    },
    get blocked() {
      return walker.blocked;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      letGo();
      if (document.pointerLockElement === layer) document.exitPointerLock();
      layer.removeEventListener("pointerdown", down);
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      document.removeEventListener("pointerlockchange", lockChange);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", letGo);
    },
  };
}
