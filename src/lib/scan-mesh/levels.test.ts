import { describe, expect, it } from "vitest";
import { fitLevels, type LevelOptions } from "./levels";

const OPTIONS: LevelOptions = { gap: 0.6, behind: 0.05, margin: 2, room: 2.7 };

describe("fitLevels", () => {
  it("is one level for scan positions on one floor, its planes just behind the floor and ceiling", () => {
    const levels = fitLevels(
      [
        { x: 0, z: 0, floor: 0, ceiling: 2.6 },
        { x: 4, z: -3, floor: 0.02, ceiling: 2.62 },
        { x: 8, z: 1, floor: -0.01, ceiling: 2.6 },
      ],
      OPTIONS,
    );
    expect(levels).toHaveLength(1);
    const [level] = levels;
    expect(level.floor).toBeCloseTo(-0.01 - 0.05, 6);
    expect(level.ceiling).toBeCloseTo(2.6 + 0.05, 6);
    expect(level.min).toEqual([-2, -5]);
    expect(level.max).toEqual([10, 3]);
  });

  it("splits floors farther apart than the gap into levels, lowest first", () => {
    const levels = fitLevels(
      [
        { x: 0, z: 0, floor: 3.4, ceiling: 6 },
        { x: 0, z: 0, floor: 0, ceiling: 2.8 },
        { x: 1, z: 1, floor: 0.3, ceiling: 2.8 },
      ],
      OPTIONS,
    );
    expect(levels.map((l) => +l.floor.toFixed(2))).toEqual([-0.05, 3.35]);
  });

  it("takes the median ceiling, so one tall room doesn't lift the level's", () => {
    const [level] = fitLevels(
      [
        { x: 0, z: 0, floor: 0, ceiling: 2.7 },
        { x: 1, z: 0, floor: 0, ceiling: 2.7 },
        { x: 2, z: 0, floor: 0, ceiling: 7 },
      ],
      OPTIONS,
    );
    expect(level.ceiling).toBeCloseTo(2.75, 6);
  });

  it("falls back to the head room where no ceiling was found, or the one found is too low", () => {
    const [none] = fitLevels([{ x: 0, z: 0, floor: 1, ceiling: null }], OPTIONS);
    expect(none.ceiling).toBeCloseTo(1 + 2.7 + 0.05, 6);
    const [low] = fitLevels([{ x: 0, z: 0, floor: 0, ceiling: 0.5 }], OPTIONS);
    expect(low.ceiling).toBeCloseTo(2.7 + 0.05, 6);
    expect(fitLevels([], OPTIONS)).toEqual([]);
  });
});
