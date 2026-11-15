// The scan's panoramas, held for the whole visit (issue 118), so that no
// picture has to arrive while the player walks.
//
// Three layers, all in this tab's memory and nowhere else (no HTTP cache, no
// Cache API, no IndexedDB; fetches are `cache: "no-store"`):
//   - the bytes: every panorama's face files are fetched once, as they came
//     off the wire, nearest the player first. Once they are held no later
//     request is needed, so the signed links' few minutes stop mattering.
//   - the low layer: a small cube of every panorama, and a depth cube rendered
//     from its position (how far it could see in every direction), all on the
//     GPU for good. Any point of the building has a picture at once.
//   - the sharp layer: full-size cubes for the few panoramas the player is at
//     or heading for (lib/scan-mesh/pano-plan.ts), decoded from the held
//     bytes. A slot shows the small cube and fades to the sharp one.
//
// The GPU gets its work in slices: a full-size face is decoded to plain pixels
// in a worker (decode-worker.ts) and goes up a strip a frame, and a frame
// stops handing work over once it has spent its few milliseconds. The
// sharp cubes themselves are made once, at the start (making one is slow: the
// GPU clears it), and passed from a dropped panorama to the next.
import {
  BackSide,
  BoxGeometry,
  CubeTexture,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  NoColorSpace,
  PerspectiveCamera,
  RedFormat,
  RGBAFormat,
  Scene,
  Vector3,
  WebGLCubeRenderTarget,
  type BufferGeometry,
  type IUniform,
  type ShaderMaterial,
  type WebGLRenderer,
} from "three";
import { conjugate, quatToMat3, type Vec3 } from "@/lib/scan-mesh/coords";
import { isAllowedAssetUrl, type ScanPano } from "@/lib/scan-mesh/manifest";
import { nearestFirst, planSharp, sharpOrder } from "@/lib/scan-mesh/pano-plan";
import { slotFades, type BlendMode } from "@/lib/scan-mesh/blend";
import { panoCosts, priorities, rankPanos, standingOn } from "@/lib/scan-mesh/photo";
import type { Rgb } from "@/lib/scan-mesh/exposure";
import type { ExposureSource } from "./exposure-match";
import { alignToCube, CUBE_LOOKUP_FLIP, panoDistance, panoWeights } from "@/lib/scan-mesh/skybox";
import type { DecodeReply, DecodeRequest } from "./decode-worker";
import { createDistanceMaterial, SLOTS } from "./projection";

/** Panoramas blended for one standpoint under the nearest rule. */
const KEEP = 3;
/** Panoramas whose small faces, and whose full-size faces, are being fetched at once. */
const LOW_FETCHES = 6;
const SHARP_FETCHES = 2;
/** How quickly a panorama's share follows its target, per second. */
const SHARE_RATE = 7;
/** Under the photo rule, the panoramas nearest the eye that are checked for a wall between them and it. */
const SIGHT_CHECKS = 8;
/** How quickly a slot fades between its small cube and its sharp one, per second: slow enough not to read as a swap. */
const SHARP_RATE = 0.9;
/** How quickly the exposure gains ease in once solved, per second. */
const GAIN_RATE = 1.5;
/** How far ahead of the player the sharp cubes look, seconds. */
const HORIZON = 1.2;
/** The small cube's face when it has to be made from the full-size bytes, pixels. */
const LOW_SIZE = 512;
/** A depth cube's face, pixels: a third of a degree each, plenty to tell in front from behind. */
const DEPTH_SIZE = 256;
/** Strips a full-size face goes to the GPU in. */
const STRIPS = 8;
/** A frame hands the GPU no new work once it has spent this long on it, ms. */
const BUDGET = 4;
/** Depth cubes rendered in one frame at most: each is the whole mesh six times, which the clock above does not see (the GPU does it later). */
const DEPTHS = 2;
/** After a refused fetch, none starts for this long (new links are on their way), ms. */
const BACK_OFF = 1500;
const TRIES = 3;

const BITMAP: ImageBitmapOptions = { premultiplyAlpha: "none", colorSpaceConversion: "none" };

type Bytes = "idle" | "loading" | "held" | "failed";
type Sharp = "none" | "working" | "ready" | "leaving";

interface Entry {
  pano: ScanPano;
  index: number;
  origin: Vector3;
  toPano: Matrix3;
  /** The small faces' bytes (only when the scan has a preview) and the full-size faces'. */
  lowBytes: Blob[] | null;
  lowState: Bytes;
  sharpBytes: Blob[] | null;
  sharpState: Bytes;
  tries: number;
  /** The small cube: made and filled here, not by three.js. */
  low: WebGLTexture | null;
  lowCube: CubeTexture | null;
  lowStarted: boolean;
  depth: WebGLCubeRenderTarget | null;
  sharp: WebGLTexture | null;
  sharpCube: CubeTexture | null;
  sharpStage: Sharp;
  /** 0 shows the small cube, 1 the sharp one. */
  sharpMix: number;
  share: number;
}

