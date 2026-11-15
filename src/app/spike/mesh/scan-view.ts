// One scan, drawn from wherever the caller puts the eye (issue 118).
//
// The renderer the free-walk sandbox runs on, with no input, movement or
// frame loop of its own, so a game's first-person view can drive it the same
// way: give it a canvas and a scan, then each frame `setPose` and `render`.
// It loads the scan's mesh and panoramas, paints the mesh from them, and
// answers the two questions a walking controller asks of the floor and walls
// (`world`: lib/scan-mesh/movement.ts's MoveWorld). All of the scan lives in
// this tab's memory; nothing is stored.
//
// Frame: the scan's, y-up, metres. Yaw 0 looks down -z and grows turning
// left; pitch grows looking up (three.js's camera convention).
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Ray,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type CubeTexture,
  ShaderMaterial,
  Vector2,
} from "three";
import type { BlendMode } from "@/lib/scan-mesh/blend";
import type { Vec3 } from "@/lib/scan-mesh/coords";
import {
  isAllowedAssetUrl,
  type MeshResolution,
  type PanoResolution,
  type ScanDetail,
  type ScanManifest,
} from "@/lib/scan-mesh/manifest";
import { fitLevels, type LevelSample } from "@/lib/scan-mesh/levels";
import { TUNING, type MoveWorld } from "@/lib/scan-mesh/movement";
import { packShelves, type Placement } from "@/lib/scan-mesh/atlas";
import { cubeSphere } from "@/lib/scan-mesh/cube-sphere";
import { PATCH_MARGIN, type PlanePatch } from "@/lib/scan-mesh/planes";
import { parseObj } from "@/lib/scan-mesh/obj";
import { feetUnder, linksFresh, poseVelocity, sharpLayer, viewStats, type ScanPose, type ViewStats } from "@/lib/scan-mesh/pose";
import { distanceToGroup, type TexturedGroup } from "@/lib/scan-mesh/textured";
import { MeshWorld } from "./collider";
import type { DetailReply, DetailRequest, RepairStats } from "./detail-worker";
import { matchExposure } from "./exposure-match";
import { HoleFill } from "./hole-fill";
import { blankCube, PanoStore, type PanoCounts, type PanoUse } from "./panos";
import { createPhotoMaterial, createPhotoUniforms, type PhotoUniforms } from "./photo-material";
import { createScanMaterial, SLOTS } from "./projection";
import { createSphereMaterial } from "./sphere-material";
import { createPhotoViewMaterial, photoShift } from "./photo-view-material";

export type { ScanPose } from "@/lib/scan-mesh/pose";
export { eyePose, yawFromHeading } from "@/lib/scan-mesh/pose";

export type ScanPhase = "manifest" | "mesh" | "building" | "ready" | "no-mesh" | "error";

export interface ScanViewOptions {
  modelId: string;
  /** Panorama sharpness: `2k` by default. */
  faces?: PanoResolution;
  /** The walkable mesh: `50k` by default. */
  mesh?: MeshResolution;
  /** Whether to load the Matterpak's detailed mesh for the picture, where the scan has one. Default true. */
  detail?: boolean;
  /**
   * Whether the detailed mesh has the Matterpak's own textures under the
   * panoramas: a surface no panorama near the eye saw shows its texture.
   * Default true; off, the panoramas alone paint it, as they do the 50k mesh.
   */
  textured?: boolean;
  /** Whether to fill what no scanned surface covers from the pixels around it, and close the mesh's small holes. Default true. */
  fill?: boolean;
  /**
   * The detailed mesh's repairs: its shards left out, and its flat surfaces
   * carried across their gaps and over what no panorama saw of them. "all"
   * by default; "none", or one of the two, to compare.
   */
  repair?: "all" | "none" | "shards" | "planes";
  /**
   * What is drawn. "spheres" (the default): the panoramas themselves, each
   * a sphere pushed out to its own depth (sphere-material.ts), over the
   * mesh, which shows only through what the spheres leave out. "mesh": the
   * mesh alone, painted from the panoramas and its textures. "photo" (the
   * default): the nearest panorama alone, warped a little by its depth
   * (photo-view-material.ts), dissolving into the next when it changes.
   */
  view?: "spheres" | "mesh" | "photo";
  /** Vertical field of view, degrees. */
  fov?: number;
  /** Called whenever `status()` has news: a phase, the detailed mesh, the exposure match. */
  onChange?: () => void;
}

export interface ScanDetailStatus {
  state: "none" | "loading" | "ready" | "failed" | "off";
  triangles: number;
  megabytes: number;
  seconds: number;
  reason?: string;
  /** The Matterpak's textures: how many, how many are in (small, and full size near the eye), and whether all have been fetched. */
  textures?: ScanTextureStatus;
  /** Small holes in the detailed mesh that were closed. */
  holes?: number;
  /** The mesh's repairs: its shards left out, and its planes' patches. */
  repair?: ScanRepairStatus;
}

export interface ScanRepairStatus {
  /** Null until the repair is in. */
  stats: RepairStats | null;
  /** Patches carried across gaps in planes, and how many have a texture made for them so far. */
  patches: number;
  synthesized: number;
}

export interface ScanTextureStatus {
  total: number;
  small: number;
  sharp: number;
  megabytes: number;
  /** Seconds from the mesh's arrival to every texture fetched. */
  seconds: number;
  done: boolean;
  /** What the textures take on the GPU, roughly, megabytes. */
  gpuMegabytes: number;
}

export interface ScanExposureStatus {
  pairs: number;
  low: number;
  high: number;
  on: boolean;
  before: number;
  after: number;
}

export interface ScanViewStatus {
  phase: ScanPhase;
  /** A line for the player when the phase is `error` or `no-mesh`. */
  message: string | null;
  triangles: number;
  panoCount: number;
  detail: ScanDetailStatus;
  exposure: ScanExposureStatus | null;
  /** Seconds each loading step took, and the mesh file's size. */
  timings: { manifest: number | null; download: number | null; megabytes: number | null; build: number | null };
}

/** The renderer's own fixes to the blend (lib/scan-mesh/combine.ts), on by default; off only to compare. */
export interface ScanFixes {
  agree: boolean;
  fill: boolean;
}

/** Vertical field of view: about 103° across on a 16:9 screen, a shooter's default. */
export const DEFAULT_FOV = 71;
/** Fetch new links when the current ones have this little time left, ms. */
const LINK_MARGIN = 20_000;
const MEASURE_WIDTH = 160;
const MEASURE_HEIGHT = 90;
/** The textures are first decoded this many pixels square: all of them fit in GPU memory at once. */
const SMALL_TEXTURE = 512;
/** Textures of surfaces this close to the eye, metres, are shown sharper, this many pixels square... */
const SHARP_REACH = 4;
const SHARP_TEXTURE = 1024;
/** ...this many at most (each about 5.6 MB of GPU memory)... */
const SHARP_MAX = 12;
/** ...chosen again this often, seconds. */
const SHARP_EVERY = 0.3;
/** Textures put on the GPU in one frame at most: small ones, and full-size ones. */
const UPLOADS_SMALL = 4;
const UPLOADS_SHARP = 1;
/** Full-size panorama cubes kept on the GPU beside the textures, at most (each 2k one is about 134 MB). */
const SHARP_CUBES = 5;
/** The same when the panoramas are drawn as spheres: the two the eye is between, and the two it is heading for. */
const SPHERE_CUBES = 4;
/** Squares along each edge of each of a sphere's six faces: about a degree each. */
const SPHERE_CELLS = 96;
/** Under this share the other panorama's sphere is no longer drawn. */
const SPHERE_GONE = 0.004;
/** The other panorama takes the lead once its share is this much: past the midpoint, so standing there does not flip it back and forth. */
const LEAD_TAKES = 0.56;
/** Seconds a new lead takes to come in. */
const LEAD_IN = 0.14;
/** In the photo view: seconds one panorama takes to dissolve into the next. */
const PHOTO_FADE = 0.25;
/** In the photo view a panorama whose full-size cube is not in yet is not switched to, unless the one shown is this far off, metres. */
const PHOTO_WAIT_SHARP = 2.5;
/** A patch's picture is this fine, metres a pixel, and at most this many pixels a side. */
const PATCH_TEXEL = 0.012;
const PATCH_PIXELS = 256;
/** How far either side of a patch's plane its picture takes the mesh from, metres. */
const PATCH_SLAB = 0.07;
/** Patches this far from the eye, metres, wait for their own texture until it comes nearer; and frames between two pictures. */
const PATCH_REACH = 18;
const PATCH_EVERY = 3;
/** The patches' textures share pages this many pixels square, each with this much clear round it, sampled down to this many smaller copies. */
const PAGE_SIZE = 2048;
const PAGE_GUTTER = 4;
const PAGE_LEVELS = 3;
const SOURCE_WIDTH = 160;
const SOURCE_HEIGHT = 90;

