// Projection (issue 108): the scene's marks as pixels in the player's frame,
// from the Inside view's `project` on a stubbed pose. Each mark is drawn from
// its floor point, so it stays on the floor while the camera turns and travels.
import { describe, expect, it } from "vitest";
import type { ScanPoint } from "@/adapters/matterport";
import { ease, FIGURE_M, floorRing, layout, lerp, raise, upright, type Drawn } from "./projection";
import { sceneOf, type Mark } from "./scene";
import { FLOOR_Y, FRAME, pinhole, POINTS, pose, run } from "./testing";

const ahead = (metres: number): ScanPoint => ({ x: 0, y: FLOOR_Y, z: -metres });
const origin = pose({ x: 0, z: 0 });

describe("lerp, raise and ease", () => {
  it("lerp runs from one point to the other", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 2, y: 4, z: -6 };
    expect(lerp(a, b, 0)).toEqual(a);
    expect(lerp(a, b, 1)).toEqual(b);
    expect(lerp(a, b, 0.5)).toEqual({ x: 1, y: 2, z: -3 });
  });

  it("raise lifts a point straight up (the scan is y-up)", () => {
    expect(raise({ x: 1, y: 2, z: 3 }, 1.5)).toEqual({ x: 1, y: 3.5, z: 3 });
  });

  it("ease starts at 0, ends at 1, never turns back, and clamps", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    let last = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      expect(ease(t)).toBeGreaterThanOrEqual(last);
      last = ease(t);
    }
    // Ease-out, like the board's hops: most of the way in the first half.
    expect(ease(0.5)).toBeGreaterThan(0.5);
  });
});

describe("upright: a figure standing on a floor point", () => {
  it("stands its feet on the floor point's pixel, sized by its distance", () => {
    const project = pinhole(origin);
    const near = upright(project, ahead(4), FIGURE_M, FRAME)!;
    const far = upright(project, ahead(8), FIGURE_M, FRAME)!;
    expect(near.x).toBeCloseTo(FRAME.width / 2);
    expect(near.bottom).toBeCloseTo(project(ahead(4))!.y);
    expect(near.top).toBeCloseTo(project(raise(ahead(4), FIGURE_M))!.y);
    // Twice as far, half as tall.
    expect(near.bottom - near.top).toBeCloseTo(2 * (far.bottom - far.top));
  });

  it("draws nothing behind the camera, off the frame, or too small to read", () => {
    expect(upright(pinhole(pose({ x: 0, z: 0 }, 180)), ahead(4), FIGURE_M, FRAME)).toBeNull();
    // 45° to the side at 90° field of view is the frame's edge; 70° is well past it.
    const side = { x: -Math.tan((70 * Math.PI) / 180) * 4, y: FLOOR_Y, z: -4 };
    expect(upright(pinhole(origin), side, FIGURE_M, FRAME)).toBeNull();
    expect(upright(pinhole(origin), ahead(500), FIGURE_M, FRAME)).toBeNull();
  });

  it("drops a point the SDK returns as huge numbers, beside the camera", () => {
    const wild = () => ({ x: 1e9, y: -1e9 });
    expect(upright(wild, ahead(4), FIGURE_M, FRAME)).toBeNull();
  });
});

describe("floorRing", () => {
  it("lies on the floor: wider than tall, centred on the floor point", () => {
    const project = pinhole(origin);
    const ring = floorRing(project, ahead(4), 0.5, FRAME)!;
    expect(ring.length).toBeGreaterThanOrEqual(16);
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(width).toBeGreaterThan(height * 2);
    const centre = project(ahead(4))!;
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(centre.x);
    expect(Math.min(...ys)).toBeLessThan(centre.y);
    expect(Math.max(...ys)).toBeGreaterThan(centre.y);
  });

  it("draws nothing when part of it is behind the camera, or all of it off the frame", () => {
    expect(floorRing(pinhole(origin), ahead(0.2), 0.5, FRAME)).toBeNull();
    expect(floorRing(pinhole(pose({ x: 0, z: 0 }, 180)), ahead(4), 0.5, FRAME)).toBeNull();
  });
});

