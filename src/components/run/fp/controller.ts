// The first-person view's hands (issue 115): keys and the mouse turned into
// what the walker is asked to do. It knows nothing of the floor or the
// engine: it holds a yaw, a pitch and which keys are down.
//
// Keys, by position on the keyboard (`event.code`), so a layout other than
// QWERTY keeps the same hand shape:
//   W A S D   move, relative to the view        Shift   walk
//   mouse     look, once the view is clicked    Esc     release the mouse
//             (where the browser refuses the lock, hold the button and drag)
//   ← →       turn without a mouse; ↑ ↓ move forwards and back
//   E         use: pick a locked door, take the objective
//   F         wait a turn
//   Q         held: sprint, two hops in one turn (the board's S)
// On the board W waits and S sprints (run-screen.tsx). Those are the Run
// screen's own listeners on `window`; this one listens in the capture phase
// and marks each key it takes as handled, which the Run screen already
// honours (`event.defaultPrevented`), so in first person W walks and nothing
// else happens. The number keys, Space, L and P are left to the Run screen.
import type { Controls } from "./walker";
import { FP } from "./tuning";

const MOVE = { KeyW: [1, 0], KeyS: [-1, 0], KeyD: [0, 1], KeyA: [0, -1], ArrowUp: [1, 0], ArrowDown: [-1, 0] } as const;
const TURN = { ArrowLeft: -1, ArrowRight: 1 } as const;
const TAKEN = new Set<string>([...Object.keys(MOVE), ...Object.keys(TURN), "KeyE", "KeyF", "KeyQ"]);

const typing = (target: EventTarget | null) =>
  (target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true], [contenteditable='']") != null;

export class Controller {
  yaw: number;
  pitch = 0;
  /** Whether the mouse is held by the view. */
  locked = false;
  private readonly down = new Set<string>();
  private shift = false;
  private interact = false;
  private wait = false;
  /** Where a drag last was, while the button is held and the mouse is not locked. */
  private drag: [number, number] | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly surface: HTMLElement,
    yaw: number,
    private readonly onLock: (locked: boolean) => void,
    /** Called when the browser refuses the lock: the view then says to drag. */
    private readonly onRefused: () => void = () => {},
  ) {
    this.yaw = yaw;
    const listen = <K extends keyof WindowEventMap>(target: Window | Document | HTMLElement, type: K | string, handler: (event: never) => void, capture = false) => {
      target.addEventListener(type, handler as EventListener, capture);
      this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, capture));
    };
    listen(window, "keydown", (event: KeyboardEvent) => this.key(event, true), true);
    listen(window, "keyup", (event: KeyboardEvent) => this.key(event, false), true);
    listen(window, "blur", () => this.release());
    listen(document, "visibilitychange", () => this.release());
    listen(document, "pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.surface;
      if (!this.locked) this.release();
      this.onLock(this.locked);
    });
    listen(document, "mousemove", (event: MouseEvent) => {
      if (!this.locked) return;
      this.turn(event.movementX * FP.lookRadPerPx, -event.movementY * FP.lookRadPerPx);
    });
    listen(document, "pointerlockerror", () => this.onRefused());
    listen(surface, "click", () => {
      if (this.locked) return;
      try {
        // A browser may refuse (no gesture, a sandboxed frame, a remote session): dragging and the arrow keys still turn the view.
        void Promise.resolve(surface.requestPointerLock()).catch(() => this.onRefused());
      } catch {
        this.onRefused();
      }
    });
    // Drag to look: the way to turn the view wherever the lock is refused. Same direction as the locked mouse.
    listen(surface, "pointerdown", (event: PointerEvent) => {
      if (this.locked || event.button !== 0) return;
      this.drag = [event.clientX, event.clientY];
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        // No capture: the drag still works while the pointer stays over the view.
      }
    });
    listen(surface, "pointermove", (event: PointerEvent) => {
      if (this.locked || !this.drag) return;
      const [x, y] = this.drag;
      this.drag = [event.clientX, event.clientY];
      this.turn((event.clientX - x) * FP.dragRadPerPx, -(event.clientY - y) * FP.dragRadPerPx);
    });
    const drop = () => {
      this.drag = null;
    };
    listen(surface, "pointerup", drop);
    listen(surface, "pointercancel", drop);
  }

  private key(event: KeyboardEvent, isDown: boolean): void {
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") this.shift = isDown;
    if (!TAKEN.has(event.code)) return;
    if (!isDown) {
      this.down.delete(event.code);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || typing(event.target)) return;
    // Taken: the Run screen's own W (wait) and S (sprint) do not also fire.
    event.preventDefault();
    this.shift = event.shiftKey;
    if (event.repeat) return;
    this.down.add(event.code);
    if (event.code === "KeyE") this.interact = true;
    if (event.code === "KeyF") this.wait = true;
  }

  private release(): void {
    this.down.clear();
    this.shift = false;
    this.drag = null;
  }

  private turn(yaw: number, pitch: number): void {
    this.yaw += yaw;
    this.pitch = Math.min(FP.pitchLimitRad, Math.max(-FP.pitchLimitRad, this.pitch + pitch));
  }

  /** Turns by the arrow keys held over `dt` seconds. Call once a frame, before `controls`. */
  frame(dt: number): void {
    let turning = 0;
    for (const [code, sign] of Object.entries(TURN)) if (this.down.has(code)) turning += sign;
    if (turning !== 0) this.turn(turning * FP.turnRadPerS * dt, 0);
  }

  /** What the keys ask for now. E is handed over once per press. */
  controls(): Controls {
    let forward = 0;
    let strafe = 0;
    for (const [code, [f, s]] of Object.entries(MOVE)) {
      if (!this.down.has(code)) continue;
      forward += f;
      strafe += s;
    }
    const interact = this.interact;
    this.interact = false;
    return { forward: Math.sign(forward), strafe: Math.sign(strafe), walk: this.shift, yaw: this.yaw, interact, sprint: this.down.has("KeyQ") };
  }

  /** Whether F was pressed since the last call. */
  takeWait(): boolean {
    const wait = this.wait;
    this.wait = false;
    return wait;
  }

  dispose(): void {
    for (const off of this.cleanup) off();
    if (document.pointerLockElement === this.surface) document.exitPointerLock();
  }
}
