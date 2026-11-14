// Shooter-style first-person movement over a scan's mesh (issue 118). Pure:
// the world is two questions (`floorBelow`, `pushOut`) the page answers from
// the mesh and the tests answer from made-up rooms.
//
// The feel: a constant run speed reached in a few frames, the same speed
// forward, back and sideways, a dead stop when the keys come up, and Shift to
// walk. No momentum to fight. Walls stop the body and let it slide along
// them; the floor holds the feet, small steps are climbed smoothly, and a hole
// in the mesh leaves the feet at the last height they had.
//
// Frame: y-up, metres, seconds. Yaw 0 looks down -z and grows to the left
// (three.js's camera convention); pitch grows upward.

export interface MoveTuning {
  /** Metres per second with the keys down. */
  runSpeed: number;
  /** Metres per second with Shift held. */
  walkSpeed: number;
  /** How fast speed builds, m/s². Run speed arrives in runSpeed / accel seconds. */
  accel: number;
  /** How fast speed drops with the keys up, m/s². */
  decel: number;
  /** Eye above the feet, metres. */
  eyeHeight: number;
  /** The body's radius against walls, metres. */
  radius: number;
  /** The tallest step the feet climb without being stopped, metres. */
  stepUp: number;
  /** The deepest drop the feet follow; past it there is "no floor". */
  maxDrop: number;
  /** How quickly the feet settle onto a new floor height, per second. */
  heightRate: number;
  /** View bob: metres up and down at run speed, and metres walked per cycle. */
  bobHeight: number;
  bobStride: number;
  /** Radians of turn per pixel of mouse travel. */
  lookSpeed: number;
}

export const TUNING: MoveTuning = {
  runSpeed: 5,
  walkSpeed: 2.5,
  accel: 80,
  decel: 100,
  eyeHeight: 1.6,
  radius: 0.25,
  stepUp: 0.45,
  maxDrop: 2.5,
  heightRate: 14,
  bobHeight: 0.022,
  bobStride: 2.4,
  lookSpeed: 0.0022,
};

export interface MoveInput {
  /** +1 forward, -1 back, 0 neither. */
  forward: number;
  /** +1 right, -1 left, 0 neither. */
  right: number;
  walk: boolean;
}

export interface MoveState {
  /** The feet, y-up. */
  x: number;
  y: number;
  z: number;
  /** Horizontal velocity, m/s. */
  vx: number;
  vz: number;
  /** Metres walked so far, for the view bob. */
  walked: number;
  /** Whether the last step found a floor under the feet. */
  grounded: boolean;
}

export interface MoveWorld {
  /**
   * The height of the highest floor at (x, z) that is at or below `fromY` and
   * no more than `depth` under it; null when there is none.
   */
  floorBelow(x: number, fromY: number, z: number, depth: number): number | null;
  /**
   * Where a body of `radius` with its feet at (x, feetY, z) ends up once it is
   * moved out of every wall it overlaps. Only x and z change.
   */
  pushOut(x: number, feetY: number, z: number, radius: number): { x: number; z: number };
}

const MAX_DT = 0.05;

/** The player's state `dt` seconds on. `yaw` is where they look. */
export function stepMove(
  state: MoveState,
  input: MoveInput,
  yaw: number,
  dt: number,
  world: MoveWorld,
  tuning: MoveTuning = TUNING,
): MoveState {
  if (!(dt > 0)) return state;
  const whole = Math.min(dt, MAX_DT);

  // The velocity the keys ask for: unit direction, so a diagonal is no faster.
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let wx = -sin * input.forward + cos * input.right;
  let wz = -cos * input.forward - sin * input.right;
  const length = Math.hypot(wx, wz);
  const moving = length > 1e-6;
  if (moving) {
    const speed = input.walk ? tuning.walkSpeed : tuning.runSpeed;
    wx = (wx / length) * speed;
    wz = (wz / length) * speed;
  } else {
    wx = 0;
    wz = 0;
  }

  let { x, y, z, vx, vz, walked, grounded } = state;

  // Close on the asked velocity at a fixed rate: a straight line in velocity
  // space, so a change of direction is as crisp as a start.
  const dvx = wx - vx;
  const dvz = wz - vz;
  const gap = Math.hypot(dvx, dvz);
  const reach = (moving ? tuning.accel : tuning.decel) * whole;
  if (gap <= reach) {
    vx = wx;
    vz = wz;
  } else {
    vx += (dvx / gap) * reach;
    vz += (dvz / gap) * reach;
  }

  // Move in pieces no longer than half the body's radius, so no frame, however
  // long, carries the body through a wall before `pushOut` sees it.
  const travel = Math.hypot(vx, vz) * whole;
  const pieces = Math.max(1, Math.ceil(travel / (tuning.radius * 0.5)));
  const h = whole / pieces;
  for (let i = 0; i < pieces; i++) {
    const fromX = x;
    const fromZ = z;
    const toX = x + vx * h;
    const toZ = z + vz * h;
    const out = world.pushOut(toX, y, toZ, tuning.radius);
    // Lose the part of the velocity that points into the wall; keep the rest.
    const cx = out.x - toX;
    const cz = out.z - toZ;
    const pushed = Math.hypot(cx, cz);
    if (pushed > 1e-9) {
      const into = (vx * cx + vz * cz) / pushed;
      if (into < 0) {
        vx -= (into * cx) / pushed;
        vz -= (into * cz) / pushed;
      }
    }
    x = out.x;
    z = out.z;
    walked += Math.hypot(x - fromX, z - fromZ);

    const floor = world.floorBelow(x, y + tuning.stepUp, z, tuning.stepUp + tuning.maxDrop);
    grounded = floor !== null;
    if (floor !== null) y += (floor - y) * (1 - Math.exp(-tuning.heightRate * h));
  }

  return { x, y, z, vx, vz, walked, grounded };
}

const PITCH_LIMIT = (89 * Math.PI) / 180;

/** Yaw and pitch after the mouse moves (dx, dy) pixels. Pitch stops short of straight up and down. */
export function applyLook(
  yaw: number,
  pitch: number,
  dx: number,
  dy: number,
  lookSpeed: number = TUNING.lookSpeed,
): { yaw: number; pitch: number } {
  const nextYaw = yaw - dx * lookSpeed;
  const nextPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - dy * lookSpeed));
  // Keep yaw in (-π, π] so it never grows without bound.
  const wrapped = Math.atan2(Math.sin(nextYaw), Math.cos(nextYaw));
  return { yaw: wrapped, pitch: nextPitch };
}

/**
 * How far the view rides above its rest height: a small sine tied to the
 * distance walked, scaled by how fast the player is going. Zero when
 * `reduced` (prefers-reduced-motion).
 */
export function viewBob(walked: number, speed: number, reduced: boolean, tuning: MoveTuning = TUNING): number {
  if (reduced) return 0;
  const share = Math.min(1, Math.max(0, speed / tuning.runSpeed));
  if (share === 0) return 0;
  return Math.sin((walked / tuning.bobStride) * Math.PI * 2) * tuning.bobHeight * share;
}
