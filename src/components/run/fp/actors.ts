// Everything in the first-person scene that the run changes (issue 115):
// guards and night cleaners as pawns that glide from node to node, cameras on
// their mounts, what each of them sees drawn on the floor, the doors that
// shut and open, the rings on the nodes the player may move to, and the
// objective's and the exits' markers.
//
// The actors decide nothing. Every position is an engine node's, every lit
// disc a node the engine would see the player on this turn (sight.ts), every
// ring a move the engine would take (`choices`, board.ts). They stand on a
// `Ground` (ground.ts), not on the fixture floors' rectangles, so the same
// actors can stand on a scan's floor.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  type Material,
} from "three";
import type { RunState } from "@/engine";
import type { Ground, Vec } from "./ground";
import type { Palette } from "./palette";
import { CrossFade } from "./fade";
import { sightOf, watchedNodes } from "./sight";
import { FP } from "./tuning";

/** What the level fixes on the floor, placed by the view from the placed level. */
export interface Marks {
  objective: { nodeId: string; label: string };
  exits: readonly { nodeId: string; label: string }[];
  /** Each camera's mount and the middle of what it covers, in metres. */
  cameras: readonly { id: string; mount: Vec; looksAt: Vec }[];
}

/** A label the view draws over the scene, at a point in it. */
export interface ActorLabel {
  key: string;
  text: string;
  tone: "guard" | "cleaner" | "camera" | "objective" | "exit";
  /** Where it hangs, in the scene's coordinates. */
  x: number;
  y: number;
  z: number;
  /** Where it stands on the floor plan, for the view's line-of-sight test. */
  at: Vec;
  /** Shown through walls: a place to head for, not a piece to spot. */
  beacon: boolean;
}

/** Flat shapes just off the floor, gathered into one mesh. */
class Flat {
  private positions: number[] = [];

  disc(c: Vec, radius: number, y: number, segments = 28): void {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      this.positions.push(c.x, y, c.y, c.x + Math.cos(a0) * radius, y, c.y + Math.sin(a0) * radius, c.x + Math.cos(a1) * radius, y, c.y + Math.sin(a1) * radius);
    }
  }

  ring(c: Vec, inner: number, outer: number, y: number, segments = 40): void {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p = (r: number, a: number): [number, number, number] => [c.x + Math.cos(a) * r, y, c.y + Math.sin(a) * r];
      this.positions.push(...p(inner, a0), ...p(outer, a0), ...p(outer, a1), ...p(inner, a0), ...p(outer, a1), ...p(inner, a1));
    }
  }

  /** A strip from `a` to `b`, `width` wide. */
  beam(a: Vec, b: Vec, width: number, y: number): void {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) return;
    const nx = (-(b.y - a.y) / length) * (width / 2);
    const ny = ((b.x - a.x) / length) * (width / 2);
    this.positions.push(a.x + nx, y, a.y + ny, b.x + nx, y, b.y + ny, b.x - nx, y, b.y - ny, a.x + nx, y, a.y + ny, b.x - nx, y, b.y - ny, a.x - nx, y, a.y - ny);
  }

  /** What it holds, as a string: the same shapes give the same key. */
  key(): string {
    return this.positions.map((p) => p.toFixed(3)).join(",");
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    return geometry;
  }
}

const flatMaterial = (colour: Color, opacity: number) =>
  new MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, side: DoubleSide });

interface Pawn {
  group: Group;
  nodeId: string;
  at: Vec;
  glide: { path: Vec[]; length: number; from: number; ms: number; leg: number } | null;
}

/** A camera's aim, turning from where it looked to where it looks this turn. */
interface Aim {
  holder: Group;
  from: Quaternion;
  to: Quaternion;
  at: number;
  /** The light of its view, from the lens to what it watches on the floor this turn. */
  cone: Mesh;
}

/** The ring on a door's faces that fills as it is picked. */
interface PickRing {
  fill: Mesh[];
  /** The fill drawn now and the fill it is heading for, as fractions of a whole lock. */
  shown: number;
  target: number;
  /** The fill the ring's geometry was last built for. */
  drawn: number;
  visible: boolean;
}

