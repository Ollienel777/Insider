// A guard as a person (issue 146): a low-poly figure built from boxes, with
// a walk cycle, that stands on its feet at its group's origin and faces +x.
// It knows nothing of the run or the floor: whoever places it moves the
// group and calls `step` with how far it went, so the same figure stands in
// the fixture floors' scene or a scan's (issue 118).
//
// Its right hand is held out in front, where a flashlight goes (`hand`).
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  type BufferGeometry,
  type Material,
} from "three";

export interface FigureColours {
  uniform: Color;
  trousers: Color;
  skin: Color;
  /** The cap; none for a cleaner. */
  cap?: Color;
}

/** Metres walked for one full stride (two steps). */
export const STRIDE_M = 1.4;
/** How far a leg swings either way at full stride, in radians. */
const LEG_SWING = 0.55;
const ARM_SWING = 0.45;
/** The flashlight arm, raised forward and a little down. */
const AIM_ARM = 1.3;

/** Phase and swing after walking `metres` at `speed` m/s, from `phase`. Pure, for the walk cycle. */
export function strideAfter(phase: number, metres: number, speedMps: number, still: boolean): { phase: number; swing: number } {
  if (still) return { phase: 0, swing: 0 };
  return { phase: (phase + (metres / STRIDE_M) * Math.PI * 2) % (Math.PI * 2), swing: Math.min(1, speedMps / 1.2) };
}

export class GuardFigure {
  readonly group = new Group();
  /** Where a flashlight goes: the right hand, pointing along the figure's +x. */
  readonly hand = new Object3D();
  private readonly legs: [Group, Group];
  private readonly arms: [Group, Group];
  private readonly meshes: Mesh[] = [];
  private readonly own: { geometries: BufferGeometry[]; materials: Material[] } = { geometries: [], materials: [] };
  private readonly normal = new Map<Mesh, Material>();
  private ghostMaterial: MeshBasicMaterial | null = null;
  private phase = 0;
  private swing = 0;
  private ghosted = false;
  private readonly armed: boolean;

  constructor(colours: FigureColours, opts: { armed?: boolean } = {}) {
    const armed = opts.armed ?? true;
    const mat = (c: Color) => this.keep(new MeshLambertMaterial({ color: c, flatShading: true }));
    const uniform = mat(colours.uniform);
    const trousers = mat(colours.trousers);
    const skin = mat(colours.skin);
    const box = (w: number, h: number, d: number) => this.keep(new BoxGeometry(w, h, d));
    const add = (parent: Object3D, geometry: BufferGeometry, material: Material, x: number, y: number, z: number) => {
      const mesh = new Mesh(geometry, material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };

    // Legs: pivots at the hips, swinging about z (forward is +x).
    const leg = box(0.17, 0.86, 0.17);
    const shoe = box(0.26, 0.08, 0.17);
    this.legs = [-1, 1].map((side) => {
      const hip = new Group();
      hip.position.set(0, 0.9, side * 0.11);
      add(hip, leg, trousers, 0, -0.43, 0);
      add(hip, shoe, trousers, 0.04, -0.86, 0);
      this.group.add(hip);
      return hip;
    }) as [Group, Group];

    add(this.group, box(0.26, 0.62, 0.44), uniform, 0, 1.22, 0);
    add(this.group, box(0.2, 0.1, 0.46), trousers, 0, 0.93, 0);
    add(this.group, box(0.24, 0.26, 0.22), skin, 0.01, 1.7, 0);
    if (colours.cap) {
      const cap = mat(colours.cap);
      add(this.group, this.keep(new CylinderGeometry(0.135, 0.14, 0.09, 7)), cap, 0, 1.86, 0);
      add(this.group, box(0.12, 0.025, 0.2), cap, 0.15, 1.82, 0);
    }

    // Arms: pivots at the shoulders. The right one (+z) holds the light out in front when armed.
    const arm = box(0.13, 0.6, 0.13);
    this.arms = [-1, 1].map((side) => {
      const shoulder = new Group();
      shoulder.position.set(0, 1.5, side * 0.29);
      add(shoulder, arm, uniform, 0, -0.29, 0);
      add(shoulder, box(0.11, 0.1, 0.11), skin, 0, -0.62, 0);
      this.group.add(shoulder);
      return shoulder;
    }) as [Group, Group];
    if (armed) {
      const right = this.arms[1];
      right.rotation.z = AIM_ARM;
      this.hand.position.set(0, -0.66, 0);
      // The hand points along the arm; the light points along the figure's forward, a little down.
      this.hand.rotation.z = -AIM_ARM - 0.18;
      right.add(this.hand);
    } else {
      this.group.add(this.hand);
    }
    this.armed = armed;
  }

  private keep<T extends BufferGeometry | Material>(thing: T): T {
    if ("isMaterial" in thing) this.own.materials.push(thing as Material);
    else this.own.geometries.push(thing as BufferGeometry);
    return thing;
  }

  /** Advances the walk cycle by `metres` walked at `speedMps`. Under reduced motion it stands still. */
  step(metres: number, speedMps: number, still: boolean): void {
    const next = strideAfter(this.phase, metres, speedMps, still);
    this.phase = next.phase;
    // Eases into and out of a stride rather than snapping.
    this.swing += (next.swing - this.swing) * 0.2;
    if (still) this.swing = 0;
    const s = Math.sin(this.phase) * this.swing;
    this.legs[0].rotation.z = s * LEG_SWING;
    this.legs[1].rotation.z = -s * LEG_SWING;
    this.arms[0].rotation.z = -s * ARM_SWING;
    if (!this.armed) this.arms[1].rotation.z = s * ARM_SWING;
  }

  /**
   * Drawn faintly through walls, or as itself. A guard heard but not seen
   * shows as an outline wherever it stands (issue 146).
   */
  setGhost(on: boolean, colour?: Color): void {
    if (on === this.ghosted) return;
    this.ghosted = on;
    if (on && !this.ghostMaterial) {
      this.ghostMaterial = new MeshBasicMaterial({ color: colour ?? new Color(0.8, 0.8, 0.8), transparent: true, opacity: 0.22, depthTest: false, depthWrite: false });
    }
    for (const mesh of this.meshes) {
      if (on) {
        this.normal.set(mesh, mesh.material as Material);
        mesh.material = this.ghostMaterial!;
        mesh.renderOrder = 5;
      } else {
        mesh.material = this.normal.get(mesh) ?? mesh.material;
        mesh.renderOrder = 0;
      }
    }
  }

  get ghost(): boolean {
    return this.ghosted;
  }

  dispose(): void {
    for (const g of this.own.geometries) g.dispose();
    for (const m of this.own.materials) m.dispose();
    this.ghostMaterial?.dispose();
    this.group.removeFromParent();
  }
}
