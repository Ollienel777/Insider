// The switch and the amount for filling the blurred patch under each scan
// position (issue 198), and what first person's setting does to the blend:
// through the scan renderer's own setter and material, into the shader's sums
// (lib/scan-mesh/combine.ts). What the fill looks like is checked by eye on a
// live scan.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CubeTexture, type Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createScanMaterial, NADIR_DEPTH } from "@/app/spike/mesh/projection";
import { ScanView } from "@/app/spike/mesh/scan-view";
import { combineSamples, type PanoSample } from "@/lib/scan-mesh/combine";
import { fillOn, fillScan, NADIR_FADE, type NadirFadeTarget } from "./scan-fill";

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

describe("how much a panorama gives up under its own tripod", () => {
  it("is nearly all, and not all", () => {
    expect(NADIR_FADE).toBeGreaterThan(0.99);
    expect(NADIR_FADE).toBeLessThan(1);
  });
});

/** The scan renderer's real setter, on a material of its own (a ScanView needs WebGL to be built). */
const viewOnMaterial = () => {
  const material = createScanMaterial(new CubeTexture());
  const view = { material, setNadirFade: ScanView.prototype.setNadirFade } as unknown as NadirFadeTarget;
  return { view, nadir: material.uniforms.uNadir.value as Vector3 };
};

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const depthOf = new Function("smoothstep", "uNadir", "along", `return ${NADIR_DEPTH};`) as (
  step: typeof smoothstep,
  nadir: Vector3,
  along: { x: number; y: number; z: number },
) => number;

/**
 * The floor 0.4 m from the foot of a tripod 1.5 m up, as the shader sums it:
 * the panorama overhead has the blurred picture and most of the say; a
 * neighbour saw that floor from the side, or had its view blocked short of it.
 */
const floorUnderTripod = (nadir: Vector3, neighbourSaw: boolean) => {
  const reach = Math.hypot(0.4, 1.5);
  const nadirSay = nadir.z * depthOf(smoothstep, nadir, { x: 0.4 / reach, y: -1.5 / reach, z: 0 });
  const samples: PanoSample[] = [
    { colour: [0.5, 0.5, 0.5], base: 2, seen: 1, miss: 0, nadir: nadirSay },
    neighbourSaw ? { colour: [0.55, 0.4, 0.3], base: 0.5, seen: 1, miss: 0 } : { colour: [0.1, 0.1, 0.12], base: 0.5, seen: 0, miss: 0.6 },
  ];
  return combineSamples(samples, { agree: true, fill: true }).weights;
};

describe("first person's fill, through the renderer into the blend", () => {
  it("lets a neighbour that saw the floor under a tripod paint it", () => {
    const { view, nadir } = viewOnMaterial();
    fillScan(view, "");
    expect(nadir.z).toBe(NADIR_FADE);
    expect(floorUnderTripod(nadir, true)[1]).toBeGreaterThan(0.99);
  });

  it("keeps the panorama overhead where the neighbour's view was blocked", () => {
    const { view, nadir } = viewOnMaterial();
    fillScan(view, "");
    expect(floorUnderTripod(nadir, false)[0]).toBeGreaterThan(0.99);
  });

  it("leaves the blend as it was when switched off, and when first person closes", () => {
    const off = viewOnMaterial();
    fillScan(off.view, "0");
    expect(off.nadir.z).toBe(0);
    expect(floorUnderTripod(off.nadir, true)[0]).toBeGreaterThan(0.5);

    const closed = viewOnMaterial();
    fillScan(closed.view, "")();
    expect(closed.nadir.z).toBe(0);
  });

  it("keeps the renderer's setting between 0 and 1", () => {
    const { view, nadir } = viewOnMaterial();
    view.setNadirFade(3);
    expect(nadir.z).toBe(1);
    view.setNadirFade(-1);
    expect(nadir.z).toBe(0);
  });

  it("is what first person on a scan turns on, and turns off when it closes", () => {
    const source = readFileSync(fileURLToPath(new URL("./first-person-view.tsx", import.meta.url)), "utf8");
    expect(source).toMatch(/const unfill = fillScan\(view\);/);
    expect(source).toMatch(/dispose\(\) \{\s*pieces\.removeFromParent\(\);\s*unfill\(\);/);
    // Nothing else in first person sets the amount.
    expect(source).not.toMatch(/setNadirFade/);
  });
});
