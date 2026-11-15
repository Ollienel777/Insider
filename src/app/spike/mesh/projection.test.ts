// The scan material's patch under a panorama's own tripod (issue 198). The
// shader's expression for how deep a ray is in the patch is also JavaScript,
// so it is run here as the shader runs it. What the fill looks like is checked
// by eye on a live scan.
import { CubeTexture, type Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createScanMaterial, NADIR_DEPTH } from "./projection";

/** GLSL's smoothstep. */
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const depthOf = new Function("smoothstep", "uNadir", "along", `return ${NADIR_DEPTH};`) as (
  step: typeof smoothstep,
  nadir: Vector3,
  along: { x: number; y: number; z: number },
) => number;

/** How deep a ray `degrees` from straight down (y up) is in the patch, by the material's own angles. */
const depthAt = (degrees: number) => {
  const nadir = createScanMaterial(new CubeTexture()).uniforms.uNadir.value as Vector3;
  const r = (degrees * Math.PI) / 180;
  return depthOf(smoothstep, nadir, { x: Math.sin(r), y: -Math.cos(r), z: 0 });
};

describe("the patch under a panorama's own tripod", () => {
  it("is off until a caller turns it on: the blend is as it was", () => {
    for (const backdrop of [false, true]) {
      const nadir = createScanMaterial(new CubeTexture(), backdrop).uniforms.uNadir.value as Vector3;
      expect(nadir.z).toBe(0);
    }
  });

  // Measured by eye on a live scan: the blur under the tripod reached about 27° from straight down.
  it("covers in full the floor the photograph blurs, out to 27° from straight down", () => {
    for (let degrees = 0; degrees <= 27; degrees += 1) expect(depthAt(degrees)).toBe(1);
  });

  // At a tripod 1.4 m up, 35° is 1 m out from its foot: past that the panorama's own picture is sharp.
  it("leaves the panorama's sharp picture alone past 35° from straight down, and everything above", () => {
    for (let degrees = 35; degrees <= 180; degrees += 5) expect(depthAt(degrees)).toBe(0);
  });

  it("is what the shader runs, for every panorama it blends", () => {
    const { fragmentShader } = createScanMaterial(new CubeTexture());
    expect(fragmentShader).toContain(`nadir = uNadir.z * ${NADIR_DEPTH};`);
    for (let i = 0; i < 4; i++) expect(fragmentShader).toContain(`m[${i}], n[${i}]);`);
  });
});