describe("layout", () => {
  const marks = sceneOf({ run: run({ start: "a2" }), points: POINTS, aimed: "a3" });
  const figure = (drawn: readonly Drawn[], id: string) =>
    drawn.find((d): d is Extract<Drawn, { kind: "figure" }> => d.kind === "figure" && d.id === id);

  it("keeps a guard on its floor point while the camera turns", () => {
    const at = pose({ x: 0, z: -2 });
    for (const yaw of [0, 10, -15, 30]) {
      const look = pose({ x: 0, z: -2 }, yaw);
      const drawn = layout(marks, pinhole(look), look, FRAME);
      const g1 = figure(drawn, "G1")!;
      const feet = pinhole(look)(POINTS.get("a3")!)!;
      expect(g1.x).toBeCloseTo(feet.x);
      expect(g1.bottom).toBeCloseTo(feet.y);
    }
    // Turning moves it across the frame: it is fixed to the floor, not the screen.
    const straight = figure(layout(marks, pinhole(at), at, FRAME), "G1")!;
    const turned = figure(layout(marks, pinhole(pose({ x: 0, z: -2 }, 20)), pose({ x: 0, z: -2 }, 20), FRAME), "G1")!;
    expect(turned.x).toBeGreaterThan(straight.x);
  });

  it("keeps a guard on its floor point while the camera travels toward it, growing as it nears", () => {
    let last = 0;
    for (const z of [-1, -2, -3, -4]) {
      const at = pose({ x: 0, z });
      const g1 = figure(layout(marks, pinhole(at), at, FRAME), "G1")!;
      const feet = pinhole(at)(POINTS.get("a3")!)!;
      expect(g1.bottom).toBeCloseTo(feet.y);
      expect(g1.bottom - g1.top).toBeGreaterThan(last);
      last = g1.bottom - g1.top;
    }
  });

  it("carries each mark's visibility, and draws the far ones first so near ones sit on top", () => {
    const at = pose({ x: 0, z: 0 });
    const drawn = layout(marks, pinhole(at), at, FRAME);
    expect(figure(drawn, "G1")!.seen).toBe("solid");
    const depths = drawn.map((d) => d.depth);
    expect(depths).toEqual([...depths].sort((a, b) => b - a));
  });

  it("draws a ring at each legal hop in view, the aimed one marked, and none under the camera", () => {
    // Standing on a2, looking down the hall: a3 is ahead; a1 is behind; the player's own node is underfoot.
    const at = pose({ x: 0, z: -5 });
    const rings = layout(marks, pinhole(at), at, FRAME).filter((d) => d.kind === "ring");
    const hops = rings.filter((r) => r.role === "hop");
    expect(hops.map((r) => [r.nodeId, r.aimed])).toEqual([["a3", true]]);
    expect(rings.some((r) => r.nodeId === "a2")).toBe(false);
  });

  it("hangs a camera at its mount, and raises the beacon from its floor point", () => {
    const at = pose({ x: 0, z: -2 });
    const project = pinhole(at);
    const drawn = layout(marks, project, at, FRAME);
    const camera = drawn.find((d) => d.kind === "camera" && d.id === "C1");
    const mount = (marks.find((m) => m.kind === "camera" && m.id === "C1") as Extract<Mark, { kind: "camera" }>).mount;
    expect(camera).toMatchObject({ x: expect.closeTo(project(mount)!.x), y: expect.closeTo(project(mount)!.y) });
    const beacon = drawn.find((d) => d.kind === "beacon")!;
    expect(beacon).toMatchObject({ role: "objective", nodeId: "c2", seen: "outline" });
    if (beacon.kind !== "beacon") throw new Error("not a beacon");
    expect(beacon.bottom).toBeCloseTo(project(POINTS.get("c2")!)!.y);
    expect(beacon.top).toBeLessThan(beacon.bottom);
  });

  it("draws nothing at all with the camera turned away", () => {
    const back = pose({ x: 0, z: 0 }, 180);
    expect(layout(sceneOf({ run: run(), points: POINTS }), pinhole(back), back, FRAME)).toEqual([]);
  });
});
