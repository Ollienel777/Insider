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
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type Material,
} from "three";
import type { RunState } from "@/engine";
import { choices } from "../board";
import type { Ground, Vec } from "./ground";
import type { Palette } from "./palette";
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
  glide: { path: Vec[]; length: number; from: number; ms: number } | null;
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
  private readonly lenses = new Map<string, MeshBasicMaterial>();
  private readonly floor = new Group();
  private readonly shared: { geometries: BufferGeometry[]; materials: Material[] } = { geometries: [], materials: [] };
  private readonly objective = new Group();
  private readonly exitMarks: { nodeId: string; material: MeshBasicMaterial }[] = [];
  private turn = -1;
  private turnAt = 0;
  private lastFrame = 0;

  private readonly pawnParts: { base: BufferGeometry; body: BufferGeometry; head: BufferGeometry; visor: BufferGeometry };
  private readonly pawnMaterial: Record<"guard" | "cleaner", MeshLambertMaterial>;
  private readonly visorMaterial: MeshLambertMaterial;
  private readonly sightMaterial: Record<"calm" | "after" | "tripped" | "next" | "move" | "here", MeshBasicMaterial>;

  constructor(
    private readonly ground: Ground,
    private readonly palette: Palette,
    private readonly marks: Marks,
    /** Under `prefers-reduced-motion`: pieces move at once, nothing spins. */
    private readonly still: boolean,
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
      next: keep(flatMaterial(palette.n400, 0.5)),
      move: keep(flatMaterial(palette.accent, 0.9)),
      here: keep(flatMaterial(palette.n400, 0.55)),
    };
    this.group.add(this.floor);
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
      leaf.rotation.y = -Math.atan2(dy, dx);
      leaf.position.set(door.centre.x, 0, door.centre.y);
      leaf.visible = false;
      this.group.add(leaf);
      this.leaves.set(door.doorId, { mesh: leaf, shut: false, open: 1, along: { x: dx / width, y: dy / width }, width, centre: door.centre });
    }
  }

  private buildCameras(keep: <T extends BufferGeometry | Material>(thing: T) => T): void {
    const body = keep(new MeshLambertMaterial({ color: this.palette.n300 }));
    const box = keep(new BoxGeometry(0.2, 0.16, 0.34));
    const lensShape = keep(new SphereGeometry(0.055, 14, 10));
    for (const camera of this.marks.cameras) {
      const to = { x: camera.looksAt.x - camera.mount.x, y: camera.looksAt.y - camera.mount.y };
      const length = Math.hypot(to.x, to.y) || 1;
      const holder = new Group();
      holder.position.set(camera.mount.x + (to.x / length) * 0.3, FP.wallHeightM - 0.45, camera.mount.y + (to.y / length) * 0.3);
      holder.add(new Mesh(box, body));
      const lensMaterial = keep(new MeshBasicMaterial({ color: this.palette.n800 }));
      const lens = new Mesh(lensShape, lensMaterial);
      lens.position.z = 0.18;
      holder.add(lens);
      holder.lookAt(camera.looksAt.x, 0.6, camera.looksAt.y);
      this.lenses.set(camera.id, lensMaterial);
      this.group.add(holder);
    }
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
    const newTurn = run.turn !== this.turn;
    const restarted = run.turn < this.turn;
    // A turn takes as long as the last one did when turns come steadily (the turn clock, a player
    // on the move); a turn after a pause glides at the default pace.
    const gap = now - this.turnAt;
    const ms = this.still ? 0 : gap < 1500 ? clamp(gap, 250, 1100) : FP.glideMs;
    if (newTurn) {
      this.turn = run.turn;
      this.turnAt = now;
    }

    const walkers = [
      ...run.guards.map((g) => ({ ...g, kind: "guard" as const })),
      ...run.cleaners.map((c) => ({ ...c, kind: "cleaner" as const })),
    ];
    const present = new Set(walkers.map((w) => w.id));
    for (const [id, pawn] of this.pawns) pawn.group.visible = present.has(id);
    for (const walker of walkers) {
      const pawn = this.pawn(walker.id, walker.kind, walker.nodeId);
      const to = this.ground.nodes.get(walker.nodeId);
      if (to && walker.nodeId !== pawn.nodeId) {
        if (restarted || ms === 0) {
          pawn.at = { x: to.x, y: to.y };
          pawn.glide = null;
        } else {
          // From where it is now (mid-glide or not), then along the engine's edge, through its door.
          const way = this.ground.path(pawn.nodeId, walker.nodeId);
          const path = pawn.glide ? [{ ...pawn.at }, { x: to.x, y: to.y }] : way.length > 1 ? way : [{ ...pawn.at }, { x: to.x, y: to.y }];
          let length = 0;
          for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
          pawn.glide = { path, length, from: now, ms };
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

    this.drawFloor(run);
    this.objective.visible = !run.carrying;
    const exitColour = run.carrying ? this.palette.success : this.palette.n400;
    for (const exit of this.exitMarks) {
      exit.material.color.copy(exitColour);
      exit.material.opacity = run.carrying ? 0.9 : 0.5;
    }
  }

  /** The floor's markings for this turn: what is watched, and where the player may move. */
  private drawFloor(run: RunState): void {
    for (const child of [...this.floor.children]) {
      (child as Mesh).geometry.dispose();
      this.floor.remove(child);
    }
    const at = (id: string) => this.ground.nodes.get(id);
    const sight = sightOf(run, this.ground.unitM);
    const layers = { calm: new Flat(), after: new Flat(), tripped: new Flat(), next: new Flat(), move: new Flat(), here: new Flat() };

    // Every node the engine would see the player on this turn: a disc the size of the node's own ground.
    for (const [nodeId, seen] of watchedNodes(sight)) {
      const node = at(nodeId);
      if (node) (seen.tripped ? layers.tripped : layers.calm).disc(node, FP.arriveM, seen.tripped ? 0.016 : 0.012);
    }
    for (const s of sight) {
      const layer = s.tripped ? layers.tripped : layers.calm;
      for (const id of s.nodes) {
        const node = at(id);
        if (node) layer.beam(s.origin, node, 0.1, 0.014);
      }
      for (const id of s.after?.nodes ?? []) {
        const node = at(id);
        if (node && s.after) layers.after.beam(s.after.origin, node, 0.1, 0.01);
      }
      for (const id of s.next) {
        const node = at(id);
        if (node) layers.next.ring(node, FP.arriveM - 0.04, FP.arriveM, 0.018);
      }
      const lens = this.lenses.get(s.id);
      if (lens) lens.color.copy(s.nodes.length > 0 ? this.palette.danger : this.palette.n800);
    }

    // Where the engine has the player, and the nodes it would let them move to.
    const here = at(run.playerNode);
    if (here && run.status === "playing") layers.here.ring(here, 0.16, 0.2, 0.02);
    for (const choice of choices(run)) {
      const node = at(choice.nodeId);
      if (!node || choice.kind !== "move") continue;
      layers.move.ring(node, FP.arriveM - 0.07, FP.arriveM, 0.024);
      layers.move.disc(node, 0.07, 0.024, 12);
    }

    for (const [name, flat] of Object.entries(layers) as [keyof typeof layers, Flat][]) {
      const mesh = new Mesh(flat.geometry(), this.sightMaterial[name]);
      mesh.renderOrder = name === "move" || name === "here" ? 2 : 1;
      this.floor.add(mesh);
    }
  }

  /** Advances the glides and the doors to `now`. */
  update(now: number): void {
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
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
      out.push({ key: `c:${camera.id}`, text: camera.id, tone: "camera", x: camera.mount.x, y: FP.wallHeightM - 0.12, z: camera.mount.y, at: camera.looksAt, beacon: false });
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
    for (const child of this.floor.children) (child as Mesh).geometry.dispose();
    for (const geometry of this.shared.geometries) geometry.dispose();
    for (const material of this.shared.materials) material.dispose();
    this.group.clear();
  }
}
