// What the first-person view stands on and draws with (issues 115 and 118):
// a fixture floor, built from its room rectangles and drawn by our own
// renderer, or a live scan, its mesh drawn by the scan view and walked by its
// floor and walls. The view's loop, the walker and the actors are the same
// over both; a stage is everything that differs.
import {
  AmbientLight,
  DirectionalLight,
  DoubleSide,
  Fog,
  PerspectiveCamera,
  PointLight,
  Ray,
  Scene,
  WebGLRenderer,
} from "three";
import type { RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { eyePose, yawFromHeading, type ScanView } from "@/app/spike/mesh/scan-view";
import { cameraMount } from "../board";
import type { Marks } from "./actors";
import type { Ground, Vec } from "./ground";
import type { Palette } from "./palette";
import { buildFloorGroup, disposeGroup, type RoomTone } from "./scene";
import { fitPlanToScan, toScan, type PlanToScan } from "./scan-fit";
import { createScanGround, scanCameraMarks } from "./scan-ground";
import { FP } from "./tuning";
import type { World } from "./world";

export interface Stage {
  scene: Scene;
  /** The camera `draw` placed, for the labels to project through. */
  camera: PerspectiveCamera;
  ground: Ground;
  /** The height the actors stand at. */
  baseY: number;
  cameras(run: RunState): Marks["cameras"];
  /** Whether the picture around the walker has arrived: until it has, the view draws but the player waits. */
  settled(pos: Vec): boolean;
  /** Draws the frame from the walker's place, the bob's lift, and where the player looks. */
  draw(walker: { pos: Vec; vel: Vec }, lift: number, yaw: number, pitch: number, dt: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/** The fixture floor, drawn by our own renderer on the view's canvas. Null where WebGL refuses. */
export function fixtureStage(
  target: HTMLCanvasElement,
  placed: PlacedLevel,
  world: World,
  ground: Ground,
  palette: Palette,
  onLost: () => void,
): Stage | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas: target, antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  const lost = (event: Event) => {
    event.preventDefault();
    onLost();
  };
  target.addEventListener("webglcontextlost", lost);

  const scene = new Scene();
  scene.background = palette.n950;
  scene.fog = new Fog(palette.n950, 4, 36);
  const camera = new PerspectiveCamera(72, 1, 0.05, 80);
  // An even night light, a slanted one so walls that meet at a corner differ in shade, and a
  // little carried by the player so what is near reads before what is far.
  scene.add(new AmbientLight(palette.n100, 2));
  const slant = new DirectionalLight(palette.n100, 1.5);
  slant.position.set(-0.55, 1, -0.3);
  scene.add(slant);
  // A slow falloff: a wall the player is pressed against must not burn out.
  const torch = new PointLight(palette.n100, 0.9, 14, 0.6);
  camera.add(torch);
  scene.add(camera);

  const tone = (roomId: string): RoomTone => {
    const zone = placed.zones.find((z) => z.roomIds.includes(roomId));
    return zone?.role === "crowded" ? "lit" : zone?.role === "quiet" ? "dark" : "plain";
  };
  const floorGroup = buildFloorGroup(world, palette, tone);
  scene.add(floorGroup);
  const metres = (p: { x: number; y: number }) => ({ x: p.x * ground.unitM, y: p.y * ground.unitM });

  return {
    scene,
    camera,
    ground,
    baseY: 0,
    settled: () => true,
    cameras: (run) =>
      run.board.cameras.map((c) => {
        const cover = c.parts.flat();
        const seen = cover.map((id) => run.board.nodes.get(id)!);
        const middle = { x: seen.reduce((s, n) => s + n.x, 0) / seen.length, y: seen.reduce((s, n) => s + n.y, 0) / seen.length };
        return { id: c.id, mount: metres(cameraMount(placed.level.floor, cover)), looksAt: metres(middle) };
      }),
    draw({ pos }, lift, yaw, pitch) {
      camera.position.set(pos.x, FP.eyeM + lift, pos.y);
      const flat = Math.cos(pitch);
      camera.lookAt(pos.x + Math.cos(yaw) * flat, FP.eyeM + lift + Math.sin(pitch), pos.y + Math.sin(yaw) * flat);
      renderer.render(scene, camera);
    },
    resize(w, h) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    dispose() {
      target.removeEventListener("webglcontextlost", lost);
      disposeGroup(floorGroup);
      renderer.dispose();
    },
  };
}

/** How high over the feet the scan's mesh is asked what is in view: over desks and most partitions. */
const SIGHT_Y_M = 1.5;
/** A hit this close to the far end is the far end's own floor or wall, not something between. */
const SIGHT_SLACK_M = 0.2;

/** The doors a run on `placed` can shut: every lockable one, and any it starts with shut. */
export function shuttable(placed: PlacedLevel, run: RunState): Set<string> {
  const ids = placed.level.floor.edges.flatMap((e) => (e.door?.lockable ? [e.door.id] : []));
  return new Set([...ids, ...run.locked]);
}

/**
 * The live scan, drawn by its scan view, the board fitted onto it (scan-fit.ts).
 * Null when the board can't be fitted (too few of its nodes in the scan) or
 * the mesh isn't in.
 */
export function scanStage(view: ScanView, placed: PlacedLevel, run: RunState): (Stage & { fit: PlanToScan; rms: number }) | null {
  const world = view.world;
  const tree = view.meshTree;
  if (!world || !tree) return null;
  const floor = placed.level.floor;
  const points = view.scanPoints();
  const fit = fitPlanToScan({ nodes: floor.nodes, scans: points });
  if (!fit) return null;

  // Where the feet start: under the scan position the player's node is (or is nearest).
  const start = floor.nodes.find((n) => n.id === run.playerNode);
  if (!start) return null;
  const at = toScan(fit, start);
  const own = points.find((p) => p.id === start.id || p.anchor === start.id);
  const nearest = own ?? points.reduce((best, p) => (Math.hypot(p.position[0] - at.x, p.position[2] - at.y) < Math.hypot(best.position[0] - at.x, best.position[2] - at.y) ? p : best));
  const fromY = nearest.position[1];
  const feetY = view.floorAt(at.x, fromY, at.y, 3) ?? fromY - 1.4;

  const ray = new Ray();
  const see = (p: Vec, q: Vec, y: number) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < 1e-6) return true;
    ray.origin.set(p.x, y + SIGHT_Y_M, p.y);
    ray.direction.set((q.x - p.x) / d, 0, (q.y - p.y) / d);
    const hit = tree.bvh.raycastFirst(ray, DoubleSide, 0, d);
    return !hit || hit.distance >= d - SIGHT_SLACK_M;
  };
  const ground = createScanGround({ floor, fit, world, see, doorIds: shuttable(placed, run), feetY });

  // The actors on the floor where the player starts, a hair above it so their discs clear the mesh's floor.
  const baseY = feetY + 0.03;
  // The pieces are lit; the scan's own picture is not, so this changes only them.
  const scene = view.scene;
  const ambient = new AmbientLight(0xffffff, 1.6);
  const slant = new DirectionalLight(0xffffff, 1.2);
  slant.position.set(-0.55, 1, -0.3);
  scene.add(ambient, slant);

  return {
    scene,
    camera: view.camera,
    ground,
    baseY,
    fit,
    rms: fit.rms,
    settled: (pos) => view.settled([pos.x, ground.feetY + FP.eyeM, pos.y]),
    cameras: (state) => scanCameraMarks(floor, fit, state.board.cameras, (cover) => cameraMount(floor, cover)),
    draw({ pos, vel }, lift, yaw, pitch, dt) {
      view.setPose(eyePose([pos.x, ground.feetY, pos.y], yawFromHeading(yaw), pitch, FP.eyeM + lift), [vel.x, vel.y]);
      view.render(dt);
    },
    resize(w, h) {
      view.resize(w, h);
    },
    dispose() {
      scene.remove(ambient, slant);
    },
  };
}
