// The switch and the amount for filling the blurred patch under each scan
// position (issue 198). What the fill looks like is checked by eye on a live
// scan; the shader's side is in spike/mesh/projection.test.ts.
import { describe, expect, it } from "vitest";
import { fillOn, NADIR_FADE } from "./scan-fill";

describe("the scan fill's switch", () => {
  it("is on when nothing is set", () => {
    expect(fillOn(undefined)).toBe(true);
    expect(fillOn("")).toBe(true);
  });

  it("is off only when it is switched off", () => {
    for (const off of ["0", "off", "false", " OFF "]) expect(fillOn(off)).toBe(false);
    for (const on of ["1", "on", "yes"]) expect(fillOn(on)).toBe(true);
  });
});

describe("how much a panorama fades under its own tripod", () => {
  it("is nearly all, and not all: with no other panorama there, its own picture is still used", () => {
    expect(NADIR_FADE).toBeGreaterThan(0.99);
    expect(NADIR_FADE).toBeLessThan(1);
  });
});