/** A small cube on its way to the GPU: one image per cube slot. */
interface LowJob {
  entry: Entry;
  images: ImageBitmap[];
  raw: WebGLTexture | null;
  next: number;
}

/**
 * A sharp cube on its way to the GPU. Per cube slot, either its pixels (from
 * the worker) or, where there is no worker, its strips as images, top down.
 */
interface SharpJob {
  entry: Entry;
  size: number;
  pixels: Uint8Array[] | null;
  strips: ImageBitmap[][];
  raw: WebGLTexture | null;
  slot: number;
  strip: number;
}

export interface PanoUse {
  /** The panorama's place in the scan's list. */
  index: number;
  share: number;
  /** Where it was taken, y-up. */
  origin: Vec3;
}

export interface PanoCounts {
  /** Panoramas that have faces at all. */
  total: number;
  /** Panoramas whose every byte is held. */
  held: number;
  /** Bytes held, all panoramas. */
  bytes: number;
  low: number;
  sharp: number;
  sharpLoading: number;
  failed: number;
  /** A rough count of GPU memory in use by the cubes, bytes. */
  gpu: number;
}

/** The camera for each GPU cube face, +x -x +y -y +z -z: where it looks and its up. */
const CUBE_CAMERAS: readonly [Vector3, Vector3][] = [
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0)],
  [new Vector3(0, 1, 0), new Vector3(0, 0, 1)],
  [new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0)],
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
];

export function blankCube(): CubeTexture {
  const pixel = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas;
  };
  const cube = new CubeTexture(Array.from({ length: 6 }, pixel));
  cube.colorSpace = NoColorSpace;
  cube.needsUpdate = true;
  return cube;
}

export class PanoStore {
  private entries: Entry[] = [];
  /** The entries that have faces, and their positions, in step. */
  private shown: Entry[] = [];
  private positions: Vec3[] = [];
  private byAnchor = new Map<string, number[]>();
  private disposed = false;
  private readonly align = alignToCube();
  private lowFetches = 0;
  private sharpFetches = 0;
  private blockedUntil = 0;
  private lowJobs: LowJob[] = [];
  private depthQueue: Entry[] = [];
  private depthsLeft = 0;
  private sharpJob: SharpJob | null = null;
  private sharpBusy = false;
  /** Sharp cubes made and not in use, all `sharpSize` across; `warming` more are still to be made. */
  private pool: WebGLTexture[] = [];
  private warming: number;
  private readonly sizes = new Map<WebGLTexture, number>();
  private lowTexels = 0;
  private decodingSharp: Promise<unknown> = Promise.resolve();
  /** The worker that decodes full-size faces to pixels; null where it can't be started. */
  private worker: Worker | null = null;
  private asked = 0;
  private readonly waiting = new Map<number, (reply: DecodeReply) => void>();
  private decodingLow: Promise<unknown> = Promise.resolve();
  private readonly depthScene = new Scene();
  private readonly depthMesh: Mesh;
  /** Bytes per depth cube texel, for the memory count. */
  private depthTexel = 8;
  private readonly depthMaterial = createDistanceMaterial();
  private readonly depthCamera = new PerspectiveCamera(90, 1, 0.05, 4000);
  private readonly far: Mesh;
  private readonly abort = new AbortController();
  /** Called when a face link is refused: the engine fetches new links. */
  onStale: (() => void) | null = null;
  /** Set by `update` when bytes are still wanted and the links have run out. */
  needsLinks = false;
  /** How the slots are weighted (lib/scan-mesh/blend.ts, and photo.ts for "photo"). */
  mode: BlendMode = "photo";
  /** Whether something stands between `eye` and a panorama at `origin`: the photo rule ranks such a panorama lower. */
  blocked: ((eye: Vec3, origin: Vec3) => boolean) | null = null;
  /** The photo rule's panoramas in use last frame, the lead first, as places in the list of those ready. */
  private ranked: Entry[] = [];
  /** While true, no full-size faces are fetched: the link is left to something smaller and more urgent. */
  holdSharp = false;
  /** Whether the exposure gains are applied (to compare with and without). */
  useGains = true;
  /** Each panorama's colour gain as shown, by index in the scan's list, easing toward `targetGains`; missing means 1. */
  private gains = new Map<number, [number, number, number]>();
  private targetGains = new Map<number, Rgb>();

