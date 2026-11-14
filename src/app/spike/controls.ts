// Scan controls for the first-person spike: the page owns the pointer and the
// keys and drives the Matterport camera through the SDK. This file is the part
// to tune for feel. The real scan view (epic #98, T5) will import it as it is.
//
// What the player can do in a scan: stand on a scan position, look around, and
// travel to another position. There is no free walking in the embed player, so
// "smooth walking" means making travel between positions feel continuous:
// constant speed, no stop between hops while the key is held, and a sensible
// choice of the next position.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Degrees the camera turns per pixel dragged. */
export const LOOK_DEGREES_PER_PIXEL = 0.2;
/** How fast `Camera.rotate` plays a turn, in degrees a second. High means "now". */
export const LOOK_SPEED = 3000;
/** Walking speed. A hop's travel time is its length over this. */
export const WALK_METRES_PER_SECOND = 5;
export const MIN_STEP_MS = 350;
export const MAX_STEP_MS = 900;
/** A position further than this from the centre of the view, as a share of its width, is not walked to. */
export const AIM_WINDOW = 0.35;

/** How long the camera takes to travel `metres`. */
export function stepMs(metres: number): number {
  const ms = (metres / WALK_METRES_PER_SECOND) * 1000;
  return Math.max(MIN_STEP_MS, Math.min(MAX_STEP_MS, Math.round(ms)));
}

export interface Aim {
  sdk: any;
  pose: any;
  size: { w: number; h: number };
  /** Positions the player may travel to from where they stand. */
  hops: readonly string[];
  floorPoint: (sweepId: string) => Vec3;
}

/**
 * The position W travels to: the legal hop nearest the centre of the view,
 * inside the aim window. Null when the player is looking at none of them.
 */
export function pickTarget({ sdk, pose, size, hops, floorPoint }: Aim): string | null {
  let best: { id: string; off: number } | null = null;
  for (const id of hops) {
    const screen = sdk.Conversion.worldToScreen(floorPoint(id), pose, size);
    if (!(screen.x >= 0 && screen.x <= size.w && screen.y >= 0 && screen.y <= size.h)) continue;
    const off = Math.abs(screen.x - size.w / 2) / size.w;
    if (off > AIM_WINDOW) continue;
    if (!best || off < best.off) best = { id, off };
  }
  return best ? best.id : null;
}

export interface ScanControlsOptions {
  sdk: any;
  /** The element over the player that takes the pointer. */
  layer: HTMLElement;
  /** The position W would travel to right now, or null. Usually `pickTarget` on the latest pose. */
  target: () => string | null;
  /**
   * Travels to a position, and resolves when the camera has arrived. In the
   * spike this flies the camera. In the game it plays the engine's move, and
   * the camera follows the player's node.
   */
  step: (sweepId: string) => Promise<void>;
}

export interface ScanControls {
  /** True while the camera is travelling. */
  readonly moving: boolean;
  dispose(): void;
}

/** Wires drag-to-look and hold-W-to-walk. Returns the handle that removes them. */
export function attachScanControls({ sdk, layer, target, step }: ScanControlsOptions): ScanControls {
  let last: [number, number] | null = null;
  let moving = false;
  let held = false;

  const down = (e: PointerEvent) => {
    last = [e.clientX, e.clientY];
    layer.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!last) return;
    const dx = e.clientX - last[0];
    const dy = e.clientY - last[1];
    last = [e.clientX, e.clientY];
    sdk.Camera.rotate(dx * LOOK_DEGREES_PER_PIXEL, dy * LOOK_DEGREES_PER_PIXEL, { speed: LOOK_SPEED });
  };
  const up = () => {
    last = null;
  };

  // While W is held, each arrival starts the next hop at once, so the walk does not stop between positions.
  const walk = async () => {
    if (moving) return;
    moving = true;
    try {
      while (held) {
        const next = target();
        if (!next) break;
        await step(next);
      }
    } finally {
      moving = false;
    }
  };
  const isWalkKey = (e: KeyboardEvent) => e.key === "w" || e.key === "W" || e.key === "ArrowUp";
  const keyDown = (e: KeyboardEvent) => {
    if (!isWalkKey(e)) return;
    e.preventDefault();
    held = true;
    void walk();
  };
  const keyUp = (e: KeyboardEvent) => {
    if (isWalkKey(e)) held = false;
  };
  const blur = () => {
    held = false;
    last = null;
  };

  layer.addEventListener("pointerdown", down);
  layer.addEventListener("pointermove", move);
  layer.addEventListener("pointerup", up);
  layer.addEventListener("pointercancel", up);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  window.addEventListener("blur", blur);

  return {
    get moving() {
      return moving;
    },
    dispose() {
      held = false;
      layer.removeEventListener("pointerdown", down);
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    },
  };
}
