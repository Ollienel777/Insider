// The set's joinery (issue 118): what makes a doorway read as a door and a
// pane read as glass, over the photographs (scan-photo.ts). Every doorway of
// the plan gets a dark frame, jambs and head; one the game has no door in
// gets its leaf swung open against the wall beside it (a door the game can
// lock is the actors' to draw, shut or open). Every pane of glass gets a
// dark metal frame, sill, head and mullions, a faint tint and a sheen.
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Material,
} from "three";
import type { Vec } from "./ground";
import { onPlanFloor, PLAN, type ScanPlan } from "./scan-plan";
import { FP } from "./tuning";

/** A colour given as the screen shows it (sRGB), not in three's working space. */
const srgb = (r: number, g: number, b: number) => new Color().setRGB(r, g, b, SRGBColorSpace);

/** The joinery's colours: a door's warm wood, and dark metal for frames. */
export const DRESS = Object.freeze({
  wood: srgb(0.478, 0.306, 0.18),
  metal: srgb(0.137, 0.137, 0.145),
  glass: srgb(0.737, 0.839, 0.89),
  /** A frame's face across the wall, and its depth beyond it. */
  frameM: 0.06,
  /** A glass wall's mullions are at most this far apart. */
  mullionM: 1.3,
  /** A door leaf's thickness. */
  leafM: 0.045,
  /** The widest leaf: a wider doorway gets a pair. */
  leafMaxM: 1.0,
  /** A doorway wider than this is an opening: frame only, no leaf. */
  openingM: 1.8,
});

