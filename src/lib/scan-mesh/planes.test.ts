import { describe, expect, it } from "vitest";
import { cellRects, fillPlanes, fitPlanes, fitUnseen, gridHoles, maskRuns, PATCH_BEHIND, planeBasis, PLANE_LIMITS } from "./planes";

type Skip = (x: number, y: number) => boolean;

/**
 * A wall in the plane z = `z`: `nx` by `ny` squares of `size` metres, two
 * triangles a square, from the floor up, leaving out the squares `skip` names.
 */
function wall(nx: number, ny: number, size: number, z: number, skip: Skip = () => false, base = 0) {
  const positions: number[] = [];
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) positions.push(x * size, y * size, z);
  const index: number[] = [];
  const at = (x: number, y: number) => base + y * (nx + 1) + x;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      if (skip(x, y)) continue;
      index.push(at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y), at(x + 1, y + 1), at(x, y + 1));
    }
  }
  return { positions, index };
}

describe("fitPlanes", () => {
  it("finds a wall and a floor, and gives each its triangles", () => {
    const a = wall(20, 20, 0.1, 0);
    // The floor: the same grid laid flat, y and z swapped.
    const b = wall(20, 20, 0.1, 0, undefined, a.positions.length / 3);
    const floor: number[] = [];
    for (let i = 0; i < b.positions.length; i += 3) floor.push(b.positions[i], 0, b.positions[i + 1]);
    const positions = Float32Array.from([...a.positions, ...floor]);
    const index = Uint32Array.from([...a.index, ...b.index]);
    const fit = fitPlanes(positions, index);
    expect(fit.planes).toHaveLength(2);
    const upright = fit.planes.findIndex((p) => Math.abs(p.normal[2]) > 0.99);
    const level = fit.planes.findIndex((p) => Math.abs(p.normal[1]) > 0.99);
    expect(upright).not.toBe(-1);
    expect(level).not.toBe(-1);
    expect(fit.planes[upright].area).toBeCloseTo(4, 3);
    expect(Math.abs(fit.planes[upright].offset)).toBeCloseTo(0, 5);
    expect(fit.owner[0]).toBe(upright);
    expect(fit.owner[fit.owner.length - 1]).toBe(level);
  });

  it("keeps two parallel walls apart", () => {
    const a = wall(10, 10, 0.1, 0);
    const b = wall(10, 10, 0.1, 0.5, undefined, a.positions.length / 3);
    const fit = fitPlanes(Float32Array.from([...a.positions, ...b.positions]), Uint32Array.from([...a.index, ...b.index]));
    expect(fit.planes).toHaveLength(2);
    expect(fit.owner[0]).not.toBe(fit.owner[fit.owner.length - 1]);
  });

  it("takes a slightly bumpy wall as one plane, and leaves out what stands off it", () => {
    const a = wall(20, 20, 0.1, 0);
    for (let i = 2; i < a.positions.length; i += 3) a.positions[i] = ((i * 7919) % 11) * 0.001;
    const v = a.positions.length / 3;
    // A shelf sticking out of the wall.
    a.positions.push(0.5, 1, 0, 0.9, 1, 0, 0.7, 1, 0.4);
    a.index.push(v, v + 1, v + 2);
    const fit = fitPlanes(Float32Array.from(a.positions), Uint32Array.from(a.index));
    expect(fit.planes).toHaveLength(1);
    expect(fit.owner[0]).toBe(0);
    expect(fit.owner[fit.owner.length - 1]).toBe(-1);
  });

  it("ignores a surface smaller than the least area", () => {
    const a = wall(3, 3, 0.1, 0);
    expect(fitPlanes(Float32Array.from(a.positions), Uint32Array.from(a.index)).planes).toHaveLength(0);
  });
});

