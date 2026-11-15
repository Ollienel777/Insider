import { describe, expect, it } from "vitest";
import { wallSheets } from "./panes";
import { fitPlanes } from "./planes";

/** A wall in the plane z = 0, `nx` by `ny` squares of `size` metres, from the floor up, leaving out the columns `gap` names. */
function wall(nx: number, ny: number, size: number, gap: (x: number) => boolean) {
  const positions: number[] = [];
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) positions.push(x * size, y * size, 0);
  const index: number[] = [];
  const at = (x: number, y: number) => y * (nx + 1) + x;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      if (gap(x)) continue;
      index.push(at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y), at(x + 1, y + 1), at(x, y + 1));
    }
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}

/** The sheets' extent along x, and their height. */
function extent(triangles: Float32Array) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    xs.push(triangles[i]);
    ys.push(triangles[i + 1]);
  }
  return { x: [Math.min(...xs), Math.max(...xs)], height: Math.max(...ys) - Math.min(...ys) };
}

describe("wallSheets", () => {
  it("spans a doorway-wide gap in a room's wall with one sheet", () => {
    // 6 m of wall, 2.6 m tall, with a 1.2 m gap from x = 2.4.
    const { positions, index } = wall(30, 13, 0.2, (x) => x >= 12 && x < 18);
    const sheets = wallSheets(positions, index, fitPlanes(positions, index));
    expect(sheets.low.length).toBe(0);
    expect(sheets.tall.length).toBe(18);
    const { x, height } = extent(sheets.tall);
    expect(x[0]).toBeCloseTo(0, 1);
    expect(x[1]).toBeCloseTo(6, 1);
    expect(height).toBeCloseTo(2.6, 1);
  });

  it("leaves a gap open where cameras stood in it on both sides: a passage", () => {
    const { positions, index } = wall(30, 13, 0.2, (x) => x >= 12 && x < 18);
    const cameras: [number, number, number][] = [
      [3, 1.4, 1.2],
      [3, 1.4, -1.5],
    ];
    const sheets = wallSheets(positions, index, fitPlanes(positions, index), cameras);
    expect(sheets.tall.length).toBe(36);
  });

  it("ends a sheet at a gap wider than a doorway, and calls a low wall low", () => {
    const { positions, index } = wall(40, 6, 0.2, (x) => x >= 10 && x < 25);
    const sheets = wallSheets(positions, index, fitPlanes(positions, index));
    expect(sheets.tall.length).toBe(0);
    expect(sheets.low.length).toBe(36);
  });
});
