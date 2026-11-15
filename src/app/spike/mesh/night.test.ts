// The night look's uniforms and its plain floor and ceiling (issue 198), on
// made-up heights. The shader itself is checked by eye on a live scan.
import { ShaderMaterial, type Mesh, type Vector4 } from "three";
import { describe, expect, it } from "vitest";
import { applyNight, createNightFill, NIGHT_GLSL, nightUniforms, type NightLook } from "./night";

const LOOK: NightLook = { ambient: 0.2, torch: 1.3, reachM: 7, coneDeg: 60, floorY: -0.2, ceilingY: 3.1 };

describe("the night look on a material", () => {
  it("is off until it is applied, and off again with null", () => {
    const material = new ShaderMaterial({ uniforms: nightUniforms() });
    expect(material.uniforms.uNight.value).toBe(0);
    applyNight(material, LOOK);
    expect(material.uniforms.uNight.value).toBe(1);
    const torch = material.uniforms.uTorch.value as Vector4;
    expect([torch.x, torch.y, torch.z]).toEqual([0.2, 1.3, 7]);
    expect(torch.w).toBeCloseTo(0.5);
    applyNight(material, null);
    expect(material.uniforms.uNight.value).toBe(0);
  });

  it("gives each material its own uniforms", () => {
    expect(nightUniforms().uTorch.value).not.toBe(nightUniforms().uTorch.value);
  });

  it("leaves the colour alone when the look is off", () => {
    expect(NIGHT_GLSL).toContain("if (uNight < 0.5) return colour;");
  });
});

describe("the plain floor and ceiling", () => {
  const heights = (look: NightLook) => createNightFill(look).group.children.map((child) => child.position.y);

  it("puts a flat plane at each height it is given, lit by the look", () => {
    const fill = createNightFill(LOOK);
    expect(fill.group.children.map((child) => child.position.y)).toEqual([-0.2, 3.1]);
    for (const child of fill.group.children) {
      const mesh = child as Mesh;
      expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2);
      expect((mesh.material as ShaderMaterial).uniforms.uNight.value).toBe(1);
    }
  });

  it("leaves out a height it is not given", () => {
    expect(heights({ ...LOOK, ceilingY: null })).toEqual([-0.2]);
    expect(heights({ ...LOOK, floorY: null, ceilingY: null })).toEqual([]);
  });

  it("leaves the scene when it is disposed", () => {
    const fill = createNightFill(LOOK);
    const parent = createNightFill(LOOK).group;
    parent.add(fill.group);
    fill.dispose();
    expect(fill.group.parent).toBeNull();
  });
});