describe("planeBasis", () => {
  it("has up as the second axis of an upright plane, both at right angles to the normal", () => {
    const { u, v } = planeBasis([0, 0, 1]);
    expect(v[1]).toBeCloseTo(1);
    expect(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]).toBeCloseTo(0);
    expect(u[2]).toBeCloseTo(0);
  });

  it("gives a level plane two level axes", () => {
    const { u, v } = planeBasis([0, 1, 0]);
    expect(u[1]).toBeCloseTo(0);
    expect(v[1]).toBeCloseTo(0);
    expect(Math.hypot(...u)).toBeCloseTo(1);
    expect(Math.hypot(...v)).toBeCloseTo(1);
  });
});

describe("gridHoles", () => {
  const grid = (rows: string[]) => ({
    filled: Uint8Array.from(rows.join("").split("").map((c) => (c === "#" ? 1 : 0))),
    width: rows[0].length,
    height: rows.length,
  });

  it("finds a gap the surface encloses", () => {
    const g = grid([".......", ".#####.", ".#..##.", ".#..##.", ".#####.", "......."]);
    const holes = gridHoles(g.filled, g.width, g.height);
    expect(holes).toHaveLength(1);
    expect(holes[0].cells).toHaveLength(4);
    expect([holes[0].minX, holes[0].maxX, holes[0].minY, holes[0].maxY]).toEqual([2, 3, 2, 3]);
  });

  it("leaves a gap that reaches the edge open: a doorway", () => {
    const g = grid([".......", ".#####.", ".#..##.", ".#..##.", "......."]);
    expect(gridHoles(g.filled, g.width, g.height)).toHaveLength(0);
  });

  it("does not join gaps that touch only at a corner", () => {
    const g = grid([".....", ".###.", ".#.#.", ".##..", "....."]);
    // The middle gap touches the outside only cornerwise: still enclosed.
    expect(gridHoles(g.filled, g.width, g.height)).toHaveLength(1);
  });

  it("finds each gap of several", () => {
    const g = grid(["#######", "#.#...#", "#.#...#", "#######"]);
    const sizes = gridHoles(g.filled, g.width, g.height).map((h) => h.cells.length);
    expect(sizes.sort()).toEqual([2, 6]);
  });
});

describe("cellRects", () => {
  it("covers exactly the marked cells", () => {
    const rows = ["##..", "##.#", ".###", "...."];
    const mask = Uint8Array.from(rows.join("").split("").map((c) => (c === "#" ? 1 : 0)));
    const rects = cellRects(mask, 4, 4);
    const drawn = new Uint8Array(16);
    for (let r = 0; r < rects.length; r += 4) {
      for (let y = rects[r + 1]; y < rects[r + 3]; y++) for (let x = rects[r]; x < rects[r + 2]; x++) drawn[y * 4 + x]++;
    }
    expect([...drawn]).toEqual([...mask]);
    // The two full rows of the left block are one rectangle.
    expect(rects.slice(0, 4)).toEqual([0, 0, 2, 2]);
  });
});

