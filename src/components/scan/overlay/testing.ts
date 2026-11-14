// Test doubles for the scan overlay's tests: a small made-up floor with a wall
// in it, its floor points, and a pinhole camera standing in for the Inside
// view's `project`. Nothing here comes from a scan.
import type { FramePoint, InsidePose, ScanPoint } from "@/adapters/matterport";
import type { FloorGraph } from "@/domain";
import { createRun, type Level, type RunState } from "@/engine";

/**
 * Three rooms along a line, the way a scan's board is laid out: a node's `x`
 * and `y` are the scan's `x` and `z`, in metres. The hall runs away from the
 * origin down -z, the office sits behind the hall's east wall, the store past
 * its far end.
 *
 *   hall   a1 (0,-2)  a2 (0,-5)  a3 (0,-8)
 *   office b1 (3,-5)  b2 (6,-5)            through door d1 at a2
 *   store  c1 (0,-11) c2 (0,-14)           through door d2 at a3
 */
export const FLOOR: FloorGraph = {
  nodes: [
    { id: "a1", x: 0, y: -2, roomId: "hall", tags: ["entry"] },
    { id: "a2", x: 0, y: -5, roomId: "hall", tags: [] },
    { id: "a3", x: 0, y: -8, roomId: "hall", tags: [] },
    { id: "b1", x: 3, y: -5, roomId: "office", tags: [] },
    { id: "b2", x: 6, y: -5, roomId: "office", tags: [] },
    { id: "c1", x: 0, y: -11, roomId: "store", tags: [] },
    { id: "c2", x: 0, y: -14, roomId: "store", tags: [] },
  ],
  edges: [
    { a: "a1", b: "a2" },
    { a: "a2", b: "a3" },
    { a: "a2", b: "b1", door: { id: "d1", lockable: true } },
    { a: "b1", b: "b2" },
    { a: "a3", b: "c1", door: { id: "d2", lockable: true } },
    { a: "c1", b: "c2" },
  ],
  rooms: [
    { id: "hall", label: "Corridor", rect: { x: -1, y: -9, w: 2, h: 8 } },
    { id: "office", label: "Office", rect: { x: 2, y: -6, w: 5, h: 2 } },
    { id: "store", label: "Records Room", rect: { x: -1, y: -15, w: 2, h: 5 } },
  ],
  sightlines: {
    a1: ["a2", "a3"],
    a2: ["a1", "a3"],
    a3: ["a1", "a2"],
    b1: ["b2"],
    b2: ["b1"],
    c1: ["c2"],
    c2: ["c1"],
  },
  source: "matterport",
};

/**
 * A level on `FLOOR`. G1 stands in the hall (in sight of a1), G2 behind the
 * wall two hops from a1 (in hearing), G3 three hops away (neither). K1 cleans
 * the store. C1 watches the hall, C2 the office.
 */
export function level(overrides: Partial<Level> = {}): Level {
  return {
    buildingId: "test",
    missionId: "test",
    seed: 1,
    floor: FLOOR,
    start: "a1",
    objective: "c2",
    exits: ["a1"],
    lockedDoors: ["d2"],
    pickTurns: 2,
    patrolTempo: 1,
    guards: [
      { id: "G1", patrol: ["a3"] },
      { id: "G2", patrol: ["b1"] },
      { id: "G3", patrol: ["b2"] },
    ],
    cleaners: [{ id: "K1", patrol: ["c1"] }],
    cameras: [
      { id: "C1", kind: "fixed-ip", cover: ["a2", "a3"] },
      { id: "C2", kind: "fixed-ip", cover: ["b1", "b2"] },
    ],
    ...overrides,
  };
}

export function run(overrides: Partial<Level> = {}): RunState {
  return createRun(level(overrides));
}

/** Each node's floor point: the scan's floor sits a little under 0, as a real one does. */
export const FLOOR_Y = -0.02;
export const POINTS: ReadonlyMap<string, ScanPoint> = new Map(
  FLOOR.nodes.map((n) => [n.id, { x: n.x, y: FLOOR_Y, z: n.y }]),
);

export const FRAME = { width: 800, height: 450 } as const;
/** The pinhole's focal length in pixels: a 90° field of view across 800 px. */
const FOCAL = 400;

/** A pose standing `eye` metres over `at`, looking at yaw `yaw` and pitch `pitch` (degrees), as the SDK reports it. */
export function pose(at: { x: number; z: number }, yaw = 0, pitch = 0, eye = 1.5): InsidePose {
  return { position: { x: at.x, y: FLOOR_Y + eye, z: at.z }, rotation: { x: pitch, y: yaw } };
}

/**
 * A stand-in for `InsideView.project`: a pinhole camera at `p`. At yaw θ it
 * looks along (-sin θ, 0, -cos θ), as the SDK's pose does; positive pitch
 * looks up. Null for a point less than 5 cm in front of it.
 */
export function pinhole(p: InsidePose, frame: { width: number; height: number } = FRAME) {
  const yaw = (p.rotation.y * Math.PI) / 180;
  const pitch = (p.rotation.x * Math.PI) / 180;
  const flatForward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const forward = {
    x: flatForward.x * Math.cos(pitch),
    y: Math.sin(pitch),
    z: flatForward.z * Math.cos(pitch),
  };
  const up = {
    x: -flatForward.x * Math.sin(pitch),
    y: Math.cos(pitch),
    z: -flatForward.z * Math.sin(pitch),
  };
  return (point: ScanPoint): FramePoint | null => {
    const d = { x: point.x - p.position.x, y: point.y - p.position.y, z: point.z - p.position.z };
    const depth = d.x * forward.x + d.y * forward.y + d.z * forward.z;
    if (depth < 0.05) return null;
    const across = d.x * right.x + d.y * right.y + d.z * right.z;
    const upward = d.x * up.x + d.y * up.y + d.z * up.z;
    return { x: frame.width / 2 + (FOCAL * across) / depth, y: frame.height / 2 - (FOCAL * upward) / depth };
  };
}