/** A soft diagonal sheen, drawn once: what tells a pane of glass from a hole. */
function sheenTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, size, size);
    for (const [at, width, alpha] of [
      [0.25, 0.12, 0.5],
      [0.45, 0.05, 0.35],
      [0.75, 0.09, 0.4],
    ] as const) {
      const gradient = context.createLinearGradient(0, size, size, 0);
      gradient.addColorStop(Math.max(0, at - width), "rgba(255,255,255,0)");
      gradient.addColorStop(at, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(Math.min(1, at + width), "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }
  }
  const texture = new CanvasTexture(canvas);
  return texture;
}

/**
 * The joinery for `plan`. `gameDoors` are the centres of the doors the game
 * can shut (their leaves are the actors'): a doorway near one gets a frame
 * and no leaf of its own.
 */
export function buildDress(plan: ScanPlan, gameDoors: readonly Vec[]): Group {
  const group = new Group();
  group.name = "scan-dress";
  const own: (BufferGeometry | Material)[] = [];
  const keep = <T extends BufferGeometry | Material>(thing: T): T => {
    own.push(thing);
    return thing;
  };
  // Unlit, as the photographs are: the scene's lights are the fixture floors' night, not this building's day.
  const metal = keep(new MeshBasicMaterial({ color: DRESS.metal }));
  const wood = keep(new MeshBasicMaterial({ color: DRESS.wood }));
  const handle = keep(new MeshBasicMaterial({ color: srgb(0.784, 0.784, 0.761) }));
  const { floorY: y0, ceilingY: y1, floor } = plan;
  const doorTop = Math.min(y0 + FP.doorHeightM, y1 - 0.1);
  const thick = PLAN.thickM;
  const f = DRESS.frameM;

  /** A box from `a` to `b` on the floor plan, `across` deep, from height `bottom` to `top`. */
  const bar = (a: Vec, b: Vec, across: number, bottom: number, top: number, material: Material) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-3 || top - bottom < 1e-3) return null;
    const mesh = new Mesh(keep(new BoxGeometry(len, top - bottom, across)), material);
    mesh.position.set((a.x + b.x) / 2, (bottom + top) / 2, (a.y + b.y) / 2);
    mesh.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
    group.add(mesh);
    return mesh;
  };
  const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  for (const door of plan.doorways) {
    const len = Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y);
    if (len < 1e-3) continue;
    const d = { x: (door.b.x - door.a.x) / len, y: (door.b.y - door.a.y) / len };
    const head = door.width <= DRESS.openingM ? doorTop : y1;
    // Jambs inside each end of the opening, and the head across.
    bar(door.a, { x: door.a.x + d.x * f, y: door.a.y + d.y * f }, thick + 2 * f / 3, y0, head, metal);
    bar({ x: door.b.x - d.x * f, y: door.b.y - d.y * f }, door.b, thick + 2 * f / 3, y0, head, metal);
    if (head < y1) bar(door.a, door.b, thick + 2 * f / 3, head - f, head, metal);
    if (door.width > DRESS.openingM) continue;
    const centre = lerp(door.a, door.b, 0.5);
    if (door.shut) {
      // A door no one went through: shut, in the wall's line, with its handle on both faces.
      const from = { x: door.a.x + d.x * f, y: door.a.y + d.y * f };
      const to = { x: door.b.x - d.x * f, y: door.b.y - d.y * f };
      const leaves = door.width - 2 * f > DRESS.leafMaxM * 1.2 ? 2 : 1;
      for (let k = 0; k < leaves; k++) {
        const a = lerp(from, to, k / leaves);
        const b = lerp(from, to, (k + 1) / leaves);
        bar(a, b, DRESS.leafM, y0 + 0.01, doorTop - 0.02, wood);
        const grip = lerp(a, b, k === 0 ? 0.88 : 0.12);
        bar({ x: grip.x - d.x * 0.03, y: grip.y - d.y * 0.03 }, { x: grip.x + d.x * 0.03, y: grip.y + d.y * 0.03 }, DRESS.leafM + 0.12, y0 + 1.0, y0 + 1.05, handle);
      }
      continue;
    }
    if (gameDoors.some((g) => Math.hypot(g.x - centre.x, g.y - centre.y) < Math.max(0.8, door.width / 2 + 0.3))) continue;
    // Not one of the game's doors: its leaf (or pair) stands open, swung back against the wall, into the side with floor.
    const n = { x: -d.y, y: d.x };
    const side = onPlanFloor(floor, centre.x + n.x * 0.6, centre.y + n.y * 0.6) ? 1 : -1;
    const leaves = door.width - 2 * f > DRESS.leafMaxM * 1.2 ? 2 : 1;
    const leafW = (door.width - 2 * f) / leaves;
    for (let k = 0; k < leaves; k++) {
      const hinge = k === 0 ? { x: door.a.x + d.x * f, y: door.a.y + d.y * f } : { x: door.b.x - d.x * f, y: door.b.y - d.y * f };
      const out = { x: n.x * side, y: n.y * side };
      const off = thick / 2 + DRESS.leafM / 2;
      const from = { x: hinge.x + out.x * off, y: hinge.y + out.y * off };
      const to = { x: from.x + out.x * leafW, y: from.y + out.y * leafW };
      bar(from, to, DRESS.leafM, y0 + 0.01, doorTop - 0.02, wood);
      // A handle near the far edge, both faces.
      const grip = lerp(from, to, 0.88);
      const across = { x: k === 0 ? d.x : -d.x, y: k === 0 ? d.y : -d.y };
      bar(
        { x: grip.x - across.x * 0.06, y: grip.y - across.y * 0.06 },
        { x: grip.x + across.x * 0.06, y: grip.y + across.y * 0.06 },
        0.12,
        y0 + 1.0,
        y0 + 1.04,
        handle,
      );
    }
  }

  // Glass: a faint tinted pane with a sheen, framed in dark metal: sill, head and mullions.
  const sheen = keep(new MeshBasicMaterial({ map: sheenTexture(), transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }));
  const tint = keep(new MeshBasicMaterial({ color: DRESS.glass, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide }));
  for (const pane of plan.glass) {
    const len = Math.hypot(pane.b.x - pane.a.x, pane.b.y - pane.a.y);
    if (len < 1e-3) continue;
    const sill = y0 + 0.08;
    const top = y1 - 0.08;
    bar(pane.a, pane.b, 0.08, y0, sill, metal);
    bar(pane.a, pane.b, 0.08, top, y1, metal);
    const spans = Math.max(1, Math.ceil(len / DRESS.mullionM));
    for (let k = 0; k <= spans; k++) {
      const at = lerp(pane.a, pane.b, k / spans);
      const d = { x: (pane.b.x - pane.a.x) / len, y: (pane.b.y - pane.a.y) / len };
      bar({ x: at.x - d.x * 0.03, y: at.y - d.y * 0.03 }, { x: at.x + d.x * 0.03, y: at.y + d.y * 0.03 }, 0.08, sill, top, metal);
    }
    for (const material of [tint, sheen]) {
      const plane = new Mesh(keep(new PlaneGeometry(len, top - sill)), material);
      plane.position.set((pane.a.x + pane.b.x) / 2, (sill + top) / 2, (pane.a.y + pane.b.y) / 2);
      plane.rotation.y = -Math.atan2(pane.b.y - pane.a.y, pane.b.x - pane.a.x);
      plane.renderOrder = 2;
      group.add(plane);
    }
  }
  group.userData.own = own;
  return group;
}