describe("fillPlanes", () => {
  it("closes a gap inside a wall with rectangles in the wall's plane", () => {
    // 3 m by 2.5 m, with a 0.5 m square gap in the middle.
    const a = wall(30, 25, 0.1, 2, (x, y) => x >= 12 && x < 17 && y >= 10 && y < 15);
    const positions = Float32Array.from(a.positions);
    const index = Uint32Array.from(a.index);
    const fit = fitPlanes(positions, index);
    const fill = fillPlanes(positions, index, fit);
    expect(fill.patches).toHaveLength(1);
    const patch = fill.patches[0];
    expect(patch.area).toBeGreaterThan(0.15);
    expect(patch.area).toBeLessThan(0.3);
    let area = 0;
    for (let i = patch.start * 3; i < (patch.start + patch.count) * 3; i += 9) {
      const p = fill.positions;
      // In the wall's plane, a step behind it.
      for (const k of [2, 5, 8]) expect(Math.abs(p[i + k] - 2)).toBeCloseTo(PATCH_BEHIND, 4);
      area += Math.abs((p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) - (p[i + 6] - p[i]) * (p[i + 4] - p[i + 1])) / 2;
      // Over the gap, a cell's width past it at most.
      for (const k of [0, 3, 6]) {
        expect(p[i + k]).toBeGreaterThan(1.2 - 2.5 * PLANE_LIMITS.cell);
        expect(p[i + k]).toBeLessThan(1.7 + 2.5 * PLANE_LIMITS.cell);
      }
    }
    // The gap and its tuck under the wall's edge.
    expect(area).toBeGreaterThanOrEqual(0.25);
    expect(area).toBeLessThan(0.5);
    // Texture coordinates stay inside the patch's box.
    for (let i = patch.start * 2; i < (patch.start + patch.count) * 2; i++) {
      expect(fill.uvs[i]).toBeGreaterThan(0);
      expect(fill.uvs[i]).toBeLessThan(1);
    }
  });

  it("leaves a doorway open", () => {
    // A 0.9 m by 2 m opening from the floor up.
    const a = wall(30, 25, 0.1, 0, (x, y) => x >= 10 && x < 19 && y < 20);
    const positions = Float32Array.from(a.positions);
    const index = Uint32Array.from(a.index);
    const fill = fillPlanes(positions, index, fitPlanes(positions, index));
    expect(fill.patches).toHaveLength(0);
  });

  it("leaves a doorway with a sill across it open", () => {
    // The same opening, but the wall's lowest row runs under it.
    const a = wall(30, 25, 0.1, 0, (x, y) => x >= 10 && x < 19 && y >= 1 && y < 20);
    const positions = Float32Array.from(a.positions);
    const index = Uint32Array.from(a.index);
    const fill = fillPlanes(positions, index, fitPlanes(positions, index));
    expect(fill.patches).toHaveLength(0);
    expect(fill.open).toBe(1);
  });

  it("leaves a gap larger than the limit open", () => {
    const a = wall(60, 40, 0.1, 0, (x, y) => x >= 5 && x < 55 && y >= 12 && y < 35);
    const positions = Float32Array.from(a.positions);
    const index = Uint32Array.from(a.index);
    const fill = fillPlanes(positions, index, fitPlanes(positions, index));
    expect(fill.patches).toHaveLength(0);
    expect(fill.open).toBe(1);
  });
});

describe("maskRuns", () => {
  it("finds each run of marked cells and its box", () => {
    const rows = ["##...", "#..##", "...#."];
    const mask = Uint8Array.from(rows.join("").split("").map((c) => (c === "#" ? 1 : 0)));
    const runs = maskRuns(mask, 5, 3);
    expect(runs.map((r) => r.cells.length).sort()).toEqual([3, 3]);
    const right = runs.find((r) => r.maxX === 4)!;
    expect([right.minX, right.maxX, right.minY, right.maxY]).toEqual([3, 4, 1, 2]);
  });
});

