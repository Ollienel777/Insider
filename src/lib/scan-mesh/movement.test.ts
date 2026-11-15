// Made-up rooms: a flat floor, a wall, a step, a hole. No scan data.
import { describe, expect, it } from "vitest";
import { applyLook, stepMove, TUNING, viewBob, type MoveInput, type MoveState, type MoveWorld } from "./movement";

const FRAME = 1 / 60;
const REST: MoveState = { x: 0, y: 0, z: 0, vx: 0, vz: 0, walked: 0, grounded: true };
const idle: MoveInput = { forward: 0, right: 0, walk: false };
const forward: MoveInput = { forward: 1, right: 0, walk: false };

/** A flat floor at `height` everywhere, and no walls. */
function open(height = 0): MoveWorld {
  return {
    floorBelow: (_x, fromY, _z, depth) => (height <= fromY && fromY - height <= depth ? height : null),
    pushOut: (x, _y, z) => ({ x, z }),
  };
}

/** `open`, with a wall across the way: the body's centre can't pass z = -limit. */
function walled(limit: number): MoveWorld {
  return { ...open(), pushOut: (x, _y, z, radius) => ({ x, z: Math.max(z, -limit + radius) }) };
}

function run(state: MoveState, input: MoveInput, yaw: number, frames: number, world: MoveWorld, dt = FRAME): MoveState {
  let s = state;
  for (let i = 0; i < frames; i++) s = stepMove(s, input, yaw, dt, world);
  return s;
}

const speed = (s: MoveState) => Math.hypot(s.vx, s.vz);

describe("running", () => {
  it("goes forward along -z at yaw 0, and to the left of that as yaw grows", () => {
    const ahead = run(REST, forward, 0, 60, open());
    expect(ahead.z).toBeLessThan(-4);
    expect(Math.abs(ahead.x)).toBeLessThan(1e-9);
    const left = run(REST, forward, Math.PI / 2, 60, open());
    expect(left.x).toBeLessThan(-4);
    expect(Math.abs(left.z)).toBeLessThan(1e-9);
  });

  it("strafes right along +x at yaw 0", () => {
    const s = run(REST, { forward: 0, right: 1, walk: false }, 0, 60, open());
    expect(s.x).toBeGreaterThan(4);
    expect(Math.abs(s.z)).toBeLessThan(1e-9);
  });

  it("reaches run speed within five frames and holds it exactly", () => {
    expect(speed(run(REST, forward, 0, 5, open()))).toBeCloseTo(TUNING.runSpeed, 9);
    expect(speed(run(REST, forward, 0, 300, open()))).toBeCloseTo(TUNING.runSpeed, 9);
  });

  it("stops dead within five frames of letting go", () => {
    const moving = run(REST, forward, 0, 30, open());
    const stopped = run(moving, idle, 0, 5, open());
    expect(speed(stopped)).toBe(0);
    // And slides no more than a hand's width while stopping.
    expect(Math.abs(stopped.z - moving.z)).toBeLessThan(0.15);
  });

  it("is no faster on a diagonal, and as fast sideways and backwards as forwards", () => {
    const inputs: MoveInput[] = [
      { forward: 1, right: 1, walk: false },
      { forward: 0, right: -1, walk: false },
      { forward: -1, right: 0, walk: false },
      { forward: -1, right: 1, walk: false },
    ];
    for (const input of inputs) expect(speed(run(REST, input, 0.7, 30, open()))).toBeCloseTo(TUNING.runSpeed, 9);
  });

  it("walks at walk speed with Shift", () => {
    expect(speed(run(REST, { ...forward, walk: true }, 0, 30, open()))).toBeCloseTo(TUNING.walkSpeed, 9);
  });

  it("turns a full reverse around in well under a tenth of a second", () => {
    const moving = run(REST, forward, 0, 30, open());
    const back = run(moving, { forward: -1, right: 0, walk: false }, 0, 5, open());
    expect(back.vz).toBeGreaterThan(0);
  });

  it("covers the same ground whatever the frame rate", () => {
    const smooth = run(REST, forward, 0, 240, open(), 1 / 240);
    const choppy = run(REST, forward, 0, 30, open(), 1 / 30);
    expect(choppy.z).toBeCloseTo(smooth.z, 0);
    expect(Math.abs(choppy.z - smooth.z)).toBeLessThan(0.2);
  });

  it("does nothing for a zero or negative step", () => {
    expect(stepMove(REST, forward, 0, 0, open())).toBe(REST);
    expect(stepMove(REST, forward, 0, -1, open())).toBe(REST);
  });

  it("counts the ground covered", () => {
    const s = run(REST, forward, 0, 60, open());
    expect(s.walked).toBeCloseTo(Math.abs(s.z), 9);
  });
});

