// The debug recorder (issue 118, `&debug=1` only): walks the player along a
// fixed route at a constant speed, one fixed step per frame, and for every
// frame keeps what the eye would judge the picture by: how much each
// panorama paints the point at the centre of the screen, how much the
// picture changed since the frame before, and how bright it is. Frames are
// rendered to a small target in GPU memory and read back; nothing is kept
// but the numbers (lib/scan-mesh/walk-stats.ts sums them up).
import {
  DoubleSide,
  Ray,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import { blendWeights, type BlendMode } from "@/lib/scan-mesh/blend";
import type { Vec3 } from "@/lib/scan-mesh/coords";
import type { WalkSample } from "@/lib/scan-mesh/walk-stats";
import type { MeshWorld } from "./collider";
import type { PanoUse } from "./panos";

export interface RecordOptions {
  /** Eye positions to walk through, y-up, in order. */
  path: Vec3[];
  /** Metres per second. */
  speed?: number;
}

const WIDTH = 160;
const HEIGHT = 90;
/** One frame's step, seconds: fixed, so a run is the same whatever the machine. */
export const RECORD_STEP = 1 / 60;

export class WalkRecorder {
  readonly samples: WalkSample[] = [];
  /** Metres walked along the route. */
  walked = 0;
  readonly speed: number;
  /** Where the camera looks the whole way: from the first point toward the last, level. */
  readonly yaw: number;
  private readonly target = new WebGLRenderTarget(WIDTH, HEIGHT);
  private readonly pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  private previous: Uint8Array | null = null;
  private readonly lengths: number[];
  readonly total: number;
  private readonly ray = new Ray();

  constructor(
    private readonly options: RecordOptions,
    private readonly done: (samples: WalkSample[]) => void,
  ) {
    this.speed = options.speed ?? 1.5;
    const { path } = options;
    this.lengths = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1], p[2] - path[i][2]));
    this.total = this.lengths.reduce((a, b) => a + b, 0);
    const first = path[0];
    const last = path[path.length - 1];
    this.yaw = Math.atan2(-(last[0] - first[0]), -(last[2] - first[2]));
  }

  /** Where the eye is, `walked` metres along the route. */
  eye(): Vec3 {
    const { path } = this.options;
    let left = Math.min(this.walked, this.total);
    for (let i = 0; i < this.lengths.length; i++) {
      const length = this.lengths[i];
      if (left <= length || i === this.lengths.length - 1) {
        const t = length > 0 ? Math.min(1, left / length) : 0;
        const a = path[i];
        const b = path[i + 1];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }
      left -= length;
    }
    return path[0];
  }

  /** The horizontal velocity along the route here, m/s, for the store's look-ahead. */
  velocity(): [number, number] {
    const a = this.eye();
    this.walked += 0.01;
    const b = this.eye();
    this.walked -= 0.01;
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    return [((b[0] - a[0]) / length) * this.speed, ((b[2] - a[2]) / length) * this.speed];
  }

  /** Keeps this frame's numbers and steps on; calls `done` once the route is walked. */
  capture(
    renderer: WebGLRenderer,
    draw: (target: WebGLRenderTarget) => void,
    camera: PerspectiveCamera,
    world: MeshWorld,
    used: readonly PanoUse[],
    mode: BlendMode,
  ): void {
    draw(this.target);
    renderer.readRenderTargetPixels(this.target, 0, 0, WIDTH, HEIGHT, this.pixels);

    let light = 0;
    let change = 0;
    const px = this.pixels;
    const prev = this.previous;
    for (let i = 0; i < px.length; i += 4) {
      light += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      if (prev) change += Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]);
    }
    const count = px.length / 4;
    this.previous = Uint8Array.from(px);

    this.samples.push({
      walked: this.walked,
      weights: this.centreWeights(camera, world, used, mode),
      change: prev ? change / (count * 3) : 0,
      brightness: light / count,
    });

    this.walked += this.speed * RECORD_STEP;
    if (this.walked > this.total) {
      this.target.dispose();
      this.done(this.samples);
    }
  }

  /** What each panorama in use contributes at the centre of the screen, by its index. */
  private centreWeights(
    camera: PerspectiveCamera,
    world: MeshWorld,
    used: readonly PanoUse[],
    mode: BlendMode,
  ): Record<number, number> {
    const origin = camera.position;
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    this.ray.set(origin, forward);
    const hit = world.bvh.raycastFirst(this.ray, DoubleSide);
    if (!hit || !hit.face) return {};
    const point: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
    const normal: Vec3 = [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z];
    const sources = used.map((u) => {
      // Seen when nothing stands between the panorama and the point.
      const to = new Vector3(point[0] - u.origin[0], point[1] - u.origin[1], point[2] - u.origin[2]);
      const reach = to.length();
      this.ray.set(new Vector3(...u.origin), to.normalize());
      const block = world.bvh.raycastFirst(this.ray, DoubleSide);
      const seen = !block || block.distance >= reach - 0.05 ? 1 : 0;
      return { origin: u.origin, share: u.share, seen };
    });
    const weights = blendWeights(mode, [origin.x, origin.y, origin.z], point, normal, sources);
    const out: Record<number, number> = {};
    used.forEach((u, i) => {
      out[u.index] = weights[i];
    });
    return out;
  }
}