describe("fillPlanes with what was seen", () => {
  /** A 3 m by 2.5 m wall, of which the squares `unseen` names were seen by no panorama. */
  function seenWall(unseen: (x: number, y: number) => boolean) {
    const a = wall(30, 25, 0.1, 0);
    const positions = Float32Array.from(a.positions);
    const index = Uint32Array.from(a.index);
    const seen = new Uint8Array(index.length / 3);
    for (let y = 0; y < 25; y++) for (let x = 0; x < 30; x++) seen.fill(unseen(x, y) ? 0 : 1, (y * 30 + x) * 2, (y * 30 + x) * 2 + 2);
    return { positions, index, seen };
  }

  it("stands in for a stretch of wall nobody saw, and names its triangles for leaving out", () => {
    const { positions, index, seen } = seenWall((x, y) => x >= 10 && x < 20 && y >= 8 && y < 16);
    const fill = fillPlanes(positions, index, fitPlanes(positions, index), PLANE_LIMITS, seen);
    expect(fill.patches).toHaveLength(1);
    expect(fill.unseenArea).toBeGreaterThan(0.6);
    expect(fill.unseenArea).toBeLessThanOrEqual(0.8 + 1e-6);
    let dropped = 0;
    fill.replaced.forEach((r, t) => {
      if (!r) return;
      dropped++;
      // Only unseen triangles are ever left out.
      expect(seen[t]).toBe(0);
    });
    // Nearly all of the 160 unseen triangles (the rim's keep their half-seen cells).
    expect(dropped).toBeGreaterThan(120);
  });

  it("gives a wall nobody saw any of a donor: a well-seen square of another wall", () => {
    const hidden = wall(30, 25, 0.1, 0);
    // A second wall, all seen, three metres off.
    const shown = wall(30, 25, 0.1, 3, undefined, hidden.positions.length / 3);
    const positions = Float32Array.from([...hidden.positions, ...shown.positions]);
    const index = Uint32Array.from([...hidden.index, ...shown.index]);
    const seen = new Uint8Array(index.length / 3).fill(1);
    seen.fill(0, 0, hidden.index.length / 3);
    const fit = fitPlanes(positions, index);
    const fill = fillPlanes(positions, index, fit, PLANE_LIMITS, seen);
    expect(fill.patches.length).toBeGreaterThan(0);
    for (const patch of fill.patches) {
      expect(patch.donor).toBeDefined();
      // The donor square lies in the seen wall's plane.
      expect(Math.abs(patch.donor!.origin[2] - 3)).toBeCloseTo(PATCH_BEHIND, 4);
      expect(patch.donor!.size).toBeCloseTo(PLANE_LIMITS.donor, 5);
      // No patch is larger than a tile and its margins.
      expect(patch.width).toBeLessThanOrEqual(PLANE_LIMITS.tile + 1);
      expect(patch.height).toBeLessThanOrEqual(PLANE_LIMITS.tile + 1);
    }
    // The hidden wall's triangles are left out, the seen wall's kept.
    expect(fill.replaced[0]).toBe(1);
    expect(fill.replaced[fill.replaced.length - 1]).toBe(0);
  });

  it("names no donor for a patch with seen surface beside it", () => {
    const { positions, index, seen } = seenWall((x, y) => x >= 10 && x < 20 && y >= 8 && y < 16);
    const fill = fillPlanes(positions, index, fitPlanes(positions, index), PLANE_LIMITS, seen);
    expect(fill.patches[0].donor).toBeUndefined();
  });

  it("changes nothing in a wall that was all seen", () => {
    const { positions, index, seen } = seenWall(() => false);
    const fill = fillPlanes(positions, index, fitPlanes(positions, index), PLANE_LIMITS, seen);
    expect(fill.patches).toHaveLength(0);
    expect(fill.unseenArea).toBe(0);
  });
});

