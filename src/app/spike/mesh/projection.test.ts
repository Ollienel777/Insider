// The scan material's fade under a panorama's own tripod (issue 198): off by
// default, and wired into the weight of every panorama. What it draws is
// checked by eye on a live scan.
import { CubeTexture, type Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createScanMaterial, NADIR_INNER_DEG, NADIR_OUTER_DEG } from "./projection";

const cos = (degrees: number) => Math.cos((degrees * Math.PI) / 180);

describe("the fade under a panorama's own tripod", () => {
  it("is off until a caller turns it on: the blend is as it was", () => {
    for (const backdrop of [false, true]) {
      const nadir = createScanMaterial(new CubeTexture(), backdrop).uniforms.uNadir.value as Vector3;
      expect(nadir.z).toBe(0);
    }
  });

  it("covers a patch that is narrower inside than out, both well short of the horizon", () => {
    expect(NADIR_INNER_DEG).toBeLessThan(NADIR_OUTER_DEG);
    expect(NADIR_OUTER_DEG).toBeLessThan(60);
    const nadir = createScanMaterial(new CubeTexture()).uniforms.uNadir.value as Vector3;
    expect(nadir.x).toBeCloseTo(cos(NADIR_OUTER_DEG));
    expect(nadir.y).toBeCloseTo(cos(NADIR_INNER_DEG));
    // The cosine grows towards straight down, so the fade runs from the outer angle's to the inner's.
    expect(nadir.x).toBeLessThan(nadir.y);
  });

  it("scales a panorama's weight, so one that saw the floor from the side takes over", () => {
    const { fragmentShader } = createScanMaterial(new CubeTexture());
    expect(fragmentShader).toContain("base *= 1.0 - uNadir.z * smoothstep(uNadir.x, uNadir.y, -along.y);");
  });
});