interface Leaf {
  mesh: Group;
  shut: boolean;
  /** 0 shut, 1 slid fully into the wall. */
  open: number;
  along: Vec;
  width: number;
  centre: Vec;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Actors {
  readonly group = new Group();
  private readonly pawns = new Map<string, Pawn>();
  private readonly pawnKind = new Map<string, "guard" | "cleaner">();
  private readonly leaves = new Map<string, Leaf>();
  private readonly aims = new Map<string, Aim>();
  private readonly rings = new Map<string, PickRing>();
  private readonly areas = new Group();
  private areasBuilt = false;
  private areasNode: string | null = null;
  private readonly lenses = new Map<string, MeshBasicMaterial>();
  private readonly floor = new Group();
  /** The watched nodes' markings, cross-faded from one turn to the next. */
  private readonly floorFade: CrossFade;
  private floorKey: string | null = null;
  private readonly shared: { geometries: BufferGeometry[]; materials: Material[] } = { geometries: [], materials: [] };
  private readonly objective = new Group();
  private readonly exitMarks: { nodeId: string; material: MeshBasicMaterial }[] = [];
  private turn = -1;
  private turnAt = 0;
  private lastFrame = 0;

  private readonly pawnParts: { base: BufferGeometry; body: BufferGeometry; head: BufferGeometry; visor: BufferGeometry };
  private readonly pawnMaterial: Record<"guard" | "cleaner", MeshLambertMaterial>;
  private readonly visorMaterial: MeshLambertMaterial;
  private readonly sightMaterial: Record<"calm" | "after" | "tripped" | "next" | "camera", MeshBasicMaterial>;
  /** The cameras' view cones, and the colour of one that sees the player. */
  private readonly coneMaterial: MeshBasicMaterial;
  private readonly coneTripped: MeshBasicMaterial;
  private readonly ringFill: MeshBasicMaterial;

  constructor(
    private readonly ground: Ground,
    private readonly palette: Palette,
    private readonly marks: Marks,
    /** Under `prefers-reduced-motion`: pieces move at once, nothing spins. */
    private readonly still: boolean,
    /** A turn's length in milliseconds: a piece glides over the turns it takes to hop, so it never stops between hops. */
    private readonly turnMs: number,
    /** Turns per hop for a guard or cleaner (the engine's tempo). */
    private readonly tempo: (id: string) => number,
  ) {
    this.group.name = "actors";
    const keep = <T extends BufferGeometry | Material>(thing: T): T => {
      if (thing instanceof BufferGeometry) this.shared.geometries.push(thing);
      else this.shared.materials.push(thing);
      return thing;
    };
    // Abstract pawns, as on the board (DESIGN.md: no people are depicted).
    this.pawnParts = {
      base: keep(new CylinderGeometry(0.2, 0.27, 0.1, 20)),
      body: keep(new CylinderGeometry(0.09, 0.23, 1.15, 20)),
      head: keep(new SphereGeometry(0.17, 20, 14)),
      visor: keep(new BoxGeometry(0.06, 0.07, 0.2)),
    };
    this.pawnMaterial = {
      guard: keep(new MeshLambertMaterial({ color: palette.n200 })),
      cleaner: keep(new MeshLambertMaterial({ color: palette.n400 })),
    };
    this.visorMaterial = keep(new MeshLambertMaterial({ color: palette.n950 }));
    this.sightMaterial = {
      calm: keep(flatMaterial(palette.n300, 0.2)),
      after: keep(flatMaterial(palette.n300, 0.12)),
      tripped: keep(flatMaterial(palette.danger, 0.4)),
      // Where a sweeping camera looks next: an outline that firms up as its turn runs out (`update`).
      next: keep(flatMaterial(palette.warning, 0.1)),
      // What a camera watches this turn, in its own colour, so its floor reads apart from a guard's.
      camera: keep(flatMaterial(palette.warning, 0.3)),
    };
    this.coneMaterial = keep(new MeshBasicMaterial({ color: palette.warning, transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide }));
    this.coneTripped = keep(new MeshBasicMaterial({ color: palette.danger, transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide }));
    this.ringFill = keep(new MeshBasicMaterial({ color: palette.accent, side: DoubleSide }));
    this.group.add(this.floor);
    this.floorFade = new CrossFade(this.floor, turnMs, still);
    this.areas.visible = false;
    this.group.add(this.areas);
    this.buildDoors(keep);
    this.buildCameras(keep);
    this.buildMarks(keep);
  }

  private buildDoors(keep: <T extends BufferGeometry | Material>(thing: T) => T): void {
    const body = keep(new MeshLambertMaterial({ color: this.palette.n500 }));
    const plate = keep(new MeshLambertMaterial({ color: this.palette.n700 }));
    const bar = keep(new MeshLambertMaterial({ color: this.palette.n300 }));
    const lock = keep(new MeshBasicMaterial({ color: this.palette.danger }));
    for (const door of this.ground.doors) {
      const dx = door.bar.b.x - door.bar.a.x;
      const dy = door.bar.b.y - door.bar.a.y;
      const width = Math.hypot(dx, dy);
      const leaf = new Group();
      const panel = new Mesh(keep(new BoxGeometry(width, FP.doorHeightM, 0.06)), body);
      panel.position.y = FP.doorHeightM / 2;
      leaf.add(panel);
      // On both faces: a kick plate, a push bar, and the lock's light at hand height. A door
      // stood against is most of the view, so it has something on it to look at.
      for (const side of [-1, 1]) {
        const kick = new Mesh(keep(new BoxGeometry(width - 0.12, 0.28, 0.012)), plate);
        kick.position.set(0, 0.2, side * 0.034);
        const push = new Mesh(keep(new BoxGeometry(width - 0.3, 0.05, 0.05)), bar);
        push.position.set(0, 1.0, side * 0.055);
        const light = new Mesh(keep(new BoxGeometry(0.07, 0.12, 0.02)), lock);
        light.position.set(width / 2 - 0.1, 1.22, side * 0.04);
        leaf.add(kick, push, light);
      }
      // The pick's progress, on both faces at eye height: a dim track, and the fill over it.
      const track = keep(new RingGeometry(0.11, 0.15, 40));
      const trackMaterial = keep(new MeshBasicMaterial({ color: this.palette.n700, side: DoubleSide }));
      const fill: Mesh[] = [];
      for (const side of [-1, 1]) {
        const back = new Mesh(track, trackMaterial);
        back.position.set(0, 1.55, side * 0.036);
        back.visible = false;
        const front = new Mesh(new RingGeometry(0.11, 0.15, 40, 1, Math.PI / 2, 0.0001), this.ringFill);
        front.position.set(0, 1.55, side * 0.04);
        front.rotation.y = side < 0 ? Math.PI : 0;
        front.visible = false;
        back.name = "pick-track";
        leaf.add(back, front);
        fill.push(back, front);
      }
      this.rings.set(door.doorId, { fill, shown: 0, target: 0, drawn: -1, visible: false });
      leaf.rotation.y = -Math.atan2(dy, dx);
      leaf.position.set(door.centre.x, 0, door.centre.y);
      leaf.visible = false;
      this.group.add(leaf);
      this.leaves.set(door.doorId, { mesh: leaf, shut: false, open: 1, along: { x: dx / width, y: dy / width }, width, centre: door.centre });
    }
  }

  private buildCameras(keep: <T extends BufferGeometry | Material>(thing: T) => T): void {
    // Big enough to pick out from down a corridor, banded in the colour its floor is painted in.
    const body = keep(new MeshLambertMaterial({ color: this.palette.n200 }));
    const stripe = keep(new MeshBasicMaterial({ color: this.palette.warning }));
    const box = keep(new BoxGeometry(0.3, 0.22, 0.5));
    const band = keep(new BoxGeometry(0.31, 0.05, 0.3));
    const arm = keep(new CylinderGeometry(0.025, 0.025, 0.45, 8));
    const lensShape = keep(new SphereGeometry(0.085, 16, 12));
    // A unit cone, apex at the lens, opening along +z: scaled each turn to reach the floor it watches.
    const coneShape = keep(new ConeGeometry(1, 1, 28, 1, true));
    coneShape.rotateX(-Math.PI / 2);
    coneShape.translate(0, 0, 0.5);
    for (const camera of this.marks.cameras) {
      const to = { x: camera.looksAt.x - camera.mount.x, y: camera.looksAt.y - camera.mount.y };
      const length = Math.hypot(to.x, to.y) || 1;
      const holder = new Group();
      holder.position.set(camera.mount.x + (to.x / length) * 0.3, FP.wallHeightM - 0.45, camera.mount.y + (to.y / length) * 0.3);
      holder.add(new Mesh(box, body));
      const bandMesh = new Mesh(band, stripe);
      bandMesh.position.set(0, 0.06, -0.05);
      holder.add(bandMesh);
      const lensMaterial = keep(new MeshBasicMaterial({ color: this.palette.n800 }));
      const lens = new Mesh(lensShape, lensMaterial);
      lens.position.z = 0.27;
      holder.add(lens);
      const cone = new Mesh(coneShape, this.coneMaterial);
      cone.position.z = 0.27;
      cone.renderOrder = 2;
      holder.add(cone);
      holder.lookAt(camera.looksAt.x, 0.6, camera.looksAt.y);
      // The arm up to the ceiling it hangs from.
      const mast = new Mesh(arm, body);
      mast.position.set(holder.position.x, holder.position.y + 0.3, holder.position.z);
      this.group.add(mast);
      this.aims.set(camera.id, { holder, from: holder.quaternion.clone(), to: holder.quaternion.clone(), at: 0, cone });
      this.aimCone(camera.id, camera.looksAt, false);
      this.lenses.set(camera.id, lensMaterial);
      this.group.add(holder);
    }
  }

  /** Stretches a camera's cone to reach `at` on the floor, as wide there as a watched node's ground. */
  private aimCone(id: string, at: Vec, seesPlayer: boolean): void {
    const aim = this.aims.get(id);
    if (!aim) return;
    const { position } = aim.holder;
    const reach = Math.hypot(at.x - position.x, 0.02 - position.y, at.y - position.z) - 0.27;
    aim.cone.scale.set(FP.watchedM, FP.watchedM, Math.max(0.3, reach));
    aim.cone.material = seesPlayer ? this.coneTripped : this.coneMaterial;
  }

  private buildMarks(keep: <T extends BufferGeometry | Material>(thing: T) => T): void {
    const beamShape = keep(new CylinderGeometry(0.012, 0.012, FP.wallHeightM, 6));
    const at = this.ground.nodes.get(this.marks.objective.nodeId);
    if (at) {
      const gem = new Mesh(keep(new OctahedronGeometry(0.2)), keep(new MeshBasicMaterial({ color: this.palette.n100 })));
      gem.position.y = 1.15;
      gem.name = "gem";
      const beam = new Mesh(beamShape, keep(new MeshBasicMaterial({ color: this.palette.n100, transparent: true, opacity: 0.3 })));
      beam.position.y = FP.wallHeightM / 2;
      const ring = new Flat();
      ring.ring({ x: 0, y: 0 }, 0.3, 0.36, 0.02);
      this.objective.add(gem, beam, new Mesh(keep(ring.geometry()), keep(flatMaterial(this.palette.n100, 0.9))));
      this.objective.position.set(at.x, 0, at.y);
      this.group.add(this.objective);
    }
    for (const exit of this.marks.exits) {
      const node = this.ground.nodes.get(exit.nodeId);
      if (!node) continue;
      const material = keep(new MeshBasicMaterial({ color: this.palette.n400, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide }));
      const beam = new Mesh(beamShape, material);
      beam.position.set(node.x, FP.wallHeightM / 2, node.y);
      const ring = new Flat();
      ring.ring(node, 0.5, 0.58, 0.022);
      this.group.add(beam, new Mesh(keep(ring.geometry()), material));
      this.exitMarks.push({ nodeId: exit.nodeId, material });
    }
  }

  private pawn(id: string, kind: "guard" | "cleaner", nodeId: string): Pawn {
    const existing = this.pawns.get(id);
    if (existing) return existing;
    const at = this.ground.nodes.get(nodeId) ?? { x: 0, y: 0 };
    const group = new Group();
    const material = this.pawnMaterial[kind];
    const base = new Mesh(this.pawnParts.base, material);
    base.position.y = 0.05;
    const body = new Mesh(this.pawnParts.body, material);
    body.position.y = 0.1 + 1.15 / 2;
    const head = new Mesh(this.pawnParts.head, material);
    head.position.y = 1.38;
    // The way it faces: a dark band across the front of the head.
    const visor = new Mesh(this.pawnParts.visor, this.visorMaterial);
    visor.position.set(0.15, 1.4, 0);
    group.add(base, body, head, visor);
    group.position.set(at.x, 0, at.y);
    this.group.add(group);
    const pawn: Pawn = { group, nodeId, at: { x: at.x, y: at.y }, glide: null };
    this.pawns.set(id, pawn);
    this.pawnKind.set(id, kind);
    return pawn;
  }

  /** Reads a new run state: who stands where, what is seen, which doors are shut, where the player may go. */
  sync(run: RunState, now: number): void {
    const restarted = run.turn < this.turn;
    if (run.turn !== this.turn) this.turnAt = now;
    this.turn = run.turn;

    const walkers = [
      ...run.guards.map((g) => ({ ...g, kind: "guard" as const })),
      ...run.cleaners.map((c) => ({ ...c, kind: "cleaner" as const })),
    ];
    const present = new Set(walkers.map((w) => w.id));
    for (const [id, pawn] of this.pawns) pawn.group.visible = present.has(id);
    for (const walker of walkers) {
      const pawn = this.pawn(walker.id, walker.kind, walker.nodeId);
      const to = this.ground.nodes.get(walker.nodeId);
      // A hop takes as long as the turns between hops, so a patrol is one unbroken walk.
      const ms = this.still ? 0 : this.turnMs * Math.max(1, this.tempo(walker.id));
      if (to && walker.nodeId !== pawn.nodeId) {
        if (restarted || ms === 0) {
          pawn.at = { x: to.x, y: to.y };
          pawn.glide = null;
        } else {
          // From where it is now, on along what is left of its last hop, then along the engine's
          // edge through its door: never through a wall.
          const way = this.ground.path(pawn.nodeId, walker.nodeId);
          const rest = pawn.glide ? pawn.glide.path.slice(pawn.glide.leg) : [];
          const next = way.length > 1 ? way.slice(1) : [{ x: to.x, y: to.y }];
          const path = [{ ...pawn.at }, ...rest, ...next];
          let length = 0;
          for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
          pawn.glide = { path, length, from: now, ms, leg: 1 };
        }
        pawn.nodeId = walker.nodeId;
      }
      if (walker.facing && !pawn.glide) pawn.group.rotation.y = -Math.atan2(walker.facing.dy, walker.facing.dx);
      pawn.group.position.set(pawn.at.x, 0, pawn.at.y);
    }

    for (const [doorId, leaf] of this.leaves) {
      const shut = run.locked.includes(doorId);
      if (shut && !leaf.shut) leaf.open = 0;
      if (!shut && leaf.shut && this.still) leaf.open = 1;
      leaf.shut = shut;
    }

    this.drawFloor(run, now);
    if (this.areas.visible) this.drawAreas(run.playerNode);
    this.objective.visible = !run.carrying;
    const exitColour = run.carrying ? this.palette.success : this.palette.n400;
    for (const exit of this.exitMarks) {
      exit.material.color.copy(exitColour);
      exit.material.opacity = run.carrying ? 0.9 : 0.5;
    }
  }

  /** The floor's markings for this turn: what is watched. The cameras turn to face what they watch. */
  private drawFloor(run: RunState, now: number): void {
    const at = (id: string) => this.ground.nodes.get(id);
    const sight = sightOf(run, this.ground.unitM);
    const layers = { calm: new Flat(), after: new Flat(), tripped: new Flat(), next: new Flat(), camera: new Flat() };
    const cameraIds = new Set(sight.filter((s) => s.kind === "camera").map((s) => s.id));
    const mountOf = (id: string) => this.marks.cameras.find((c) => c.id === id)?.mount;

    // Every node the engine would see the player on this turn: a disc the size of the node's own ground,
    // in the cameras' colour where only cameras see it.
    for (const [nodeId, seen] of watchedNodes(sight)) {
      const node = at(nodeId);
      if (!node) continue;
      const layer = seen.tripped ? layers.tripped : seen.by.every((id) => cameraIds.has(id)) ? layers.camera : layers.calm;
      layer.disc(node, FP.watchedM, seen.tripped ? 0.016 : 0.012);
    }
    for (const s of sight) {
      const layer = s.tripped ? layers.tripped : s.kind === "camera" ? layers.camera : layers.calm;
      // A camera's lines start under the camera as this view hangs it.
      const origin = (s.kind === "camera" ? mountOf(s.id) : undefined) ?? s.origin;
      for (const id of s.nodes) {
        const node = at(id);
        if (node) layer.beam(origin, node, 0.1, 0.014);
      }
      for (const id of s.after?.nodes ?? []) {
        const node = at(id);
        if (node && s.after) layers.after.beam(s.after.origin, node, 0.1, 0.01);
      }
      for (const id of s.next) {
        const node = at(id);
        if (node) layers.next.ring(node, FP.watchedM - 0.1, FP.watchedM, 0.02);
      }
      const lens = this.lenses.get(s.id);
      if (lens) lens.color.copy(s.nodes.length > 0 ? this.palette.danger : this.palette.n800);
      const aim = this.aims.get(s.id);
      const seen = s.nodes.map(at).filter((n) => n !== undefined);
      if (aim && seen.length > 0) {
        const x = seen.reduce((sum, n) => sum + n.x, 0) / seen.length;
        const y = seen.reduce((sum, n) => sum + n.y, 0) / seen.length;
        const probe = new Object3D();
        probe.position.copy(aim.holder.position);
        probe.lookAt(x, 0.6, y);
        this.aimCone(s.id, { x, y }, s.tripped || s.nodes.includes(run.playerNode));
        if (!probe.quaternion.equals(aim.to)) {
          aim.from = aim.holder.quaternion.clone();
          aim.to = probe.quaternion.clone();
          aim.at = this.still ? -Infinity : now;
        }
      }
    }

    // In as the last turn's go out, over the turn. A new state that marks the same nodes (the Chief's
    // orders landing mid-turn) leaves the fade as it is.
    const entries = Object.entries(layers) as [keyof typeof layers, Flat][];
    const key = entries.map(([name, flat]) => `${name}:${flat.key()}`).join("|");
    if (key === this.floorKey) return;
    this.floorKey = key;
    const meshes = entries.map(([name, flat]) => {
      const mesh = new Mesh(flat.geometry(), this.sightMaterial[name]);
      mesh.renderOrder = 1;
      return { mesh, material: this.sightMaterial[name] };
    });
    this.floorFade.show(meshes, now);
  }

  /**
   * The progress ring on a door being picked (or held at): `done` of `of`
   * picks, null for none. It fills smoothly to each new pick over a turn.
   */
  showPick(pick: { doorId: string; done: number; of: number } | null): void {
    for (const [doorId, ring] of this.rings) {
      const on = pick?.doorId === doorId;
      ring.target = on ? pick.done / Math.max(1, pick.of) : 0;
      if (!on) ring.shown = 0;
      if (on !== ring.visible) {
        ring.visible = on;
        for (const mesh of ring.fill) mesh.visible = on;
      }
    }
  }

  /** Shows or hides the floor's areas, one per node (`Ground.regionOf`): a debug overlay. */
  showAreas(on: boolean, playerNode: string): void {
    this.areas.visible = on;
    if (on) this.drawAreas(playerNode);
  }

  /** The areas as a grid of tinted cells, the area the engine has the player in picked out in the accent. */
  private drawAreas(playerNode: string): void {
    if (this.areasBuilt && this.areasNode === playerNode) return;
    for (const child of [...this.areas.children]) {
      (child as Mesh).geometry.dispose();
      ((child as Mesh).material as Material).dispose();
      this.areas.remove(child);
    }
    const tints = [this.palette.n200, this.palette.n500, this.palette.success, this.palette.warning, this.palette.n400];
    const ids = [...this.ground.nodes.keys()];
    const flats = tints.map(() => new Flat());
    const mine = new Flat();
    const xs = [...this.ground.nodes.values()].map((n) => n.x);
    const ys = [...this.ground.nodes.values()].map((n) => n.y);
    const cell = 0.3;
    const [x0, x1, y0, y1] = [Math.min(...xs) - 12, Math.max(...xs) + 12, Math.min(...ys) - 12, Math.max(...ys) + 12];
    for (let x = x0; x < x1; x += cell) {
      for (let y = y0; y < y1; y += cell) {
        const c = { x: x + cell / 2, y: y + cell / 2 };
        const region = this.ground.regionOf(c);
        if (region === null) continue;
        const flat = region === playerNode ? mine : flats[ids.indexOf(region) % tints.length];
        flat.beam({ x: c.x - cell * 0.45, y: c.y }, { x: c.x + cell * 0.45, y: c.y }, cell * 0.9, 0.006);
      }
    }
    flats.forEach((flat, i) => this.areas.add(new Mesh(flat.geometry(), flatMaterial(tints[i], 0.16))));
    this.areas.add(new Mesh(mine.geometry(), flatMaterial(this.palette.accent, 0.28)));
    this.areasBuilt = true;
    this.areasNode = playerNode;
  }

  /** Advances the glides and the doors to `now`. */
  update(now: number): void {
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // Where a sweeping camera looks next firms up as the turn runs out: the sweep reads before it flips.
    this.sightMaterial.next.opacity = this.still ? 0.4 : 0.12 + 0.5 * clamp((now - this.turnAt) / this.turnMs, 0, 1);
    for (const pawn of this.pawns.values()) {
      const glide = pawn.glide;
      if (!glide) continue;
      const k = glide.ms <= 0 ? 1 : clamp((now - glide.from) / glide.ms, 0, 1);
      let left = k * glide.length;
      let at = glide.path[glide.path.length - 1];
      for (let i = 1; i < glide.path.length; i++) {
        const a = glide.path[i - 1];
        const b = glide.path[i];
        const leg = Math.hypot(b.x - a.x, b.y - a.y);
        if (left <= leg || i === glide.path.length - 1) {
          const f = leg === 0 ? 1 : clamp(left / leg, 0, 1);
          at = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
          glide.leg = i;
          if (leg > 1e-6) pawn.group.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
          break;
        }
        left -= leg;
      }
      pawn.at = at;
      pawn.group.position.set(at.x, 0, at.y);
      if (k >= 1) pawn.glide = null;
    }
    for (const leaf of this.leaves.values()) {
      // A picked door slides into the wall; a door the Chief locks is shut at once.
      if (!leaf.shut && leaf.open < 1) leaf.open = Math.min(1, leaf.open + dt / 0.45);
      leaf.mesh.visible = leaf.open < 1;
      leaf.mesh.position.set(leaf.centre.x + leaf.along.x * leaf.width * leaf.open, 0, leaf.centre.y + leaf.along.y * leaf.width * leaf.open);
    }
    this.floorFade.update(now);
    for (const aim of this.aims.values()) {
      const k = clamp((now - aim.at) / this.turnMs, 0, 1);
      aim.holder.quaternion.slerpQuaternions(aim.from, aim.to, 1 - (1 - k) * (1 - k));
    }
    for (const ring of this.rings.values()) {
      if (!ring.visible) continue;
      ring.shown = this.still ? ring.target : ring.shown + (ring.target - ring.shown) * Math.min(1, dt * 6);
      if (Math.abs(ring.shown - ring.drawn) < 0.002) continue;
      ring.drawn = ring.shown;
      for (const mesh of ring.fill) {
        if (mesh.name === "pick-track") continue;
        mesh.geometry.dispose();
        mesh.geometry = new RingGeometry(0.11, 0.15, 40, 1, Math.PI / 2, Math.max(0.0001, ring.shown * Math.PI * 2));
      }
    }
    if (!this.still) {
      const gem = this.objective.getObjectByName("gem");
      if (gem) {
        gem.rotation.y = now / 900;
        gem.position.y = 1.15 + Math.sin(now / 700) * 0.04;
      }
    }
  }

  /** Where every guard, cleaner and camera is now, and where the objective and the exits are. */
  labels(run: RunState): ActorLabel[] {
    const out: ActorLabel[] = [];
    for (const [id, pawn] of this.pawns) {
      if (!pawn.group.visible) continue;
      out.push({ key: `p:${id}`, text: id, tone: this.pawnKind.get(id) ?? "guard", x: pawn.at.x, y: 1.82, z: pawn.at.y, at: pawn.at, beacon: false });
    }
    for (const camera of this.marks.cameras) {
      out.push({ key: `c:${camera.id}`, text: `Camera ${camera.id}`, tone: "camera", x: camera.mount.x, y: FP.wallHeightM - 0.05, z: camera.mount.y, at: camera.mount, beacon: false });
    }
    const objective = this.ground.nodes.get(this.marks.objective.nodeId);
    if (objective && !run.carrying) {
      out.push({ key: "objective", text: this.marks.objective.label, tone: "objective", x: objective.x, y: 1.6, z: objective.y, at: objective, beacon: true });
    }
    for (const exit of this.marks.exits) {
      const node = this.ground.nodes.get(exit.nodeId);
      if (node) out.push({ key: `e:${exit.nodeId}`, text: exit.label, tone: "exit", x: node.x, y: 1.45, z: node.y, at: node, beacon: true });
    }
    return out;
  }

  dispose(): void {
    this.floorFade.dispose();
    for (const ring of this.rings.values()) for (const mesh of ring.fill) if (mesh.name !== "pick-track") mesh.geometry.dispose();
    for (const child of this.areas.children) {
      (child as Mesh).geometry.dispose();
      ((child as Mesh).material as Material).dispose();
    }
    for (const geometry of this.shared.geometries) geometry.dispose();
    for (const material of this.shared.materials) material.dispose();
    this.group.clear();
  }
}
