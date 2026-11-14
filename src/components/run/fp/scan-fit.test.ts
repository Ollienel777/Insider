import { describe, expect, it } from "vitest";
import { fitClouds, fitPairs, fitPlanToScan, headingToScan, toPlan, toScan, type PlanToScan } from "./scan-fit";

// A made-up scan's sweeps on the plan: irregular, as real ones are.
const PLAN = [
  { x: 0, y: 0 },
  { x: 3.1, y: 0.4 },
  { x: 6.8, y: -0.2 },
  { x: 7.2, y: 3.9 },
  { x: 2.2, y: 4.6 },
  { x: -1.5, y: 7.3 },
  { x: 4.4, y: 8.8 },
  { x: 9.5, y: 6.1 },
  { x: 11.2, y: 1.7 },
];

/** A known similarity, applied by hand. */
function carry(p: { x: number; y: number }, { angle, scale, mirror, dx, dy }: { angle: number; scale: number; mirror: boolean; dx: number; dy: number }) {
  const y = mirror ? -p.y : p.y;
  return { x: scale * (Math.cos(angle) * p.x - Math.sin(angle) * y) + dx, y: scale * (Math.sin(angle) * p.x + Math.cos(angle) * y) + dy };
}

const close = (t: PlanToScan, p: { x: number; y: number }, q: { x: number; y: number }, tol = 1e-6) => {
  const r = toScan(t, p);
  expect(Math.hypot(r.x - q.x, r.y - q.y)).toBeLessThan(tol);
};

describe("fitPairs", () => {
  it("recovers a turn, a scale and a shift exactly", () => {
    const known = { angle: 0.7, scale: 1.3, mirror: false, dx: -4, dy: 12 };
    const t = fitPairs(PLAN.map((plan) => ({ plan, scan: carry(plan, known) })));
    expect(t.mirrored).toBe(false);
    expect(t.scale).toBeCloseTo(1.3, 9);
    expect(t.rms).toBeLessThan(1e-9);
    close(t, { x: 20, y: -3 }, carry({ x: 20, y: -3 }, known));
  });

  it("finds a mirror: the scan's frame turns the other way", () => {
    const known = { angle: -2.1, scale: 1, mirror: true, dx: 3, dy: 3 };
    const t = fitPairs(PLAN.map((plan) => ({ plan, scan: carry(plan, known) })));
    expect(t.mirrored).toBe(true);
    expect(t.rms).toBeLessThan(1e-9);
    close(t, { x: -5, y: 2 }, carry({ x: -5, y: 2 }, known));
  });

  it("averages out noise: the error is about the noise's size", () => {
    const known = { angle: 1.1, scale: 1, mirror: false, dx: 0, dy: 0 };
    const noise = [0.05, -0.04, 0.03, -0.06, 0.02, 0.04, -0.03, 0.05, -0.02];
    const t = fitPairs(PLAN.map((plan, i) => {
      const q = carry(plan, known);
      return { plan, scan: { x: q.x + noise[i], y: q.y - noise[(i + 3) % 9] } };
    }));
    expect(t.rms).toBeLessThan(0.08);
    expect(t.scale).toBeCloseTo(1, 1);
  });

  it("goes back: toPlan undoes toScan", () => {
    const known = { angle: 2.5, scale: 0.8, mirror: true, dx: 7, dy: -1 };
    const t = fitPairs(PLAN.map((plan) => ({ plan, scan: carry(plan, known) })));
    const p = toPlan(t, toScan(t, { x: 1.25, y: -9 }));
    expect(p.x).toBeCloseTo(1.25, 9);
    expect(p.y).toBeCloseTo(-9, 9);
  });

  it("turns headings with the plan", () => {
    const t = fitPairs(PLAN.map((plan) => ({ plan, scan: carry(plan, { angle: Math.PI / 2, scale: 2, mirror: false, dx: 0, dy: 0 }) })));
    expect(headingToScan(t, 0)).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe("fitClouds", () => {
  it("finds the fit without ids, from the points alone, with a scan point the plan lacks", () => {
    const known = { angle: Math.PI + 0.12, scale: 1, mirror: false, dx: 40, dy: -8 };
    // The scan lists its points in another order, and one more (a sweep the board dropped).
    const scan = [...PLAN].reverse().map((p) => carry(p, known));
    scan.push(carry({ x: 14, y: 9 }, known));
    const t = fitClouds(PLAN, scan);
    expect(t.rms).toBeLessThan(1e-6);
    close(t, PLAN[3], carry(PLAN[3], known), 1e-6);
  });

  it("finds a mirrored frame from the points alone", () => {
    const known = { angle: 0.3, scale: 1, mirror: true, dx: 2, dy: 5 };
    const t = fitClouds(PLAN, PLAN.map((p) => carry(p, known)));
    expect(t.mirrored).toBe(true);
    expect(t.rms).toBeLessThan(1e-6);
  });
});

describe("fitPlanToScan", () => {
  const scans = (known: Parameters<typeof carry>[1]) =>
    PLAN.map((p, i) => {
      const q = carry(p, known);
      // y-up: the ground plane is x and z; y is the height and plays no part.
      return { id: `sweep${i}`, position: [q.x, 1.5 + i * 0.01, q.y] as const };
    });

  it("pairs by id where the board's nodes are the scan's sweeps", () => {
    const known = { angle: -0.4, scale: 1, mirror: false, dx: 1, dy: 2 };
    const t = fitPlanToScan({ nodes: PLAN.map((p, i) => ({ id: `sweep${i}`, ...p })), scans: scans(known) })!;
    expect(t.pairs).toBe(PLAN.length);
    expect(t.rms).toBeLessThan(1e-9);
  });

  it("pairs by floor spot when that is what the ids share", () => {
    const known = { angle: 0.9, scale: 1, mirror: false, dx: 0, dy: 0 };
    const t = fitPlanToScan({
      nodes: PLAN.map((p, i) => ({ id: `spot${i}`, ...p })),
      scans: scans(known).map((s, i) => ({ ...s, anchor: `spot${i}` })),
    })!;
    expect(t.pairs).toBe(PLAN.length);
    expect(t.rms).toBeLessThan(1e-9);
  });

  it("falls back to the points when no id is shared", () => {
    const known = { angle: 2, scale: 1, mirror: false, dx: -3, dy: 0 };
    const t = fitPlanToScan({ nodes: PLAN.map((p, i) => ({ id: `n${i}`, ...p })), scans: scans(known) })!;
    expect(t.rms).toBeLessThan(1e-6);
  });

  it("is null with too little to fit", () => {
    expect(fitPlanToScan({ nodes: [{ id: "a", x: 0, y: 0 }], scans: [] })).toBeNull();
  });
});