describe("fillPlanes on a floor", () => {
  /** `size` metres square of surface facing up at height `y`, its corner at (`x`, `x`). */
  function slab(cells: number, y: number, x: number, base: number) {
    const a = wall(cells, cells, 0.1, 0, undefined, base);
    const positions: number[] = [];
    // Wound to face up: x and z swapped.
    for (let i = 0; i < a.positions.length; i += 3) positions.push(a.positions[i + 1] + x, y, a.positions[i] + x);
    return { positions, index: a.index };
  }

  it("carries a floor on past its edge, and a table top not at all", () => {
    const floor = slab(40, 0, 0, 0);
    const table = slab(10, 0.75, 1, floor.positions.length / 3);
    const positions = Float32Array.from([...floor.positions, ...table.positions]);
    const index = Uint32Array.from([...floor.index, ...table.index]);
    const fit = fitPlanes(positions, index);
    expect(fit.planes).toHaveLength(2);
    expect(fit.planes[0].normal[1]).toBeGreaterThan(0.99);
    const fill = fillPlanes(positions, index, fit, PLANE_LIMITS, null, [1.4]);
    expect(fill.patches.length).toBeGreaterThan(0);
    let outside = 0;
    for (let i = 0; i < fill.positions.length; i += 3) {
      // Every patch is in the floor's plane, none in the table's.
      expect(Math.abs(fill.positions[i + 1])).toBeCloseTo(PATCH_BEHIND, 4);
      const x = fill.positions[i];
      const z = fill.positions[i + 2];
      if (x < -0.5 || x > 4.5 || z < -0.5 || z > 4.5) outside++;
      expect(Math.max(-x, x - 4, -z, z - 4)).toBeLessThan(PLANE_LIMITS.levelReach + 0.1);
    }
    expect(outside).toBeGreaterThan(0);
  });

  it("does not carry on the desk tops of an open office, however much of them there is", () => {
    // 16 m² of desk top at desk height, and the camera at 1.4 m: too near under it for a floor.
    const desks = slab(40, 0.75, 0, 0);
    const positions = Float32Array.from(desks.positions);
    const index = Uint32Array.from(desks.index);
    const fit = fitPlanes(positions, index);
    expect(fillPlanes(positions, index, fit, PLANE_LIMITS, null, [1.4]).patches).toHaveLength(0);
    // The same surface as a floor, a camera's height under the camera, is carried on.
    expect(fillPlanes(positions, index, fit, PLANE_LIMITS, null, [2.15]).patches.length).toBeGreaterThan(0);
  });

  it("takes no plane for a floor when it is not told where the cameras were", () => {
    const floor = slab(40, 0, 0, 0);
    const positions = Float32Array.from(floor.positions);
    const index = Uint32Array.from(floor.index);
    expect(fillPlanes(positions, index, fitPlanes(positions, index)).patches).toHaveLength(0);
  });
});

describe("fitUnseen", () => {
  /** A 1.6 m by 2.5 m wall at z = 0, bowed in and out by 8 cm along its length: too warped for the careful fit to hold much of. */
  function warped() {
    const a = wall(16, 25, 0.1, 0);
    for (let i = 0; i < a.positions.length; i += 3) a.positions[i + 2] = 0.08 * Math.sin((2 * Math.PI * a.positions[i]) / 1.6);
    return { positions: Float32Array.from(a.positions), index: Uint32Array.from(a.index) };
  }
  const held = (owner: Int32Array) => [...owner].filter((p) => p >= 0).length;

  it("takes the rest of a warped wall nobody saw for a plane, which the careful fit leaves loose", () => {
    const { positions, index } = warped();
    // A fit stricter still than the usual one, so that it is certain to leave most of the wall loose.
    const fit = fitPlanes(positions, index, { ...PLANE_LIMITS, distance: 0.005, cosine: Math.cos((3 * Math.PI) / 180) });
    const careful = fit.planes.length;
    const before = held(fit.owner);
    expect(before).toBeLessThan(fit.owner.length * 0.6);
    const added = fitUnseen(positions, index, fit, new Uint8Array(index.length / 3));
    expect(added).toBeGreaterThan(0);
    expect(fit.planes).toHaveLength(careful + added);
    expect(held(fit.owner)).toBeGreaterThan(fit.owner.length * 0.8);
    // The new planes are numbered after the old, and face the way the wall does.
    expect(Math.max(...fit.owner)).toBe(fit.planes.length - 1);
    expect(Math.abs(fit.planes[fit.planes.length - 1].normal[2])).toBeGreaterThan(0.9);
  });

  it("leaves alone what a panorama saw", () => {
    const { positions, index } = warped();
    const fit = fitPlanes(positions, index);
    const before = [...fit.owner];
    const planes = fit.planes.length;
    expect(fitUnseen(positions, index, fit, new Uint8Array(index.length / 3).fill(1))).toBe(0);
    expect(fit.planes).toHaveLength(planes);
    expect([...fit.owner]).toEqual(before);
  });
});