  /**
   * `capacity` sharp cubes, `sharpSize` pixels across, are made at once and
   * kept: that is the sharp layer's whole share of GPU memory.
   */
  constructor(
    private readonly renderer: WebGLRenderer,
    geometry: BufferGeometry,
    private readonly capacity: number,
    private readonly sharpSize: number,
  ) {
    this.warming = capacity;
    this.depthMesh = new Mesh(geometry, this.depthMaterial);
    this.depthScene.add(this.depthMesh);
    // What a panorama sees through a hole in the mesh is far away, not nothing.
    const farMaterial = createDistanceMaterial();
    farMaterial.side = BackSide;
    this.far = new Mesh(new BoxGeometry(2000, 2000, 2000), farMaterial);
    this.depthScene.add(this.far);
    try {
      this.worker = new Worker(new URL("./decode-worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<DecodeReply>) => {
        const done = this.waiting.get(event.data.id);
        this.waiting.delete(event.data.id);
        done?.(event.data);
      };
      this.worker.onerror = () => this.dropWorker();
    } catch {
      this.worker = null;
    }
  }

  /** The worker has failed: answer everything it owed, and decode on the main thread from here on. */
  private dropWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, done] of this.waiting) done({ id, failed: true });
    this.waiting.clear();
  }

  /** Cube slot `slot`'s face as plain pixels, turned the way the slot wants it. */
  private pixelsOf(blob: Blob, slot: number): Promise<{ size: number; pixels: Uint8Array }> {
    return new Promise((resolve, reject) => {
      const worker = this.worker;
      if (!worker) return reject(new Error("no worker"));
      const id = ++this.asked;
      this.waiting.set(id, (reply) => {
        if ("failed" in reply) reject(new Error("decode failed"));
        else resolve({ size: reply.size, pixels: new Uint8Array(reply.pixels) });
      });
      const { identity, transform } = this.align.layout[slot];
      const request: DecodeRequest = { id, blob, transform: identity ? null : transform };
      worker.postMessage(request);
    });
  }

  setPanos(panos: readonly ScanPano[]): void {
    if (this.entries.length > 0) {
      // Fresh links for the same scan: keep everything held, swap the links.
      const byId = new Map(panos.map((p) => [p.id, p]));
      for (const entry of this.entries) {
        const fresh = byId.get(entry.pano.id);
        if (!fresh) continue;
        entry.pano = { ...entry.pano, faces: fresh.faces, preview: fresh.preview, resolution: fresh.resolution };
      }
      return;
    }
    this.entries = panos.map((pano, index) => {
      // World to the panorama's own frame, then the turn that lines the scan's
      // faces up with the GPU's, then the lookup's flip.
      const own = quatToMat3(conjugate(pano.rotation));
      const { rotation } = this.align;
      const elements: number[] = [];
      for (let col = 0; col < 3; col++) {
        const [x, y, z] = [own[col * 3], own[col * 3 + 1], own[col * 3 + 2]];
        for (let row = 0; row < 3; row++) {
          const r = rotation[row];
          elements.push((r[0] * x + r[1] * y + r[2] * z) * CUBE_LOOKUP_FLIP[row]);
        }
      }
      return {
        pano,
        index,
        origin: new Vector3(...pano.position),
        toPano: new Matrix3().fromArray(elements),
        lowBytes: null,
        lowState: "idle" as Bytes,
        sharpBytes: null,
        sharpState: "idle" as Bytes,
        tries: 0,
        low: null,
        lowCube: null,
        lowStarted: false,
        depth: null,
        sharp: null,
        sharpCube: null,
        sharpStage: "none" as Sharp,
        sharpMix: 0,
        share: 0,
      };
    });
    this.shown = this.entries.filter((e) => e.pano.faces !== null);
    this.positions = this.shown.map((e) => e.pano.position);
    this.shown.forEach((e, at) => {
      if (e.pano.anchor === null) return;
      const list = this.byAnchor.get(e.pano.anchor) ?? [];
      list.push(at);
      this.byAnchor.set(e.pano.anchor, list);
    });
  }

  get count(): number {
    return this.entries.length;
  }

  counts(): PanoCounts {
    const out: PanoCounts = { total: this.shown.length, held: 0, bytes: 0, low: 0, sharp: 0, sharpLoading: 0, failed: 0, gpu: 0 };
    for (const e of this.shown) {
      const lowDone = e.pano.preview === null || e.lowState === "held";
      if (lowDone && e.sharpState === "held") out.held++;
      if (e.sharpState === "failed" || e.lowState === "failed") out.failed++;
      for (const blob of e.lowBytes ?? []) out.bytes += blob.size;
      for (const blob of e.sharpBytes ?? []) out.bytes += blob.size;
      if (e.lowCube && e.depth) out.low++;
      if (e.sharpStage === "ready" || e.sharpStage === "leaving") out.sharp++;
      if (e.sharpStage === "working") out.sharpLoading++;
      // Six faces of half floats (one channel, or four where the GPU can't render to one), and their depth buffer.
      if (e.depth) out.gpu += DEPTH_SIZE * DEPTH_SIZE * 6 * (this.depthTexel + 4);
    }
    out.gpu += this.lowTexels * 4;
    // Every sharp cube made so far, in use or pooled, with its smaller copies.
    for (const size of this.sizes.values()) out.gpu += size * size * 6 * 4 * (4 / 3);
    return out;
  }

  /** Every panorama whose faces are held, for matching exposures: tiny copies are made from the smallest bytes there are. */
  exposureSources(): ExposureSource[] {
    return this.shown.flatMap((e) => {
      const faces = e.lowBytes ?? e.sharpBytes;
      return faces ? [{ index: e.index, origin: e.pano.position, rotation: e.pano.rotation, faces }] : [];
    });
  }

  /** Each panorama's colour gain, by index: eased in over a second or so. */
  setGains(gains: ReadonlyMap<number, Rgb>): void {
    this.targetGains = new Map(gains);
  }

  /**
   * A finer mesh to see the panoramas' occlusion against: every depth cube is
   * rendered again from it, a few a frame, the old one in use until then.
   */
  setGeometry(geometry: BufferGeometry): void {
    this.depthMesh.geometry = geometry;
    this.renderDepthsAgain();
  }

  /** More surface for the panoramas' occlusion to be seen against (a closed hole hides what is behind it, like the wall it stands for). */
  addOccluder(geometry: BufferGeometry): void {
    this.depthScene.add(new Mesh(geometry, this.depthMaterial));
    this.renderDepthsAgain();
  }

  private renderDepthsAgain(): void {
    const queued = new Set(this.depthQueue);
    for (const e of this.shown) if (e.depth && !queued.has(e)) this.depthQueue.push(e);
  }

  /** Whether every depth cube has been rendered from the latest geometry. */
  get depthsCurrent(): boolean {
    return this.depthQueue.length === 0 && this.lowJobs.length === 0;
  }

  /** The panorama nearest `eye`, by index, or -1. */
  nearest(eye: Vec3): number {
    let best = -1;
    let least = Infinity;
    for (const e of this.entries) {
      const d = panoDistance(eye, e.pano.position);
      if (d < least) {
        least = d;
        best = e.index;
      }
    }
    return best;
  }

  /**
   * Whether the player can be let loose at `eye`: the sharp cubes are made
   * (the slow step is behind us) and the few panoramas nearest have their
   * small cubes, so there is a picture to walk into. True for a scan with no
   * panoramas, and once nothing more can load.
   */
  settled(eye: Vec3): boolean {
    if (this.shown.length === 0) return true;
    if (this.warming > 0) return false;
    const near = nearestFirst(this.positions, eye).slice(0, KEEP);
    return near.every((at) => {
      const e = this.shown[at];
      return (e.lowCube !== null && e.depth !== null) || e.sharpState === "failed" || e.lowState === "failed";
    });
  }

  /**
   * One frame: start what should be fetching, hand the GPU a slice of work,
   * choose the sharp cubes, move the shares toward their targets, and write
   * the four strongest panoramas into `materials`. `linksUsable` is false once
   * the links have run out; `needsLinks` then says whether anything is waiting
   * on new ones. Returns what is in use, strongest first.
   */
  update(
    eye: Vec3,
    velocity: readonly [number, number],
    dt: number,
    materials: readonly { uniforms: Record<string, IUniform> }[],
    blank: CubeTexture,
    linksUsable: boolean,
  ): PanoUse[] {
    const shown = this.shown;
    if (shown.length === 0) return [];
    const near = nearestFirst(this.positions, eye);
    this.fetchMore(near, linksUsable);
    this.pump();
    this.chooseSharp(near, eye, velocity);

    const ready = near.map((at) => shown[at]).filter((e) => e.lowCube !== null && e.depth !== null);
    const distances = ready.map((e) => panoDistance(eye, e.pano.position));
    let targets: number[];
    if (this.mode === "photo") {
      // One panorama leads, kept until another is clearly nearer; one behind a wall counts as farther.
      const blocked = this.blocked;
      const costs = panoCosts(
        eye,
        ready.map((e) => e.pano.position),
        (i) => i >= SIGHT_CHECKS || (blocked !== null && distances[i] > 0.3 && blocked(eye, ready[i].pano.position)),
      );
      const at = new Map(ready.map((e, i) => [e, i]));
      const before = this.ranked.flatMap((e) => (at.has(e) ? [at.get(e) as number] : []));
      const now = rankPanos(costs, before, SLOTS);
      this.ranked = now.map((i) => ready[i]);
      targets = priorities(ready.length, now);
    } else targets = this.mode === "view" ? slotFades(distances, SLOTS) : panoWeights(distances, KEEP);
    const target = new Map<Entry, number>();
    ready.forEach((e, i) => target.set(e, targets[i]));
    const blend = 1 - Math.exp(-SHARE_RATE * dt);
    const fade = SHARP_RATE * dt;
    const ease = 1 - Math.exp(-GAIN_RATE * dt);
    for (const [index, target] of this.targetGains) {
      const shown = this.gains.get(index) ?? [1, 1, 1];
      for (let c = 0; c < 3; c++) shown[c] += ((this.useGains ? target[c] : 1) - shown[c]) * ease;
      this.gains.set(index, shown);
    }
    for (const e of shown) {
      const goal = target.get(e) ?? 0;
      e.share += (goal - e.share) * blend;
      if (e.share < 1e-4 && goal === 0) e.share = 0;
      if (e.sharpStage === "ready") e.sharpMix = Math.min(1, e.sharpMix + fade);
      else if (e.sharpStage === "leaving") {
        e.sharpMix = Math.max(0, e.sharpMix - fade);
        if (e.sharpMix === 0) this.releaseSharp(e);
      }
    }

    const used = ready
      .filter((e) => e.share > 0)
      .sort((a, b) => b.share - a.share)
      .slice(0, SLOTS);
    for (const material of materials) {
      const u = material.uniforms;
      for (let slot = 0; slot < SLOTS; slot++) {
        const e = used[slot];
        u[`uPano${slot}`].value = e?.sharpCube ?? blank;
        u[`uLow${slot}`].value = e?.lowCube ?? blank;
        u[`uDepth${slot}`].value = e?.depth?.texture ?? blank;
        (u.uPanoShare.value as number[])[slot] = e ? e.share : 0;
        (u.uPanoSharp.value as number[])[slot] = e?.sharpCube ? e.sharpMix : 0;
        if (u.uPanoOn) (u.uPanoOn.value as number[])[slot] = e ? standingOn(panoDistance(eye, e.pano.position)) : 0;
        const gain = e ? this.gains.get(e.index) : undefined;
        (u.uPanoGain.value as Vector3[])[slot].set(gain?.[0] ?? 1, gain?.[1] ?? 1, gain?.[2] ?? 1);
        u.uMode.value = this.mode === "nearest" ? 1 : 0;
        if (e) {
          (u.uPanoPos.value as Vector3[])[slot].copy(e.origin);
          (u.uPanoInv.value as Matrix3[])[slot].copy(e.toPano);
        }
      }
    }
    return used.map((e) => ({ index: e.index, share: e.share, origin: e.pano.position }));
  }

  // ---- the bytes ----

  /** Start fetching the nearest panoramas that have no bytes yet, a few at a time. */
  private fetchMore(near: readonly number[], linksUsable: boolean): void {
    this.needsLinks = false;
    if (performance.now() < this.blockedUntil) return;
    for (const at of near) {
      if (this.lowFetches >= LOW_FETCHES && this.sharpFetches >= SHARP_FETCHES) break;
      const e = this.shown[at];
      const wantsLow = e.pano.preview !== null && e.lowState === "idle";
      const wantsSharp = e.sharpState === "idle";
      if (!wantsLow && !wantsSharp) continue;
      if (!linksUsable) {
        this.needsLinks = true;
        return;
      }
      if (wantsLow && this.lowFetches < LOW_FETCHES) void this.fetchFaces(e, "low");
      if (wantsSharp && !this.holdSharp && this.sharpFetches < SHARP_FETCHES) void this.fetchFaces(e, "sharp");
    }
  }

  private async fetchFaces(e: Entry, layer: "low" | "sharp"): Promise<void> {
    const urls = layer === "low" ? e.pano.preview : e.pano.faces;
    const set = (state: Bytes) => {
      if (layer === "low") e.lowState = state;
      else e.sharpState = state;
    };
    if (!urls || !urls.every(isAllowedAssetUrl)) {
      set("failed");
      return;
    }
    set("loading");
    if (layer === "low") this.lowFetches++;
    else this.sharpFetches++;
    try {
      const blobs = await Promise.all(
        urls.map(async (url) => {
          const response = await fetch(url, {
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: this.abort.signal,
          });
          if (!response.ok) throw new Error(`face ${response.status}`);
          return response.blob();
        }),
      );
      if (this.disposed) return;
      if (layer === "low") e.lowBytes = blobs;
      else e.sharpBytes = blobs;
      set("held");
      // The small cube comes from the preview where there is one, else from the full-size faces.
      if (layer === "low") void this.decodeLow(e, blobs, false);
      else if (e.pano.preview === null || e.lowState === "failed") void this.decodeLow(e, blobs, true);
    } catch {
      if (this.disposed) return;
      // Most likely a link that ran out: ask for new ones, wait a moment, try again.
      e.tries++;
      set(e.tries >= TRIES ? "failed" : "idle");
      // No preview after all: the small cube is made from the full-size faces instead.
      if (layer === "low" && e.lowState === "failed" && e.sharpBytes) void this.decodeLow(e, e.sharpBytes, true);
      this.blockedUntil = performance.now() + BACK_OFF;
      this.onStale?.();
    } finally {
      if (layer === "low") this.lowFetches--;
      else this.sharpFetches--;
    }
  }

  // ---- decoding, off the main thread, one image at a time per layer ----

  private decode(blob: Blob, chain: "low" | "sharp", options: ImageBitmapOptions): Promise<ImageBitmap> {
    const before = chain === "low" ? this.decodingLow : this.decodingSharp;
    const next = before.then(() => createImageBitmap(blob, options));
    const settled = next.catch(() => undefined);
    if (chain === "low") this.decodingLow = settled;
    else this.decodingSharp = settled;
    return next;
  }

  /** `image` as cube slot `slot` wants it: as it is for the scan's own layout, else redrawn turned. */
  private async oriented(image: ImageBitmap, slot: number): Promise<ImageBitmap> {
    const { identity, transform } = this.align.layout[slot];
    if (identity) return image;
    const size = image.width;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d canvas");
    const [a, b, c, d] = transform;
    context.setTransform(a, b, c, d, size / 2, size / 2);
    context.drawImage(image, -size / 2, -size / 2);
    image.close();
    return createImageBitmap(canvas, BITMAP);
  }

  private async decodeLow(e: Entry, blobs: Blob[], shrink: boolean): Promise<void> {
    if (e.lowStarted) return;
    e.lowStarted = true;
    const options: ImageBitmapOptions = shrink
      ? { ...BITMAP, resizeWidth: LOW_SIZE, resizeHeight: LOW_SIZE, resizeQuality: "medium" }
      : BITMAP;
    const images: ImageBitmap[] = [];
    try {
      for (let slot = 0; slot < 6; slot++) {
        const image = await this.decode(blobs[this.align.layout[slot].face], "low", options);
        images.push(await this.oriented(image, slot));
        if (this.disposed) throw new Error("gone");
      }
      const size = images[0].width;
      if (!images.every((i) => i.width === size && i.height === size)) throw new Error("faces differ in size");
      this.lowJobs.push({ entry: e, images, raw: null, next: 0 });
    } catch {
      for (const image of images) image.close();
      if (!this.disposed) e.lowState = "failed";
    }
  }

  private async decodeSharp(e: Entry): Promise<void> {
    const blobs = e.sharpBytes;
    if (!blobs) return;
    this.sharpBusy = true;
    e.sharpStage = "working";
    if (this.worker) {
      try {
        const pixels: Uint8Array[] = [];
        let size = 0;
        for (let slot = 0; slot < 6; slot++) {
          // One face at a time: six at once would starve the frame of processor time.
          const face = await this.pixelsOf(blobs[this.align.layout[slot].face], slot);
          if (slot === 0) size = face.size;
          if (face.size !== size || size % STRIPS !== 0) throw new Error("faces differ in size");
          pixels.push(face.pixels);
          if (this.disposed) return;
        }
        this.sharpJob = { entry: e, size, pixels, strips: [], raw: null, slot: 0, strip: 0 };
        return;
      } catch {
        if (this.disposed) return;
        // Fall through to the main thread: the worker may be what failed, not the bytes.
      }
    }
    const strips: ImageBitmap[][] = [];
    try {
      let size = 0;
      for (let slot = 0; slot < 6; slot++) {
        const decoded = await this.decode(blobs[this.align.layout[slot].face], "sharp", BITMAP);
        const face = await this.oriented(decoded, slot);
        if (slot === 0) size = face.width;
        if (face.width !== size || face.height !== size || size % STRIPS !== 0) {
          face.close();
          throw new Error("faces differ in size");
        }
        const rows = size / STRIPS;
        const cut: ImageBitmap[] = [];
        strips.push(cut);
        for (let k = 0; k < STRIPS; k++) cut.push(await createImageBitmap(face, 0, k * rows, size, rows, BITMAP));
        face.close();
        if (this.disposed) throw new Error("gone");
      }
      this.sharpJob = { entry: e, size, pixels: null, strips, raw: null, slot: 0, strip: 0 };
    } catch {
      for (const cut of strips) for (const strip of cut) strip.close();
      e.sharpStage = "none";
      this.sharpBusy = false;
      // Bytes that won't decode are no use: don't choose this panorama again.
      if (!this.disposed) e.sharpState = "failed";
    }
  }

  // ---- the sharp layer's choice ----

  private chooseSharp(near: readonly number[], eye: Vec3, velocity: readonly [number, number]): void {
    if (this.warming > 0) return;
    const shown = this.shown;
    const here = shown[near[0]];
    const neighbours = here.pano.neighbours.flatMap((anchor) => this.byAnchor.get(anchor) ?? []);
    const order = sharpOrder({ positions: this.positions, eye, velocity, neighbours, horizon: HORIZON });
    const have = new Set<number>();
    shown.forEach((e, at) => {
      if (e.sharpStage !== "none") have.add(at);
    });
    const plan = planSharp(order, have, (at) => shown[at].sharpState === "held", this.capacity, this.capacity - 1);
    if (plan.drop !== null) {
      // One being filled finishes first; one already fading out is on its way.
      const e = shown[plan.drop];
      if (e.sharpStage === "ready") e.sharpStage = "leaving";
    }
    if (plan.start !== null && !this.sharpBusy) void this.decodeSharp(shown[plan.start]);
  }

  private releaseSharp(e: Entry): void {
    if (e.sharpCube) this.renderer.properties.remove(e.sharpCube);
    if (e.sharp) {
      if (this.sizes.get(e.sharp) === this.sharpSize) this.pool.push(e.sharp);
      else this.discard(e.sharp);
    }
    e.sharp = null;
    e.sharpCube = null;
    e.sharpStage = "none";
    e.sharpMix = 0;
  }

  // ---- the GPU, a slice a frame ----

  /** A new, empty cube `size` across, with or without room for its smaller copies. Slow for a big one: the GPU clears it. */
  private allocate(size: number, mipmaps: boolean): WebGLTexture {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const state = this.renderer.state;
    const raw = gl.createTexture();
    state.bindTexture(gl.TEXTURE_CUBE_MAP, raw);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, mipmaps ? Math.floor(Math.log2(size)) + 1 : 1, gl.RGBA8, size, size);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mipmaps) {
      // A floor seen at a slant stays sharp.
      const anisotropic = this.renderer.extensions.get("EXT_texture_filter_anisotropic") as { TEXTURE_MAX_ANISOTROPY_EXT: number } | null;
      if (anisotropic) gl.texParameterf(gl.TEXTURE_CUBE_MAP, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
      // One texel a face: the driver puts off making the texture until it is
      // written to, and this is the moment to pay for that.
      const texel = new Uint8Array(4);
      this.unpack(gl);
      for (let face = 0; face < 6; face++) {
        gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, texel);
      }
    }
    state.unbindTexture();
    return raw;
  }

  private unpack(gl: WebGL2RenderingContext): void {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  private discard(raw: WebGLTexture): void {
    this.renderer.getContext().deleteTexture(raw);
    this.sizes.delete(raw);
  }

  /** A three.js texture that binds `raw` and never uploads to it: it has no version. */
  private wrap(raw: WebGLTexture): CubeTexture {
    const cube = new CubeTexture();
    cube.colorSpace = NoColorSpace;
    const properties = this.renderer.properties.get(cube) as { __webglTexture?: WebGLTexture; __webglInit?: boolean };
    properties.__webglTexture = raw;
    properties.__webglInit = true;
    return cube;
  }

  /** Hand the GPU work, a piece at a time, until this frame's few milliseconds are spent. */
  private pump(): void {
    const start = performance.now();
    if (this.warming > 0) {
      // Slow, and nothing else this frame; the player is not moving yet.
      const raw = this.allocate(this.sharpSize, true);
      this.sizes.set(raw, this.sharpSize);
      this.pool.push(raw);
      this.warming--;
      return;
    }
    // Small cubes and depth cubes are cheap: several a frame. A sharp cube's
    // strip is real work for the GPU however quick the call returns: one a frame.
    this.depthsLeft = DEPTHS;
    while (this.lowJobs.length + (this.depthsLeft > 0 ? this.depthQueue.length : 0) > 0 && performance.now() - start < BUDGET) this.step();
    if (performance.now() - start < BUDGET) this.step();
  }

  /** One piece of work; false when there is none. Small cubes first: they are what fills the building. */
  private step(): boolean {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const state = this.renderer.state;

    const low = this.lowJobs[0];
    if (low) {
      const size = low.images[0].width;
      if (!low.raw) {
        low.raw = this.allocate(size, false);
        this.lowTexels += size * size * 6;
      }
      state.bindTexture(gl.TEXTURE_CUBE_MAP, low.raw);
      this.unpack(gl);
      gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + low.next, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, low.images[low.next]);
      state.unbindTexture();
      low.images[low.next].close();
      low.next++;
      if (low.next === 6) {
        this.lowJobs.shift();
        low.entry.low = low.raw;
        low.entry.lowCube = this.wrap(low.raw);
        this.depthQueue.push(low.entry);
      }
      return true;
    }

    const seen = this.depthsLeft > 0 ? this.depthQueue.shift() : undefined;
    if (seen) {
      this.depthsLeft--;
      const old = seen.depth;
      seen.depth = this.renderDepth(seen.origin);
      old?.dispose();
      return true;
    }

    const job = this.sharpJob;
    if (!job) return false;
    if (!job.raw) {
      const pooled = job.size === this.sharpSize ? this.pool.pop() : undefined;
      job.raw = pooled ?? this.allocate(job.size, true);
      this.sizes.set(job.raw, job.size);
      return true;
    }
    state.bindTexture(gl.TEXTURE_CUBE_MAP, job.raw);
    if (job.slot < 6) {
      const target = gl.TEXTURE_CUBE_MAP_POSITIVE_X + job.slot;
      const rows = job.size / STRIPS;
      const top = job.strip * rows;
      this.unpack(gl);
      if (job.pixels) {
        gl.texSubImage2D(target, 0, 0, top, job.size, rows, gl.RGBA, gl.UNSIGNED_BYTE, job.pixels[job.slot], top * job.size * 4);
      } else {
        const strip = job.strips[job.slot][job.strip];
        gl.texSubImage2D(target, 0, 0, top, gl.RGBA, gl.UNSIGNED_BYTE, strip);
        strip.close();
      }
      state.unbindTexture();
      job.strip++;
      if (job.strip === STRIPS) {
        job.strip = 0;
        job.slot++;
      }
      return true;
    }
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    state.unbindTexture();
    const e = job.entry;
    e.sharp = job.raw;
    e.sharpCube = this.wrap(job.raw);
    e.sharpMix = 0;
    e.sharpStage = "ready";
    this.sharpJob = null;
    this.sharpBusy = false;
    return true;
  }

  /** How far the mesh is from `origin` in every direction, as a cube map. */
  private renderDepth(origin: Vector3): WebGLCubeRenderTarget {
    const renderer = this.renderer;
    // One channel is all it needs, where the GPU can render to one.
    const single = renderer.extensions.has("EXT_color_buffer_float");
    this.depthTexel = single ? 2 : 8;
    const target = new WebGLCubeRenderTarget(DEPTH_SIZE, {
      type: HalfFloatType,
      format: single ? RedFormat : RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    const before = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const level = renderer.getActiveMipmapLevel();
    this.depthMaterial.uniforms.uOrigin.value.copy(origin);
    (this.far.material as ShaderMaterial).uniforms.uOrigin.value.copy(origin);
    this.far.position.copy(origin);
    this.far.updateMatrixWorld();
    const camera = this.depthCamera;
    camera.position.copy(origin);
    CUBE_CAMERAS.forEach(([look, up], i) => {
      camera.up.copy(up);
      camera.lookAt(origin.x + look.x, origin.y + look.y, origin.z + look.z);
      camera.updateMatrixWorld();
      renderer.setRenderTarget(target, i);
      renderer.clear();
      renderer.render(this.depthScene, camera);
    });
    renderer.setRenderTarget(before, face, level);
    return target;
  }

  /**
   * Lets go of the store a piece at a time: the first call stops all
   * fetching and decoding, and each call frees one panorama's cubes, or one
   * spare sharp cube. Freeing a gigabyte of textures at once holds the GPU,
   * and the frame, for a second or two; a piece a frame doesn't. True once
   * everything is gone.
   */
  release(): boolean {
    const gl = this.renderer.getContext();
    if (!this.disposed) {
      this.disposed = true;
      this.abort.abort();
      this.dropWorker();
      for (const job of this.lowJobs) {
        if (job.raw) gl.deleteTexture(job.raw);
        for (const image of job.images.slice(job.next)) image.close();
      }
      this.lowJobs = [];
      if (this.sharpJob) {
        if (this.sharpJob.raw) this.discard(this.sharpJob.raw);
        this.sharpJob.strips.forEach((cut, slot) =>
          cut.forEach((strip, k) => {
            if (slot > this.sharpJob!.slot || (slot === this.sharpJob!.slot && k >= this.sharpJob!.strip)) strip.close();
          }),
        );
        this.sharpJob = null;
      }
      this.shown = [];
      return false;
    }
    const e = this.entries.pop();
    if (e) {
      if (e.sharpCube) this.renderer.properties.remove(e.sharpCube);
      if (e.sharp) this.discard(e.sharp);
      if (e.lowCube) this.renderer.properties.remove(e.lowCube);
      if (e.low) gl.deleteTexture(e.low);
      e.depth?.dispose();
      e.lowBytes = null;
      e.sharpBytes = null;
      return false;
    }
    const raw = this.pool.pop();
    if (raw) {
      this.discard(raw);
      return false;
    }
    if (this.depthMaterial) {
      this.depthMaterial.dispose();
      (this.far.material as ShaderMaterial).dispose();
      this.far.geometry.dispose();
    }
    return true;
  }

  dispose(): void {
    while (!this.release());
  }
}