/** What paints the view, as parts of the frame (they sum to 1). */
export interface ViewSources {
  /** No surface at all: the panoramas' far view shows (a window, or a gap nothing closes). */
  void: number;
  /** A surface painted from the panoramas. */
  pano: number;
  /** The mesh's own texture, where no panorama near the eye saw the surface. */
  texture: number;
  /** A stand-in's own texture, made from the surface round it. */
  synth: number;
  /** A stand-in nothing painted: filled from the pixels around it. */
  smear: number;
  /** Stand-ins altogether (closed holes, planes carried across gaps), however painted. */
  standin: number;
}

class LoadError extends Error {}

export class ScanView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  /** Resolves true once the scan can be walked and drawn, false if it can't. */
  readonly ready: Promise<boolean>;
  private readonly blank: CubeTexture;
  /** The panoramas alone, for a mesh with no texture of its own: the 50k mesh, shown until the detailed one is in. */
  private readonly material: ShaderMaterial;
  /** The panoramas' uniforms, shared by every material that paints by the photo rule (photo-material.ts). */
  private readonly photo: PhotoUniforms;
  private readonly backdropMaterial: ShaderMaterial;
  private readonly backdrop: Mesh;
  private readonly abort = new AbortController();
  private readonly faces: PanoResolution;
  private readonly meshResolution: MeshResolution;
  /** The walkable mesh (collision, floors), and the one drawn: the detailed mesh once it is in. */
  private geometry: BufferGeometry | null = null;
  private drawn: Mesh | null = null;
  private detailGeometry: BufferGeometry | null = null;
  private detailWorker: Worker | null = null;
  private wire: Mesh | null = null;
  private meshWorld: MeshWorld | null = null;
  private panos: PanoStore | null = null;
  private manifest: ScanManifest | null = null;
  private refreshing = false;
  private exposureStarted = false;
  private disposed = false;
  private pose: ScanPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private lastPose: ScanPose | null = null;
  /** Set by the caller for this frame, else worked out from the last two poses. */
  private velocity: [number, number] | null = null;
  private used: PanoUse[] = [];
  private readonly state: ScanViewStatus;
  /** The textured mesh: its groups, each one's material and textures, and what has arrived but isn't on the GPU yet. */
  private groups: TexturedGroup[] = [];
  private groupMaterials: ShaderMaterial[] = [];
  private small: (Texture | null)[] = [];
  private sharp: (Texture | null)[] = [];
  private sharpWanted = new Set<number>();
  private sharpClock = 0;
  private arrived: { group: number; sharp: boolean; image: ImageBitmap }[] = [];
  private readonly fill: HoleFill | null;
  /** The panoramas as spheres (sphere-material.ts), one for each of the store's first two slots. Empty when the mesh is what is drawn. */
  private spheres: Mesh[] = [];
  /** The panorama whose sphere is in front, by its place in the scan's list, and how far in it has come (0 to 1). */
  private lead = -1;
  private leadIn = 1;
  private readonly sphereView: boolean;
  /** The photo view: the nearest panorama alone, one mesh per store slot, in a scene of their own. */
  private readonly photoView: boolean;
  private readonly photoScene = new Scene();
  private photoMeshes: Mesh[] = [];
  /** The panorama shown, the one it is dissolving from (-1: none), and how far the dissolve has come (0 to 1). */
  private photoLead = -1;
  private photoFrom = -1;
  private photoFade = 1;
  /** In the photo view: tint what the depth is not trusted to move (debug, setConfidenceView). */
  private showConfidence = false;
  private fadeTarget: WebGLRenderTarget | null = null;
  private readonly fadeScene = new Scene();
  private readonly fadeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fadeMaterial = new ShaderMaterial({
    uniforms: { tMap: { value: null }, uAlpha: { value: 1 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "uniform sampler2D tMap; uniform float uAlpha; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tMap, vUv).rgb, uAlpha); }",
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly fillMaterial: ShaderMaterial;
  /** For the fans that close small holes: a step farther behind, so a plane's patch over the same hole wins. */
  private readonly fanMaterial: ShaderMaterial;
  private fillMeshes: Mesh[] = [];
  private patchWait = 0;
  /**
   * The planes' patches: where each one's own texture has got to, the size
   * of the picture taken of its surroundings, the part of that picture the
   * patch itself covers (x, y, width, height), and where that part goes on
   * the patches' shared pages.
   */
  private patches: { patch: PlanePatch; centre: Vector3; state: "idle" | "asked" | "done" | "none"; picture: [number, number]; scale: number; crop: [number, number, number, number]; place: Placement }[] = [];
  private pages: { raw: WebGLTexture; texture: Texture; material: ShaderMaterial; mesh: Mesh }[] = [];
  private patchAsked = -1;
  /** The detailed mesh again in a scene of its own, for taking a patch's picture of the surface round it. */
  private readonly patchScene = new Scene();
  private patchMesh: Mesh | null = null;
  private readonly patchCamera = new OrthographicCamera(0, 1, 1, 0, 0.01, 1);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: ScanViewOptions,
  ) {
    this.faces = options.faces ?? "2k";
    this.meshResolution = options.mesh ?? "50k";
    this.camera = new PerspectiveCamera(options.fov ?? DEFAULT_FOV, 1, 0.05, 3000);
    this.camera.rotation.order = "YXZ";
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.fill = options.fill === false ? null : new HoleFill(this.renderer);
    // Alpha 0 marks a pixel no surface covered, for the fill.
    this.renderer.setClearColor(new Color().setRGB(0.027, 0.035, 0.047), this.fill ? 0 : 1);
    this.blank = blankCube();
    this.material = createScanMaterial(this.blank);
    this.photo = createPhotoUniforms(this.blank);
    this.backdropMaterial = createPhotoMaterial(this.photo, "backdrop");
    this.fillMaterial = createPhotoMaterial(this.photo, "stand-in");
    this.fanMaterial = createPhotoMaterial(this.photo, "stand-in", null, 2);
    this.sphereView = options.view === "spheres";
    this.photoView = options.view === undefined || options.view === "photo";
    if (this.photoView) {
      const { directions, index } = cubeSphere(SPHERE_CELLS);
      const sphere = new BufferGeometry();
      sphere.setAttribute("position", new BufferAttribute(directions, 3));
      sphere.setIndex(new BufferAttribute(index, 1));
      this.photoMeshes = Array.from({ length: SLOTS }, (_, slot) => {
        const mesh = new Mesh(sphere, createPhotoViewMaterial(this.photo, slot));
        mesh.frustumCulled = false;
        mesh.visible = false;
        this.photoScene.add(mesh);
        return mesh;
      });
      const quad = new Mesh(new PlaneGeometry(2, 2), this.fadeMaterial);
      quad.frustumCulled = false;
      this.fadeScene.add(quad);
    }
    if (this.sphereView) {
      const { directions, index } = cubeSphere(SPHERE_CELLS);
      const sphere = new BufferGeometry();
      sphere.setAttribute("position", new BufferAttribute(directions, 3));
      sphere.setIndex(new BufferAttribute(index, 1));
      this.spheres = ([0, 1] as const).map((slot) => {
        const mesh = new Mesh(sphere, createSphereMaterial(this.photo, slot));
        // The shader moves every vertex: the geometry's own bounds say nothing of where it is.
        mesh.frustumCulled = false;
        // After the mesh behind them, before anything a game puts in the scene.
        mesh.renderOrder = -10 + slot;
        mesh.visible = false;
        this.scene.add(mesh);
        return mesh;
      });
      // The mesh is drawn first and is only ever behind: the spheres start from a clean depth, over it.
      this.spheres[0].onBeforeRender = (renderer) => renderer.clearDepth();
    }
    this.backdrop = new Mesh(new BoxGeometry(1000, 1000, 1000), this.backdropMaterial);
    // Behind everything, the mesh and the spheres included: it has no depth of its own.
    this.backdrop.renderOrder = -40;
    this.backdrop.frustumCulled = false;
    this.scene.add(this.backdrop);
    this.state = {
      phase: "manifest",
      message: null,
      triangles: 0,
      panoCount: 0,
      detail: { state: "none", triangles: 0, megabytes: 0, seconds: 0 },
      exposure: null,
      timings: { manifest: null, download: null, megabytes: null, build: null },
    };
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
    this.ready = this.load();
  }

  // ---- the caller's side ----

  /** Where the eye is and where it looks, for the next `render`. `velocity` (m/s, x and z) helps the panoramas ahead load first. */
  setPose(pose: ScanPose, velocity?: readonly [number, number]): void {
    this.pose = { ...pose };
    this.velocity = velocity ? [velocity[0], velocity[1]] : null;
  }

  /** Draws the scan from the last pose. `dt` is the seconds since the last frame (it paces the blend's fades). */
  render(dt = 1 / 60): void {
    if (this.disposed) return;
    const { x, y, z, yaw, pitch } = this.pose;
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(pitch, yaw, 0);
    this.backdrop.position.copy(this.camera.position);
    const velocity = this.velocity ?? poseVelocity(this.lastPose, this.pose, dt);
    this.lastPose = { ...this.pose };
    this.velocity = null;
    this.showTextures(dt);
    if (this.panos) {
      this.used = this.panos.update(
        [x, y, z],
        velocity,
        dt,
        [this.material, { uniforms: this.photo }],
        this.blank,
        this.linksUsable(),
      );
      if (this.panos.needsLinks) void this.refreshLinks();
      this.startExposure();
    }
    if (this.spheres.length > 0) {
      const show = this.sphereShown && this.used.length > 0;
      const second = show && this.used.length > 1 && this.used[1].share > SPHERE_GONE;
      if (show) {
        // The lead: the one in front already, until the other has clearly more of the share.
        const [a, b] = this.used;
        const held = a.index === this.lead ? a : b?.index === this.lead ? b : null;
        const rival = held === a ? b : a;
        if (!held || (rival && rival.share / (rival.share + held.share) > LEAD_TAKES)) {
          // The first lead is simply there; a later one comes in over a few frames.
          this.leadIn = this.lead === -1 || !held ? 1 : 0;
          this.lead = (held ? rival : a).index;
        }
        this.leadIn = Math.min(1, this.leadIn + dt / LEAD_IN);
      }
      this.spheres.forEach((mesh, slot) => {
        const use = this.used[slot];
        mesh.visible = show && use !== undefined && (slot === 0 || second);
        if (!use) return;
        const front = use.index === this.lead;
        const uniforms = (mesh.material as ShaderMaterial).uniforms;
        uniforms.uBehind.value = front ? 0 : 1;
        uniforms.uSolid.value = front ? this.leadIn : 1;
      });
    }
    if (this.photoView) this.choosePhoto(dt);
    this.draw(null);
  }

  /** The photo view's lead: the store's nearest (it holds one until another is clearly nearer), dissolved into when it changes. */
  private choosePhoto(dt: number): void {
    const lead = this.panos?.leadIndex ?? -1;
    const inUse = (index: number) => this.used.some((u) => u.index === index);
    const slotOf = (index: number) => this.used.findIndex((u) => u.index === index);
    const sharp = (index: number) => ((this.photo.uPanoSharp.value as number[])[slotOf(index)] ?? 0) >= 0.99;
    const shown = this.used[slotOf(this.photoLead)];
    const { x, y, z } = this.pose;
    const far = !shown || Math.hypot(shown.origin[0] - x, shown.origin[1] - y, shown.origin[2] - z) > PHOTO_WAIT_SHARP;
    // A blurry picture of the nearest place reads worse than a sharp one of the place a step back: wait for the new one's full cube.
    if (lead !== -1 && lead !== this.photoLead && inUse(lead) && (sharp(lead) || far || !sharp(this.photoLead))) {
      // A first picture is simply there; a later one dissolves in from what was shown.
      this.photoFrom = this.photoLead !== -1 && inUse(this.photoLead) ? this.photoLead : -1;
      this.photoFade = this.photoFrom === -1 ? 1 : 0;
      this.photoLead = lead;
    }
    this.photoFade = Math.min(1, this.photoFade + dt / PHOTO_FADE);
    if (this.photoFade >= 1 || !inUse(this.photoFrom)) this.photoFrom = -1;
  }

  /** Draws the photo view's panorama in store slot `slot` alone, to `target`, from the camera, warped for its clamped offset. */
  private drawPhotoSlot(slot: number, target: WebGLRenderTarget | null): void {
    const origin = (this.photo.uPanoPos.value as Vector3[])[slot];
    const eye = this.camera.position;
    const shift = photoShift([eye.x, eye.y, eye.z], [origin.x, origin.y, origin.z]);
    this.photoMeshes.forEach((mesh, i) => (mesh.visible = i === slot));
    const uniforms = (this.photoMeshes[slot].material as ShaderMaterial).uniforms;
    (uniforms.uShift.value as Vector3).set(shift[0], shift[1], shift[2]);
    uniforms.uShowConfidence.value = this.showConfidence ? 1 : 0;
    const height = target ? target.height : this.renderer.getDrawingBufferSize(new Vector2()).y;
    uniforms.uPixel.value = (this.camera.fov * Math.PI) / 180 / Math.max(1, height);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.photoScene, this.camera);
  }

  /** The photo view: the lead's panorama alone, and while one dissolves into the next, the old one over it fading out. */
  private drawPhoto(target: WebGLRenderTarget | null): boolean {
    const slotOf = (index: number) => this.used.findIndex((u) => u.index === index);
    const lead = slotOf(this.photoLead);
    if (lead < 0 || lead >= this.photoMeshes.length) return false;
    const before = this.renderer.getRenderTarget();
    const from = this.photoFrom === -1 ? -1 : slotOf(this.photoFrom);
    if (from >= 0 && from < this.photoMeshes.length && this.photoFade < 1) {
      const size = this.renderer.getDrawingBufferSize(new Vector2());
      if (!this.fadeTarget || this.fadeTarget.width !== size.x || this.fadeTarget.height !== size.y) {
        this.fadeTarget?.dispose();
        this.fadeTarget = new WebGLRenderTarget(size.x, size.y, { samples: 4 });
      }
      this.drawPhotoSlot(from, this.fadeTarget);
      this.drawPhotoSlot(lead, target);
      const t = this.photoFade;
      this.fadeMaterial.uniforms.tMap.value = this.fadeTarget.texture;
      this.fadeMaterial.uniforms.uAlpha.value = 1 - t * t * (3 - 2 * t);
      const clear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.render(this.fadeScene, this.fadeCamera);
      this.renderer.autoClear = clear;
    } else this.drawPhotoSlot(lead, target);
    this.renderer.setRenderTarget(before);
    return true;
  }

  /** Renders the current view to `target` (null: the screen), filled where no surface covers it. */
  draw(target: WebGLRenderTarget | null): void {
    if (this.photoView && this.sphereShown && this.drawPhoto(target)) return;
    // In the sphere view every pixel is painted: the far view, the mesh over it, the spheres over that.
    if (this.fill && this.shows === "mesh") {
      this.fill.render(this.scene, this.camera, target);
      return;
    }
    const before = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(before);
  }

  /** Whether the spheres are what is shown (they are, in the sphere view, unless switched off to look at the mesh under them). */
  private sphereShown = true;

  /** In the sphere view: show the mesh under the spheres instead, or the spheres again. Nothing changes in the mesh view. */
  setSpheres(on: boolean): void {
    if (this.photoView) {
      this.sphereShown = on;
      return;
    }
    if (this.spheres.length === 0) return;
    this.sphereShown = on;
    // The mesh stays drawn under the spheres: what they leave out shows it. Its stand-ins are for the mesh view alone.
    for (const mesh of this.fillMeshes) mesh.visible = !on;
    if (!on) for (const mesh of this.spheres) mesh.visible = false;
  }

  /** What is drawn: the panoramas as spheres, or the mesh. */
  get shows(): "spheres" | "mesh" {
    return (this.spheres.length > 0 || this.photoView) && this.sphereShown ? "spheres" : "mesh";
  }

  /** The drawing size, CSS pixels. */
  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** The floor and walls, for a walking controller (null until the mesh is in). */
  get world(): MoveWorld | null {
    return this.meshWorld;
  }

  /** The floor's height under (x, z), searching down from `fromY` at most `depth` metres; null over a hole. */
  floorAt(x: number, fromY: number, z: number, depth = 3): number | null {
    return this.meshWorld?.floorBelow(x, fromY, z, depth) ?? null;
  }

  /** The scan positions, y-up, in the scan's order: where the picture is exact. */
  scanPositions(): Vec3[] {
    return (this.manifest?.panos ?? []).map((p) => p.position);
  }

  /** Where the feet stand under scan position `index`, or null. */
  feetAt(index: number): Vec3 | null {
    const pano = this.manifest?.panos[index];
    if (!pano) return null;
    const [x, y, z] = pano.position;
    return feetUnder(pano.position, this.floorAt(x, y, z, 3), pano.floor);
  }

  /** The scan position nearest `eye`, by index, or -1. */
  nearestScan(eye: Vec3): number {
    if (this.panos) return this.panos.nearest(eye);
    let best = -1;
    let near = Infinity;
    (this.manifest?.panos ?? []).forEach((p, i) => {
      const d = Math.hypot(p.position[0] - eye[0], p.position[1] - eye[1], p.position[2] - eye[2]);
      if (d < near) {
        near = d;
        best = i;
      }
    });
    return best;
  }

  /** Whether the picture around `eye` has arrived, so a player can be let loose there. */
  settled(eye: Vec3): boolean {
    if (this.groups.length > 0) {
      // The textured mesh: settled once the textures near the eye are in.
      return this.groups.every((g, i) => this.small[i] !== null || !g.image || distanceToGroup(g, eye) > SHARP_REACH || this.state.detail.textures?.done);
    }
    return !this.panos || this.panos.settled(eye);
  }

  status(): ScanViewStatus {
    return {
      ...this.state,
      detail: {
        ...this.state.detail,
        textures: this.state.detail.textures ? { ...this.state.detail.textures } : undefined,
        repair: this.state.detail.repair ? { ...this.state.detail.repair } : undefined,
      },
      exposure: this.state.exposure ? { ...this.state.exposure } : null,
      timings: { ...this.state.timings },
    };
  }

  /** The panoramas in the blend this frame, strongest first. */
  inUse(): PanoUse[] {
    return this.used;
  }

  counts(): PanoCounts | null {
    return this.panos?.counts() ?? null;
  }

  // ---- looks, to compare and to debug ----

  /** 1 shows the panoramas, 0 the bare mesh, and in between a mix. */
  setProjection(amount: number): void {
    this.material.uniforms.uProjection.value = amount;
    this.photo.uProjection.value = amount;
  }

  setBlend(mode: BlendMode): void {
    if (this.panos) this.panos.mode = mode;
  }

  get blend(): BlendMode {
    return this.panos?.mode ?? "photo";
  }

  /** Apply the exposure gains or not: to see what they do. */
  setExposure(on: boolean): void {
    if (this.panos) this.panos.useGains = on;
    if (this.state.exposure) this.state.exposure = { ...this.state.exposure, on };
  }

  setFixes(fixes: Partial<ScanFixes>): void {
    if (fixes.agree !== undefined) this.material.uniforms.uAgree.value = fixes.agree ? 1 : 0;
    if (fixes.fill !== undefined) this.material.uniforms.uFill.value = fixes.fill ? 1 : 0;
  }

  /** 0 the picture, 1 the coverage, 2 the doubles (projection.ts says what the colours mean). */
  /** In the photo view: tint red what is held still because its depth is not trusted. */
  setConfidenceView(on: boolean): void {
    this.showConfidence = on;
  }

  setDebugView(mode: number): void {
    this.material.uniforms.uDebug.value = mode;
  }

  /** The mesh's edges over the picture: how to judge whether the panoramas line up. */
  toggleWire(): void {
    if (!this.geometry) return;
    if (this.wire) {
      this.scene.remove(this.wire);
      (this.wire.material as MeshBasicMaterial).dispose();
      this.wire = null;
      return;
    }
    const material = new MeshBasicMaterial({
      color: new Color().setRGB(0.95, 0.66, 0.23),
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.wire = new Mesh(this.drawn?.geometry ?? this.geometry, material);
    this.scene.add(this.wire);
  }

  /** The current view's coverage and doubles, from a small copy rendered in the debug looks (lib/scan-mesh/pose.ts's `viewStats`). */
  measure(): ViewStats {
    if (this.groups.length > 0) {
      // The photo rule: one panorama a point, so nothing doubles; what no panorama saw has its texture.
      const sources = this.measureSources();
      return { mesh: 1 - sources.void - sources.standin, unseen: 0, unseenNear: 0, unseenClose: 0, unseenMixed: 0, ghost: 0, spread: 0, doubled: 0, filled: sources.void };
    }
    const target = new WebGLRenderTarget(MEASURE_WIDTH, MEASURE_HEIGHT);
    const pixels = new Uint8Array(MEASURE_WIDTH * MEASURE_HEIGHT * 4);
    const coverage = new Uint8Array(pixels.length);
    const before = this.renderer.getRenderTarget();
    const debug = this.material.uniforms.uDebug.value;
    this.backdrop.visible = false;
    try {
      this.renderer.setRenderTarget(target);
      for (const [mode, out] of [
        [1, coverage],
        [2, pixels],
      ] as const) {
        this.material.uniforms.uDebug.value = mode;
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
        this.renderer.readRenderTargetPixels(target, 0, 0, MEASURE_WIDTH, MEASURE_HEIGHT, out);
      }
    } finally {
      this.material.uniforms.uDebug.value = debug;
      this.backdrop.visible = true;
      this.renderer.setRenderTarget(before);
      target.dispose();
    }
    return viewStats(coverage, pixels);
  }

  // ---- loading ----

  private push(): void {
    if (!this.disposed) this.options.onChange?.();
  }

  private async fetchManifest(): Promise<ScanManifest> {
    // The id goes in the body so the server's request log never shows it.
    const response = await fetch("/api/scan-mesh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ m: this.options.modelId, faces: this.faces, mesh: this.meshResolution }),
      cache: "no-store",
      signal: this.abort.signal,
    });
    const body = (await response.json().catch(() => null)) as (ScanManifest & { message?: string }) | null;
    if (!response.ok || !body) {
      throw new LoadError(body?.message ?? "The scan couldn't be loaded.");
    }
    return body;
  }

  private async load(): Promise<boolean> {
    const state = this.state;
    try {
      let at = performance.now();
      const manifest = await this.fetchManifest();
      if (this.disposed) return false;
      this.manifest = manifest;
      state.timings.manifest = (performance.now() - at) / 1000;
      state.panoCount = manifest.panos.length;
      if (!manifest.mesh || !isAllowedAssetUrl(manifest.mesh.url)) {
        state.phase = "no-mesh";
        state.message = "No mesh for this scan. It can only be toured in the embedded viewer.";
        this.push();
        return false;
      }

      state.phase = "mesh";
      this.push();
      at = performance.now();
      const response = await fetch(manifest.mesh.url, {
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: this.abort.signal,
      });
      if (!response.ok) throw new LoadError("The scan's mesh couldn't be downloaded. Reload to try again.");
      const text = await response.text();
      if (this.disposed) return false;
      state.timings.download = (performance.now() - at) / 1000;
      state.timings.megabytes = text.length / 1e6;

      state.phase = "building";
      this.push();
      // Let the caller paint before the parse holds the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      at = performance.now();
      const parsed = parseObj(text);
      if (parsed.index.length === 0) {
        state.phase = "no-mesh";
        state.message = "This scan's mesh is empty.";
        this.push();
        return false;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(parsed.positions, 3));
      geometry.setIndex(new BufferAttribute(parsed.index, 1));
      geometry.computeBoundingSphere();
      this.geometry = geometry;
      this.meshWorld = new MeshWorld(geometry, TUNING.stepUp);
      this.addLevels(this.meshWorld);
      state.timings.build = (performance.now() - at) / 1000;
      state.triangles = parsed.index.length / 3;
      this.drawn = new Mesh(geometry, this.material);
      // Under the spheres too, drawn before them: whatever they leave out shows the mesh, painted from the panoramas, never nothing.
      this.drawn.renderOrder = -30;
      this.scene.add(this.drawn);

      const sharp = sharpLayer(this.faces);
      this.panos = new PanoStore(this.renderer, geometry, Math.min(sharp.capacity, this.sphereView || this.photoView ? SPHERE_CUBES : SHARP_CUBES), sharp.size);
      this.panos.pair = this.sphereView;
      this.panos.leadFirst = this.photoView;
      this.panos.onStale = () => void this.refreshLinks();
      const sight = new Ray();
      const world = this.meshWorld;
      this.panos.blocked = (eye, origin) => {
        sight.origin.set(eye[0], eye[1], eye[2]);
        sight.direction.set(origin[0] - eye[0], origin[1] - eye[1], origin[2] - eye[2]);
        const reach = sight.direction.length();
        sight.direction.divideScalar(Math.max(reach, 1e-6));
        return world.bvh.raycastFirst(sight, DoubleSide, 0, Math.max(0, reach - 0.3)) !== null;
      };
      this.panos.setPanos(manifest.panos);

      this.loadDetail(manifest.detail);
      state.phase = "ready";
      this.push();
      return true;
    } catch (error) {
      if (this.disposed) return false;
      state.phase = "error";
      state.message = error instanceof LoadError ? error.message : "The scan couldn't be loaded.";
      this.push();
      return false;
    }
  }

  private async refreshLinks(): Promise<void> {
    if (this.refreshing || this.disposed) return;
    this.refreshing = true;
    try {
      const manifest = await this.fetchManifest();
      if (this.disposed) return;
      this.manifest = { ...manifest, mesh: this.manifest?.mesh ?? manifest.mesh };
      this.panos?.setPanos(manifest.panos);
    } catch {
      // Keep what is loaded; the next stale link asks again.
    } finally {
      // Not straight away: a scan whose links keep failing must not hammer the API.
      setTimeout(() => (this.refreshing = false), 5000);
    }
  }

  /** Whether the links in hand still have time on them. New ones are asked for only when a panorama needs one. */
  private linksUsable(): boolean {
    return linksFresh(this.manifest?.validUntil, Date.now(), LINK_MARGIN);
  }

  /**
   * Fetch the Matterpak's detailed mesh in a worker and, once in, draw it and
   * see the panoramas' occlusion against it. Walking stays on the 50k mesh,
   * whose floors are clean. Then, where the Matterpak has them, its textures
   * stream in, nearest the eye first: each part of the mesh then has its own
   * texture under the panoramas, for what none of them near the eye saw.
   */
  private loadDetail(detail: ScanDetail | null): void {
    const status = this.state.detail;
    if (this.options.detail === false) {
      status.state = "off";
      return;
    }
    if (!detail || detail.bytes === null || !isAllowedAssetUrl(detail.url)) return;
    status.state = "loading";
    // The spheres have no use for the mesh's textures: the mesh is only their depth.
    const textured = this.options.textured !== false && !this.sphereView && !this.photoView;
    // The 9 MB or so of mesh first: the full-size faces, hundreds of megabytes, wait for it.
    if (this.panos) this.panos.holdSharp = true;
    const release = () => {
      if (this.panos) this.panos.holdSharp = false;
    };
    const fail = (reason: string) => {
      this.detailWorker?.terminate();
      this.detailWorker = null;
      release();
      if (status.state === "loading") {
        status.state = "failed";
        status.reason = reason;
      }
      this.push();
    };
    try {
      const worker = new Worker(new URL("./detail-worker.ts", import.meta.url), { type: "module" });
      this.detailWorker = worker;
      worker.onmessage = (event: MessageEvent<DetailReply>) => {
        const reply = event.data;
        if (this.disposed) return;
        if (reply.kind === "failed") return fail(reply.failed);
        if (reply.kind === "mesh") {
          this.useDetail(reply);
          release();
          return;
        }
        if (reply.kind === "repair") {
          this.useRepair(reply);
          // With no textures to fetch or patches to texture, that was the worker's last word.
          if (this.groups.length === 0) {
            worker.terminate();
            this.detailWorker = null;
          }
          return;
        }
        if (reply.kind === "inpainted") {
          this.usePatchPicture(reply.id, reply.pixels);
          return;
        }
        if (reply.kind === "texture") {
          this.arrived.push(reply);
          return;
        }
        const textures = this.state.detail.textures;
        if (textures) Object.assign(textures, { done: true, megabytes: reply.megabytes, seconds: reply.seconds });
        this.push();
      };
      worker.onerror = (event) => fail(`worker: ${event.message}`);
      const request: DetailRequest = {
        kind: "load",
        url: detail.url,
        bytes: detail.bytes,
        textures: textured,
        small: SMALL_TEXTURE,
        sharp: SHARP_TEXTURE,
        repair: this.options.repair ?? "all",
        panos: (this.manifest?.panos ?? []).filter((p) => p.faces !== null).map((p) => [p.position[0], p.position[1], p.position[2]]),
      };
      worker.postMessage(request);
    } catch {
      release();
      status.state = "failed";
    }
  }

  private useDetail(reply: Extract<DetailReply, { kind: "mesh" }>): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(reply.positions, 3));
    geometry.setAttribute("uv", new BufferAttribute(reply.uvs, 2));
    geometry.setIndex(new BufferAttribute(reply.index, 1));
    geometry.computeBoundingSphere();
    this.detailGeometry = geometry;
    if (reply.textured > 0) {
      this.groups = reply.groups;
      reply.groups.forEach((g, i) => geometry.addGroup(g.start, g.count, i));
      this.groupMaterials = reply.groups.map(() => this.material);
      this.small = reply.groups.map(() => null);
      this.sharp = reply.groups.map(() => null);
    }
    if (this.drawn) {
      this.drawn.geometry = geometry;
      this.drawn.material = reply.textured > 0 ? this.groupMaterials : this.material;
    }
    if (this.wire) this.wire.geometry = geometry;
    this.panos?.setGeometry(geometry);
    Object.assign(this.state.detail, {
      state: "ready",
      triangles: reply.index.length / 3,
      megabytes: reply.megabytes,
      seconds: reply.seconds,
      textures: reply.textured > 0 ? { total: reply.textured, small: 0, sharp: 0, megabytes: 0, seconds: 0, done: false, gpuMegabytes: 0 } : undefined,
      repair: { stats: null, patches: 0, synthesized: 0 },
    });
    this.push();
  }

  /**
   * The repaired mesh: its triangles without the unseen ones a patch stands
   * in for, the patches themselves, and the fans closing its small holes.
   * The panoramas' depth is rendered again from the result.
   */
  private useRepair(reply: Extract<DetailReply, { kind: "repair" }>): void {
    const geometry = this.detailGeometry;
    if (!geometry) return;
    geometry.setAttribute("position", new BufferAttribute(reply.positions, 3));
    geometry.computeBoundingSphere();
    geometry.setIndex(new BufferAttribute(reply.index, 1));
    if (this.groups.length > 0) {
      geometry.clearGroups();
      reply.groups.forEach((g, i) => geometry.addGroup(g.start, g.count, i));
      this.groups = reply.groups;
    }
    this.useFill(reply.fans, reply.stats.holes);
    if (this.fill && reply.patches.length > 0) this.usePatches(reply.patches, reply.patchPositions, reply.patchUvs);
    this.panos?.setGeometry(geometry);
    const repair = this.state.detail.repair;
    if (repair) Object.assign(repair, { stats: reply.stats, patches: reply.patches.length });
    this.push();
  }

  private useFill(triangles: Float32Array, holes: number): void {
    this.state.detail.holes = holes;
    if (!this.fill || triangles.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(triangles, 3));
    geometry.computeBoundingSphere();
    this.addFill(new Mesh(geometry, this.fanMaterial));
    // A closed hole hides what is behind it from a panorama, like the surface it stands for.
    this.panos?.addOccluder(geometry);
  }

  private addFill(mesh: Mesh): void {
    mesh.visible = this.shows === "mesh";
    this.fillMeshes.push(mesh);
    this.scene.add(mesh);
  }

  /**
   * A floor plane and a ceiling plane for each level, just behind the mesh's
   * own (lib/scan-mesh/levels.ts), from the floor under each scan position
   * and the ceiling over it, so a hole in either shows a surface at the right
   * height rather than the level below or nothing.
   */
  private addLevels(world: MeshWorld): void {
    const manifest = this.manifest;
    if (!this.fill || !manifest) return;
    const ray = new Ray(new Vector3(), new Vector3(0, 1, 0));
    const samples: LevelSample[] = [];
    manifest.panos.forEach((pano, i) => {
      const feet = this.feetAt(i);
      if (!feet) return;
      ray.origin.set(pano.position[0], pano.position[1], pano.position[2]);
      const up = world.bvh.raycastFirst(ray, DoubleSide, 0, 8);
      samples.push({ x: feet[0], z: feet[2], floor: feet[1], ceiling: up ? up.point.y : null });
    });
    for (const level of fitLevels(samples)) {
      const [x0, z0] = level.min;
      const [x1, z1] = level.max;
      const positions: number[] = [];
      for (const y of [level.floor, level.ceiling]) {
        positions.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
      }
      const plane = new BufferGeometry();
      plane.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
      plane.computeBoundingSphere();
      this.addFill(new Mesh(plane, this.fillMaterial));
    }
  }

  /**
   * One frame of the textures: put on the GPU a few of those that have
   * arrived, and choose which are shown full size.
   */
  private showTextures(dt: number): void {
    if (this.groups.length === 0) return;
    let small = 0;
    let sharp = 0;
    const later: { group: number; sharp: boolean; image: ImageBitmap }[] = [];
    for (const item of this.arrived) {
      if (item.sharp ? sharp >= UPLOADS_SHARP : small >= UPLOADS_SMALL) {
        later.push(item);
        continue;
      }
      if (item.sharp) sharp++;
      else small++;
      this.applyTexture(item.group, item.sharp, item.image);
    }
    this.arrived = later;

    this.sharpClock -= dt;
    const textures = this.state.detail.textures;
    if (textures?.done && this.arrived.length === 0) this.askPatchPicture();
    if (this.sharpClock <= 0) {
      this.sharpClock = SHARP_EVERY;
      this.chooseSharp();
      this.detailWorker?.postMessage({ kind: "eye", eye: [this.pose.x, this.pose.y, this.pose.z] } satisfies DetailRequest);
      if (textures) {
        textures.small = this.small.filter(Boolean).length;
        textures.sharp = this.sharp.filter(Boolean).length;
        const bytes = [...this.small, ...this.sharp].reduce((sum, t) => sum + ((t?.userData.bytes as number | undefined) ?? 0), 0);
        textures.gpuMegabytes = bytes / 1e6;
      }
    }
  }

  private applyTexture(group: number, sharp: boolean, image: ImageBitmap): void {
    if (sharp && !this.sharpWanted.has(group)) {
      image.close();
      return;
    }
    const texture = new Texture(image);
    texture.flipY = false;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    // RGBA, and a third again for the smaller copies; the image is let go once uploaded.
    texture.userData.bytes = image.width * image.height * 4 * (4 / 3);
    this.renderer.initTexture(texture);
    image.close();
    const slot = sharp ? this.sharp : this.small;
    slot[group]?.dispose();
    slot[group] = texture;
    this.showGroup(group);
  }

  private showGroup(group: number): void {
    const map = this.sharp[group] ?? this.small[group];
    if (!map) return;
    const material = this.groupMaterials[group];
    if (material === this.material) this.groupMaterials[group] = createPhotoMaterial(this.photo, "mesh", map);
    else material.uniforms.uMap.value = map;
  }

  /** The textures within reach of the eye, nearest first, at full size; the rest small. */
  private chooseSharp(): void {
    const eye: [number, number, number] = [this.pose.x, this.pose.y, this.pose.z];
    const near = this.groups
      .map((g, i) => ({ i, d: distanceToGroup(g, eye), c: Math.hypot(g.centre[0] - eye[0], g.centre[1] - eye[1], g.centre[2] - eye[2]) }))
      .filter(({ i, d }) => d <= SHARP_REACH && this.small[i] !== null)
      // Nearest first; among the boxes the eye stands in, the one whose middle is nearest.
      .sort((a, b) => a.d - b.d || a.c - b.c)
      .slice(0, SHARP_MAX)
      .map(({ i }) => i);
    const wanted = new Set(near);
    for (const i of this.sharpWanted) {
      if (wanted.has(i)) continue;
      this.sharp[i]?.dispose();
      this.sharp[i] = null;
      this.showGroup(i);
    }
    const asked = near.filter((i) => !this.sharpWanted.has(i));
    this.sharpWanted = wanted;
    if (asked.length > 0) this.detailWorker?.postMessage({ kind: "sharp", groups: asked } satisfies DetailRequest);
  }

  /**
   * The planes' patches, drawn a page at a time: each patch's part of its
   * picture has a place on a shared page (lib/scan-mesh/atlas.ts), its
   * corners' texture coordinates are moved there, and one mesh a page draws
   * every patch on it. A page starts empty (alpha 0): a patch is painted by
   * the panoramas and the fill until its own texture is written.
   */
  private usePatches(list: PlanePatch[], positions: Float32Array, uvs: Float32Array): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sized = list.map((patch) => {
      const scale = Math.max(PATCH_TEXEL, Math.max(patch.width, patch.height) / PATCH_PIXELS);
      const width = Math.max(8, Math.round(patch.width / scale));
      const height = Math.max(8, Math.round(patch.height / scale));
      // The picture has a margin of the surface round the gap, to fill it from; the patch covers the middle.
      const mx = Math.min(Math.floor(PATCH_MARGIN / scale), (width - 2) >> 1);
      const my = Math.min(Math.floor(PATCH_MARGIN / scale), (height - 2) >> 1);
      return { scale, picture: [width, height] as [number, number], crop: [mx, my, width - 2 * mx, height - 2 * my] as [number, number, number, number] };
    });
    const packed = packShelves(sized.map((s) => [s.crop[2], s.crop[3]] as const), PAGE_SIZE, PAGE_GUTTER);
    const corners: number[] = Array.from({ length: packed.pages }, () => 0);
    list.forEach((patch, i) => {
      const { picture, crop } = sized[i];
      const place = packed.placements[i];
      corners[place.page] += patch.count;
      for (let k = patch.start; k < patch.start + patch.count; k++) {
        // Half a pixel in from the picture's edge, so the page's empty texels beside it are never sampled at full size.
        const px = Math.min(crop[2] - 0.5, Math.max(0.5, uvs[k * 2] * picture[0] - crop[0]));
        const py = Math.min(crop[3] - 0.5, Math.max(0.5, uvs[k * 2 + 1] * picture[1] - crop[1]));
        uvs[k * 2] = (place.x + px) / PAGE_SIZE;
        uvs[k * 2 + 1] = (place.y + py) / PAGE_SIZE;
      }
      const centre = new Vector3(...patch.origin).addScaledVector(new Vector3(...patch.u), patch.width / 2).addScaledVector(new Vector3(...patch.v), patch.height / 2);
      this.patches.push({ patch, centre, state: "idle", place, ...sized[i] });
    });
    for (let page = 0; page < packed.pages; page++) {
      const pagePositions = new Float32Array(corners[page] * 3);
      const pageUvs = new Float32Array(corners[page] * 2);
      let at = 0;
      list.forEach((patch, i) => {
        if (packed.placements[i].page !== page) return;
        pagePositions.set(positions.subarray(patch.start * 3, (patch.start + patch.count) * 3), at * 3);
        pageUvs.set(uvs.subarray(patch.start * 2, (patch.start + patch.count) * 2), at * 2);
        at += patch.count;
      });
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(pagePositions, 3));
      geometry.setAttribute("uv", new BufferAttribute(pageUvs, 2));
      geometry.computeBoundingSphere();
      // The page, made and written here rather than by three.js: a patch's picture goes up alone, not the whole page again.
      const raw = gl.createTexture();
      this.renderer.state.bindTexture(gl.TEXTURE_2D, raw);
      gl.texStorage2D(gl.TEXTURE_2D, PAGE_LEVELS + 1, gl.RGBA8, PAGE_SIZE, PAGE_SIZE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.renderer.state.unbindTexture();
      const texture = new Texture();
      const properties = this.renderer.properties.get(texture) as { __webglTexture?: WebGLTexture; __webglInit?: boolean };
      properties.__webglTexture = raw;
      properties.__webglInit = true;
      const material = createPhotoMaterial(this.photo, "stand-in", texture);
      const mesh = new Mesh(geometry, material);
      this.addFill(mesh);
      this.pages.push({ raw, texture, material, mesh });
    }
    const all = new BufferGeometry();
    all.setAttribute("position", new BufferAttribute(positions, 3));
    this.panos?.addOccluder(all);
  }

  /**
   * Asks for the next patch's own texture, the nearest the eye first: a
   * picture of the mesh's surface in the patch's plane round the gap, as its
   * textures have it, whose missing part the worker fills with more of the
   * same surface (lib/scan-mesh/inpaint.ts). One at a time, and the picture
   * is read back from the GPU without holding the frame for it.
   */
  private askPatchPicture(): void {
    if (this.patchAsked !== -1 || !this.detailWorker || !this.detailGeometry || this.patches.length === 0) return;
    if (this.patchWait-- > 0) return;
    let next = -1;
    let near = PATCH_REACH * PATCH_REACH;
    const eye = this.camera.position;
    this.patches.forEach((p, i) => {
      if (p.state !== "idle") return;
      const d = p.centre.distanceToSquared(eye);
      if (d < near) {
        near = d;
        next = i;
      }
    });
    if (next === -1) return;
    const { patch, scale, picture, crop: part } = this.patches[next];
    const [width, height] = picture;
    if (!this.patchMesh) {
      this.patchMesh = new Mesh(this.detailGeometry, this.groupMaterials);
      this.patchMesh.frustumCulled = false;
      this.patchScene.add(this.patchMesh);
    }
    this.patchAsked = next;
    this.patchWait = PATCH_EVERY;
    this.patches[next].state = "asked";
    const side = patch.donor ? Math.max(8, Math.round(patch.donor.size / scale)) : 0;
    // Nothing seen of its own plane beside it: a well-seen square of another goes beside the picture, to be carried on from.
    const donor = patch.donor;
    const pictures = Promise.all([
      this.patchPicture(patch.origin, patch.u, patch.v, patch.width, patch.height, width, height),
      donor ? this.patchPicture(donor.origin, donor.u, donor.v, donor.size, donor.size, side, side) : null,
    ]);
    void pictures
      .then(([own, beside]) => {
        if (this.disposed || !this.detailWorker) return;
        let pixels = own;
        let total: [number, number] = [width, height];
        let crop: [number, number, number, number] = [...part];
        if (beside) {
          total = [side + width, Math.max(side, height)];
          crop = [side + part[0], part[1], part[2], part[3]];
          pixels = new Uint8Array(total[0] * total[1] * 4);
          for (let y = 0; y < side; y++) pixels.set(beside.subarray(y * side * 4, (y + 1) * side * 4), y * total[0] * 4);
          for (let y = 0; y < height; y++) pixels.set(own.subarray(y * width * 4, (y + 1) * width * 4), (y * total[0] + side) * 4);
        }
        this.detailWorker.postMessage({ kind: "inpaint", id: next, width: total[0], height: total[1], pixels, crop } satisfies DetailRequest, [pixels.buffer]);
      })
      .catch(() => {
        // The GPU would not give the picture back: the patch stays as the panoramas and the fill paint it.
        this.patches[next].state = "none";
        if (this.patchAsked === next) this.patchAsked = -1;
      });
  }

  /**
   * The detailed mesh as it is painted now, looking square at a plane: the
   * rectangle from `origin` along `u` and `v`, `width` by `height` pixels,
   * and a thin slab of the scene either side of the plane. Alpha 0 where the
   * mesh has nothing there. Painted as the eye sees it, from the panoramas
   * in use where they saw the surface: a patch's texture is then made from
   * the same sharp picture that will lie beside it.
   */
  private async patchPicture(origin: Vec3, uAxis: Vec3, vAxis: Vec3, across: number, up: number, width: number, height: number): Promise<Uint8Array> {
    const u = new Vector3(...uAxis);
    const v = new Vector3(...vAxis);
    const w = new Vector3().crossVectors(u, v);
    const camera = this.patchCamera;
    camera.right = across;
    camera.top = up;
    camera.near = 1 - PATCH_SLAB;
    camera.far = 1 + PATCH_SLAB;
    camera.updateProjectionMatrix();
    camera.matrixAutoUpdate = false;
    camera.matrix.makeBasis(u, v, w).setPosition(new Vector3(...origin).add(w));
    camera.matrixWorld.copy(camera.matrix);
    camera.matrixWorldInverse.copy(camera.matrix).invert();
    camera.matrixWorldAutoUpdate = false;

    const target = new WebGLRenderTarget(width, height);
    const pixels = new Uint8Array(width * height * 4);
    const before = this.renderer.getRenderTarget();
    const clear = this.renderer.getClearColor(new Color());
    const alpha = this.renderer.getClearAlpha();
    const standing = [...(this.photo.uPanoOn.value as number[])];
    try {
      // What each panorama really saw, by its depth: standing on one does not make it see round corners here.
      (this.photo.uPanoOn.value as number[]).fill(0);
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(clear, 0);
      this.renderer.clear();
      this.renderer.render(this.patchScene, camera);
    } finally {
      standing.forEach((on, slot) => ((this.photo.uPanoOn.value as number[])[slot] = on));
      this.renderer.setClearColor(clear, alpha);
      this.renderer.setRenderTarget(before);
    }
    try {
      // Read back when the GPU has it ready, a frame or two on: reading at once would hold this frame for it.
      const read = this.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, pixels);
      // three.js leaves its pack buffer bound while it waits, and any plain read in the meantime would fail.
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      await read;
    } finally {
      target.dispose();
    }
    return pixels;
  }

  /** A patch's own texture, written to its place on its page. */
  private usePatchPicture(id: number, pixels: Uint8ClampedArray | null): void {
    const entry = this.patches[id];
    if (this.patchAsked === id) this.patchAsked = -1;
    if (!entry) return;
    const page = this.pages[entry.place.page];
    if (!pixels || !page || pixels.length !== entry.crop[2] * entry.crop[3] * 4) {
      entry.state = "none";
      return;
    }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.renderer.state.bindTexture(gl.TEXTURE_2D, page.raw);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, entry.place.x, entry.place.y, entry.crop[2], entry.crop[3], gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels.buffer));
    gl.generateMipmap(gl.TEXTURE_2D);
    this.renderer.state.unbindTexture();
    entry.state = "done";
    const repair = this.state.detail.repair;
    if (repair) repair.synthesized++;
  }

  /** Whether the repair is in and every patch that gets a texture of its own has it. */
  repairReady(): boolean {
    const repair = this.state.detail.repair;
    if (this.state.detail.state !== "ready" || !repair) return true;
    const eye = this.camera.position;
    if (this.groups.length === 0) return repair.stats !== null;
    return repair.stats !== null && this.patches.every((p) => p.state === "done" || p.state === "none" || p.centre.distanceTo(eye) > PATCH_REACH);
  }

  /**
   * Whether the picture is whole: every texture in and on the GPU, every
   * panorama's small cube and depth made from the latest mesh, and full-size
   * cubes for the panoramas in use.
   */
  imagingReady(): boolean {
    const textures = this.state.detail.textures;
    if (this.state.detail.state === "loading" || (textures && (!textures.done || this.arrived.length > 0))) return false;
    const counts = this.panos?.counts();
    if (!this.panos || !counts) return true;
    return counts.low + counts.failed >= counts.total && this.panos.depthsCurrent && counts.sharpLoading === 0 && counts.sharp >= Math.min(this.sphereView || this.photoView ? 1 : SLOTS, counts.total - counts.failed);
  }

  /**
   * What paints the current view (`ViewSources`), from a small copy rendered
   * in the photo materials' source colours (photo-material.ts): red the
   * panoramas' part, green a texture's, blue a stand-in, alpha 0 nothing.
   */
  measureSources(): ViewSources {
    const target = new WebGLRenderTarget(SOURCE_WIDTH, SOURCE_HEIGHT);
    const pixels = new Uint8Array(SOURCE_WIDTH * SOURCE_HEIGHT * 4);
    const before = this.renderer.getRenderTarget();
    const clear = this.renderer.getClearColor(new Color());
    const alpha = this.renderer.getClearAlpha();
    const backdrop = this.backdrop.visible;
    try {
      this.backdrop.visible = false;
      this.photo.uDebug.value = 3;
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(clear, 0);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.readRenderTargetPixels(target, 0, 0, SOURCE_WIDTH, SOURCE_HEIGHT, pixels);
    } finally {
      this.photo.uDebug.value = 0;
      this.backdrop.visible = backdrop;
      this.renderer.setClearColor(clear, alpha);
      this.renderer.setRenderTarget(before);
      target.dispose();
    }
    const out: ViewSources = { void: 0, pano: 0, texture: 0, synth: 0, smear: 0, standin: 0 };
    const count = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) {
        out.void += 1 / count;
        continue;
      }
      const pano = pixels[i] / 255;
      const own = pixels[i + 1] / 255;
      out.pano += pano / count;
      if (pixels[i + 2] >= 128) {
        out.standin += 1 / count;
        out.synth += own / count;
        out.smear += Math.max(0, 1 - pano - own) / count;
      } else out.texture += (1 - pano) / count;
    }
    return out;
  }

  /** Once every panorama has its small cube, compare neighbours' colours and even out their exposures. */
  private startExposure(): void {
    const panos = this.panos;
    const world = this.meshWorld;
    if (this.exposureStarted || !panos || !world) return;
    const counts = panos.counts();
    if (counts.total === 0 || counts.low < counts.total) return;
    this.exposureStarted = true;
    void matchExposure(panos.exposureSources(), world, this.abort.signal).then(({ gains, pairs, before, after }) => {
      if (this.disposed || gains.size === 0) return;
      panos.setGains(gains);
      const all = [...gains.values()].flat();
      this.state.exposure = { pairs, low: Math.min(...all), high: Math.max(...all), on: panos.useGains, before, after };
      this.push();
    });
  }

  /** The bounding-volume tree over the walkable mesh, for the debug recorder's rays. */
  get meshTree(): MeshWorld | null {
    return this.meshWorld;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.panos?.dispose();
    if (this.wire) (this.wire.material as MeshBasicMaterial).dispose();
    this.geometry?.dispose();
    this.detailGeometry?.dispose();
    this.detailWorker?.terminate();
    for (const item of this.arrived) item.image.close();
    for (const texture of [...this.small, ...this.sharp]) texture?.dispose();
    for (const material of this.groupMaterials) if (material !== this.material) material.dispose();
    for (const mesh of this.fillMeshes) mesh.geometry.dispose();
    if (this.spheres.length > 0) this.spheres[0].geometry.dispose();
    for (const mesh of this.spheres) (mesh.material as ShaderMaterial).dispose();
    if (this.photoMeshes.length > 0) this.photoMeshes[0].geometry.dispose();
    for (const mesh of this.photoMeshes) (mesh.material as ShaderMaterial).dispose();
    this.fadeTarget?.dispose();
    this.fadeMaterial.dispose();
    for (const page of this.pages) {
      this.renderer.properties.remove(page.texture);
      this.renderer.getContext().deleteTexture(page.raw);
      page.material.dispose();
    }
    this.fillMaterial.dispose();
    this.fanMaterial.dispose();
    this.fill?.dispose();
    this.material.dispose();
    this.backdropMaterial.dispose();
    this.backdrop.geometry.dispose();
    this.blank.dispose();
    this.renderer.dispose();
  }
}
