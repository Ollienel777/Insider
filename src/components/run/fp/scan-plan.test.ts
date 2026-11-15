// The scan's plan (issue 118) on made-up buildings: two rooms either side of
// a wall with a doorway in it, a desk in one, the whole turned off the grid.
// No scan data.
import { describe, expect, it } from "vitest";
import type { Seg, Vec } from "./ground";
import { derivePlan, onPlanFloor, PLAN, planSolid, squareOf, type PlanInput, type ScanPlan } from "./scan-plan";

type P3 = [number, number, number];

const WALL_H = 2.7;
const TURN = (20 * Math.PI) / 180;

/** Plan (x, z) turned by `turn` about the origin. */
const turned = (x: number, z: number, turn: number): [number, number] => [x * Math.cos(turn) - z * Math.sin(turn), x * Math.sin(turn) + z * Math.cos(turn)];
const unturned = (x: number, z: number, turn: number): [number, number] => turned(x, z, -turn);

class Mesh {
  positions: number[] = [];
  index: number[] = [];
  constructor(private readonly turn: number) {}
  quad(corners: P3[]): void {
    const base = this.positions.length / 3;
    for (const [x, y, z] of corners) {
      const [tx, tz] = turned(x, z, this.turn);
      this.positions.push(tx, y, tz);
    }
    this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** An upright face from (x0, z0) to (x1, z1). */
  upright(x0: number, z0: number, x1: number, z1: number, bottom = 0, top = WALL_H): void {
    this.quad([[x0, bottom, z0], [x1, bottom, z1], [x1, top, z1], [x0, top, z0]]);
  }
  flat(x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.quad([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]);
  }
  box(x0: number, z0: number, x1: number, z1: number, top: number): void {
    this.upright(x0, z0, x1, z0, 0, top);
    this.upright(x1, z0, x1, z1, 0, top);
    this.upright(x1, z1, x0, z1, 0, top);
    this.upright(x0, z1, x0, z0, 0, top);
    this.flat(x0, z0, x1, z1, top);
  }
}

/**
 * Rooms A (x 0–5) and B (x 5–10), z 0–4, a 10 cm wall between them at x = 5
 * with a doorway at z 1.5–2.5, a desk in A, and outer walls all round except
 * where `openEast` leaves B's east side open onto nothing.
 */
function building(turn: number, { openEast = false } = {}) {
  const m = new Mesh(turn);
  m.flat(0, 0, 10, 4, 0);
  m.flat(0, 0, 10, 4, WALL_H);
  m.upright(0, 0, 10, 0);
  m.upright(10, 4, 0, 4);
  m.upright(0, 4, 0, 0);
  if (!openEast) m.upright(10, 0, 10, 4);
  for (const x of [4.95, 5.05]) {
    m.upright(x, 0, x, 1.5);
    m.upright(x, 2.5, x, 4);
  }
  m.upright(4.95, 1.5, 5.05, 1.5);
  m.upright(4.95, 2.5, 5.05, 2.5);
  // The desk: 0.75 m tall, with a 1.2 m monitor on it.
  m.box(1, 2.5, 2.2, 3.2, 0.75);
  m.box(1.4, 2.8, 1.9, 2.85, 1.2);
  const at = (x: number, z: number): Vec => {
    const [tx, tz] = turned(x, z, turn);
    return { x: tx, y: tz };
  };
  const nodes = [at(1.5, 1.5), at(3.5, 3), at(6.5, 1.5), at(8.5, 3)];
  const paths: Seg[] = [
    { a: nodes[0], b: nodes[1] },
    { a: nodes[1], b: nodes[2] },
    { a: nodes[2], b: nodes[3] },
  ];
  const input: PlanInput = {
    positions: m.positions,
    index: m.index,
    floorY: 0,
    ceilingY: WALL_H,
    nodes,
    paths,
    hasFloor: (x, z) => {
      const [ux, uz] = unturned(x, z, turn);
      return ux >= 0 && ux <= 10 && uz >= 0 && uz <= 4;
    },
  };
  return { input, at };
}

/** The plan's walls back in the building's own frame. */
const wallsOf = (plan: ScanPlan, turn: number) =>
  plan.walls.map((w) => {
    const [ax, az] = unturned(w.a.x, w.a.y, turn);
    const [bx, bz] = unturned(w.b.x, w.b.y, turn);
    return { ax, az, bx, bz, boundary: w.boundary };
  });

describe("derivePlan", () => {
  for (const turn of [0, TURN]) {
    describe(`a building turned ${Math.round((turn * 180) / Math.PI)}°`, () => {
      const { input, at } = building(turn);
      const plan = derivePlan(input);
      const walls = wallsOf(plan, turn);

      it("finds the building's square", () => {
        expect(Math.abs(plan.angle - turn)).toBeLessThan(0.01);
      });

      it("draws the outer walls where they are, full length", () => {
        const along = (pick: (w: (typeof walls)[number]) => boolean) => walls.filter(pick);
        const south = along((w) => Math.abs(w.az) < 0.1 && Math.abs(w.bz) < 0.1 && !w.boundary);
        const covered = south.reduce((s, w) => s + Math.abs(w.bx - w.ax), 0);
        expect(covered).toBeGreaterThan(9.4);
      });

      it("puts the dividing wall at x = 5 with the doorway left open", () => {
        const divider = walls.filter((w) => Math.abs(w.ax - 5) < 0.1 && Math.abs(w.bx - 5) < 0.1);
        expect(divider.length).toBe(2);
        const spans = divider.map((w) => [Math.min(w.az, w.bz), Math.max(w.az, w.bz)]).sort((p, q) => p[0] - q[0]);
        expect(spans[0][1]).toBeLessThanOrEqual(1.5 + PLAN.thickM / 2 + 0.01);
        expect(spans[1][0]).toBeGreaterThanOrEqual(2.5 - PLAN.thickM / 2 - 0.01);
        expect(plan.doorways.length).toBeGreaterThanOrEqual(1);
      });

      it("makes no wall of the desk or its monitor", () => {
        const inDesk = walls.some((w) => {
          const mx = (w.ax + w.bx) / 2;
          const mz = (w.az + w.bz) / 2;
          return mx > 0.8 && mx < 2.4 && mz > 2.3 && mz < 3.4;
        });
        expect(inDesk).toBe(false);
      });

      it("has floor in both rooms and none outside", () => {
        const floorAt = (x: number, z: number) => {
          const p = at(x, z);
          return onPlanFloor(plan.floor, p.x, p.y);
        };
        expect(floorAt(2, 1)).toBe(true);
        expect(floorAt(8, 2)).toBe(true);
        // Under the desk, where a scan's floor has a hole, is floor.
        expect(floorAt(1.6, 2.9)).toBe(true);
        expect(floorAt(5, -1)).toBe(false);
        expect(floorAt(11, 2)).toBe(false);
      });

      it("walks through the doorway and not through the wall", () => {
        const solid = planSolid(plan);
        const through = (from: Vec, to: Vec) => {
          const d = Math.hypot(to.x - from.x, to.y - from.y);
          return solid.hit([from.x, 1.4, from.y], [(to.x - from.x) / d, 0, (to.y - from.y) / d], d) === null;
        };
        expect(through(at(4, 2), at(6, 2))).toBe(true);
        expect(through(at(4, 0.7), at(6, 0.7))).toBe(false);
        // A body in the doorway is not pushed; one against the wall is pushed clear of it.
        const door = at(5, 2);
        const left = solid.pushOut(door.x, 0, door.y, 0.25);
        expect(Math.hypot(left.x - door.x, left.z - door.y)).toBeLessThan(1e-6);
        const wall = at(5.05, 0.8);
        const out = solid.pushOut(wall.x, 0, wall.y, 0.25);
        const [ux] = unturned(out.x, out.z, turn);
        expect(Math.abs(ux - 5)).toBeGreaterThanOrEqual(0.25 + PLAN.thickM / 2 - 0.02);
      });

      it("stands its floor where the floor is", () => {
        const solid = planSolid(plan);
        const p = at(2, 1);
        expect(solid.floorBelow(p.x, 0.6, p.y, 1.6)).toBe(0);
        const q = at(5, -2);
        expect(solid.floorBelow(q.x, 0.6, q.y, 1.6)).toBeNull();
      });
    });
  }

  it("walls the floor's edge where the scan has no wall", () => {
    const { input } = building(0, { openEast: true });
    // Floor beyond B's open side, as far as the scan reached.
    const plan = derivePlan({ ...input, hasFloor: (x, z) => x >= 0 && x <= 12 && z >= 0 && z <= 4 });
    const east = plan.walls.filter((w) => w.boundary && w.a.x > 10 && Math.abs(w.a.x - w.b.x) < 1e-6);
    expect(east.length).toBeGreaterThan(0);
    // And there it is solid.
    const solid = planSolid(plan);
    const x = Math.max(...east.map((w) => w.a.x));
    expect(solid.hit([x - 1, 1.4, 2], [1, 0, 0], 3)).not.toBeNull();
  });

  it("cuts a doorway where a walk crosses a wall the scan shows whole", () => {
    const m = new Mesh(0);
    m.flat(0, 0, 10, 4, 0);
    m.upright(5, 0, 5, 4);
    const nodes = [{ x: 3, y: 2 }, { x: 7, y: 2 }];
    const plan = derivePlan({
      positions: m.positions,
      index: m.index,
      floorY: 0,
      ceilingY: WALL_H,
      nodes,
      paths: [{ a: nodes[0], b: nodes[1] }],
      hasFloor: (x, z) => x >= 0 && x <= 10 && z >= 0 && z <= 4,
    });
    const solid = planSolid(plan);
    expect(solid.hit([3, 1.4, 2], [1, 0, 0], 4)).toBeNull();
    expect(solid.hit([3, 1.4, 0.5], [1, 0, 0], 4)).not.toBeNull();
  });
});

describe("squareOf", () => {
  it("reads the square from pieces mostly along it", () => {
    const pieces: Seg[] = [];
    for (let i = 0; i < 20; i++) {
      const [ax, az] = turned(i, 0, 0.3);
      const [bx, bz] = turned(i + 0.8, 0, 0.3);
      pieces.push({ a: { x: ax, y: az }, b: { x: bx, y: bz } });
      const [cx, cz] = turned(0, i, 0.3);
      const [dx, dz] = turned(0, i + 0.8, 0.3);
      pieces.push({ a: { x: cx, y: cz }, b: { x: dx, y: dz } });
    }
    // Clutter at odd angles, less of it.
    for (let i = 0; i < 5; i++) pieces.push({ a: { x: i, y: i }, b: { x: i + 0.3, y: i + 0.5 } });
    expect(squareOf(pieces)).toBeCloseTo(0.3, 2);
  });
});
