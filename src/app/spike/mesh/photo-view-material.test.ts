import { describe, expect, it } from "vitest";
import { photoShift } from "./photo-view-material";

const followed = (distance: number, reach: number) => distance - photoShift([distance, 0, 0], [0, 0, 0], reach)[0];

describe("photoShift", () => {
  it("follows the eye fully within the reach", () => {
    expect(photoShift([0.2, 0, 0.1], [0, 0, 0], 0.3)).toEqual([0, 0, 0]);
  });

  it("keeps following past the reach, ever less, never past three times it", () => {
    const steps = [0.5, 1, 2, 4].map((d) => followed(d, 0.3));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    expect(steps[3]).toBeLessThan(0.9);
    expect(followed(0.31, 0.3)).toBeCloseTo(0.31, 3);
  });
});
