// The watched nodes' markings cross-fade over a turn (issue 115), and show at
// once under `prefers-reduced-motion`.
import { BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { CrossFade, fadeProgress } from "./fade";
import { FP_TURN_MS } from "./tuning";

const marking = (opacity: number) => {
  const material = new MeshBasicMaterial({ transparent: true, opacity });
  return { mesh: new Mesh(new BufferGeometry(), material), material };
};
const opacity = (mesh: Mesh) => (mesh.material as MeshBasicMaterial).opacity;

describe("fadeProgress", () => {
  it("runs from 0 to 1 over the fade, eased, and holds at either end", () => {
    expect(fadeProgress(-50, FP_TURN_MS)).toBe(0);
    expect(fadeProgress(0, FP_TURN_MS)).toBe(0);
    expect(fadeProgress(FP_TURN_MS / 2, FP_TURN_MS)).toBeCloseTo(0.5);
    expect(fadeProgress(FP_TURN_MS / 4, FP_TURN_MS)).toBeLessThan(0.25);
    expect(fadeProgress(FP_TURN_MS, FP_TURN_MS)).toBe(1);
    expect(fadeProgress(FP_TURN_MS * 3, FP_TURN_MS)).toBe(1);
  });

  it("is done at once for a fade of no length", () => {
    expect(fadeProgress(0, 0)).toBe(1);
  });
});

describe("CrossFade", () => {
  it("fades a turn's markings in as the last turn's go out, over the turn, then lets the old ones go", () => {
    const group = new Group();
    const fade = new CrossFade(group, FP_TURN_MS, false);
    const first = marking(0.2);
    fade.show([first], 1000);
    expect(opacity(first.mesh)).toBe(0);
    fade.update(1000 + FP_TURN_MS);
    expect(opacity(first.mesh)).toBeCloseTo(0.2);
    // The template's own opacity is never touched: the mesh draws with a copy.
    expect(first.material.opacity).toBe(0.2);
    expect(first.mesh.material).not.toBe(first.material);

    const second = marking(0.4);
    fade.show([second], 2000);
    expect(group.children).toEqual([first.mesh, second.mesh]);
    fade.update(2000 + FP_TURN_MS / 2);
    expect(opacity(first.mesh)).toBeCloseTo(0.1);
    expect(opacity(second.mesh)).toBeCloseTo(0.2);
    fade.update(2000 + FP_TURN_MS);
    expect(opacity(second.mesh)).toBeCloseTo(0.4);
    expect(group.children).toEqual([second.mesh]);
  });

  it("a turn that comes mid-fade sends the last one out from where it had got to", () => {
    const group = new Group();
    const fade = new CrossFade(group, FP_TURN_MS, false);
    const first = marking(0.2);
    const second = marking(0.2);
    const third = marking(0.2);
    fade.show([first], 0);
    fade.update(FP_TURN_MS);
    fade.show([second], FP_TURN_MS);
    fade.update(FP_TURN_MS * 1.5);
    const halfway = opacity(second.mesh);
    fade.show([third], FP_TURN_MS * 1.5);
    // The one that never finished going out is gone; the one coming in turns round from where it was.
    expect(group.children).toEqual([second.mesh, third.mesh]);
    expect(opacity(second.mesh)).toBeCloseTo(halfway);
    expect(opacity(third.mesh)).toBe(0);
  });

  it("under prefers-reduced-motion shows each turn's markings at once, with nothing left going out", () => {
    const group = new Group();
    const fade = new CrossFade(group, FP_TURN_MS, true);
    const first = marking(0.2);
    const second = marking(0.4);
    fade.show([first], 0);
    expect(opacity(first.mesh)).toBeCloseTo(0.2);
    fade.show([second], 10);
    expect(opacity(second.mesh)).toBeCloseTo(0.4);
    expect(group.children).toEqual([second.mesh]);
  });

  it("disposes every mesh it holds", () => {
    const group = new Group();
    const fade = new CrossFade(group, FP_TURN_MS, false);
    fade.show([marking(0.2)], 0);
    fade.show([marking(0.2)], 100);
    fade.dispose();
    expect(group.children).toEqual([]);
    expect(fade.meshes).toEqual([]);
  });
});