describe("walls", () => {
  it("stop the body at the wall", () => {
    const s = run(REST, forward, 0, 120, walled(2));
    expect(s.z).toBeCloseTo(-2 + TUNING.radius, 9);
  });

  it("let it slide along at an angle, losing only the speed into the wall", () => {
    // Facing 45° into the wall: half the speed's square goes along it.
    const yaw = Math.PI / 4;
    const s = run(REST, forward, yaw, 120, walled(1));
    expect(s.z).toBeCloseTo(-1 + TUNING.radius, 9);
    expect(s.x).toBeLessThan(-5);
    expect(s.vz).toBeCloseTo(0, 9);
    expect(Math.abs(s.vx)).toBeCloseTo(TUNING.runSpeed * Math.SQRT1_2, 6);
  });

  it("are never jumped in one long frame: the move is cut into pieces shorter than the body", () => {
    // A thin wall at z = -1: `pushOut` only catches a body whose centre is within
    // 7 cm of it. The whole frame's move, 25 cm from z = -0.85, would land past it.
    const asked: number[] = [];
    const thin: MoveWorld = {
      ...open(),
      pushOut: (x, _y, z) => {
        asked.push(z);
        return { x, z: Math.abs(z + 1) < 0.07 ? -0.93 : z };
      },
    };
    const fast = { ...REST, z: -0.85, vz: -TUNING.runSpeed };
    expect(fast.z + fast.vz * 0.05).toBeLessThan(-1.07);
    const s = stepMove(fast, forward, 0, 0.05, thin);
    expect(s.z).toBeCloseTo(-0.93, 9);
    expect(asked.length).toBeGreaterThan(1);
    expect(Math.abs(asked[0] - fast.z)).toBeLessThanOrEqual(TUNING.radius * 0.5 + 1e-9);
  });

  it("clamp a very long frame, so a stall can't fling the player", () => {
    const s = stepMove({ ...REST, vz: -TUNING.runSpeed }, forward, 0, 5, open());
    expect(Math.abs(s.z)).toBeLessThanOrEqual(TUNING.runSpeed * 0.05 + 1e-9);
  });
});

describe("the floor", () => {
  it("holds the feet on it", () => {
    const s = run({ ...REST, y: 0.2 }, idle, 0, 120, open(0));
    expect(s.y).toBeCloseTo(0, 3);
    expect(s.grounded).toBe(true);
  });

  it("climbs a small step smoothly, not in one frame", () => {
    const stepped: MoveWorld = {
      floorBelow: (_x, fromY, z) => {
        const height = z < -1 ? 0.3 : 0;
        return height <= fromY ? height : null;
      },
      pushOut: (x, _y, z) => ({ x, z }),
    };
    let s = REST;
    let biggest = 0;
    for (let i = 0; i < 90; i++) {
      const next = stepMove(s, forward, 0, FRAME, stepped);
      biggest = Math.max(biggest, next.y - s.y);
      s = next;
    }
    expect(s.y).toBeCloseTo(0.3, 2);
    expect(biggest).toBeLessThan(0.1);
  });

  it("does not climb something taller than a step: the floor under it is not above the knee", () => {
    // A ledge at 1 m: the search starts stepUp above the feet, below the ledge.
    const ledge: MoveWorld = {
      floorBelow: (_x, fromY, z) => {
        if (z < -1 && 1 <= fromY) return 1;
        return 0 <= fromY ? 0 : null;
      },
      pushOut: (x, _y, z) => ({ x, z }),
    };
    expect(run(REST, forward, 0, 60, ledge).y).toBeCloseTo(0, 6);
  });

  it("leaves the feet at their last height over a hole, and says so", () => {
    const holed: MoveWorld = {
      floorBelow: (_x, fromY, z) => (z < -1 && z > -3 ? null : 0 <= fromY ? 0 : null),
      pushOut: (x, _y, z) => ({ x, z }),
    };
    const over = run(REST, forward, 0, 24, holed);
    expect(over.z).toBeLessThan(-1);
    expect(over.z).toBeGreaterThan(-3);
    expect(over.grounded).toBe(false);
    expect(over.y).toBe(0);
    const across = run(over, forward, 0, 60, holed);
    expect(across.grounded).toBe(true);
    expect(across.y).toBeCloseTo(0, 9);
  });

  it("does not follow a drop deeper than maxDrop", () => {
    const cliff: MoveWorld = {
      floorBelow: (_x, fromY, z, depth) => {
        const height = z < -1 ? -10 : 0;
        return height <= fromY && fromY - height <= depth ? height : null;
      },
      pushOut: (x, _y, z) => ({ x, z }),
    };
    const s = run(REST, forward, 0, 60, cliff);
    expect(s.y).toBe(0);
    expect(s.grounded).toBe(false);
  });
});

describe("looking", () => {
  it("turns right for a move to the right and up for a move up", () => {
    const look = applyLook(0, 0, 100, -50);
    expect(look.yaw).toBeLessThan(0);
    expect(look.pitch).toBeGreaterThan(0);
  });

  it("stops the pitch just short of straight up and straight down", () => {
    expect(applyLook(0, 0, 0, -1e6).pitch).toBeCloseTo((89 * Math.PI) / 180, 9);
    expect(applyLook(0, 0, 0, 1e6).pitch).toBeCloseTo((-89 * Math.PI) / 180, 9);
  });

  it("keeps the yaw within a turn", () => {
    const look = applyLook(3, 0, -1000, 0);
    expect(look.yaw).toBeGreaterThan(-Math.PI);
    expect(look.yaw).toBeLessThanOrEqual(Math.PI);
    expect(Math.cos(look.yaw)).toBeCloseTo(Math.cos(3 + 1000 * TUNING.lookSpeed), 9);
  });
});

describe("the view bob", () => {
  it("is nothing standing still, and nothing under reduced motion", () => {
    expect(viewBob(1.3, 0, false)).toBe(0);
    expect(viewBob(1.3, TUNING.runSpeed, true)).toBe(0);
  });

  it("stays within its small height and repeats every stride", () => {
    for (let d = 0; d < 10; d += 0.07) {
      expect(Math.abs(viewBob(d, TUNING.runSpeed, false))).toBeLessThanOrEqual(TUNING.bobHeight + 1e-12);
    }
    expect(viewBob(0.5 + TUNING.bobStride, TUNING.runSpeed, false)).toBeCloseTo(viewBob(0.5, TUNING.runSpeed, false), 9);
  });

  it("is smaller at a walk", () => {
    const quarter = TUNING.bobStride / 4;
    expect(viewBob(quarter, TUNING.walkSpeed, false)).toBeCloseTo(viewBob(quarter, TUNING.runSpeed, false) / 2, 9);
  });
});
