// The fixture floor drawn in three dimensions (issue 115), from the same
// `World` the player collides with (world.ts): a floor and a ceiling for each
// room, a wall for each wall face, a frame around each doorway. Static: the
// doors that open and everything that moves are the actors' (actors.ts). The
// floor plan's x is three's x and its y is three's z; up is y.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PointLight,
} from "three";
import type { Palette } from "./palette";
import { FP } from "./tuning";
import type { World } from "./world";

/** How a room is lit: an occupied room is lit, a quiet one dark, the rest in between. */
export type RoomTone = "lit" | "plain" | "dark";

/** Flat faces gathered into one mesh, each vertex with its own colour. */
export class Faces {
  private positions: number[] = [];
  private normals: number[] = [];
  private colours: number[] = [];

  /** A four-cornered face, corners in order round its edge. `a` and `b` take `low`, `c` and `d` take `high`. */
  quad(corners: [number, number, number][], normal: [number, number, number], low: Color, high: Color = low): void {
    const [a, b, c, d] = corners;
    for (const [corner, colour] of [[a, low], [b, low], [c, high], [a, low], [c, high], [d, high]] as const) {
      this.positions.push(...corner);
      this.normals.push(...normal);
      this.colours.push(colour.r, colour.g, colour.b);
    }
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(this.colours, 3));
    return geometry;
  }
}

export function lines(points: number[], colour: Color, opacity: number): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return new LineSegments(geometry, new LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity }));
}

/**
 * The floor's static geometry as one group: floors, walls, ceilings, door
 * frames and the ceiling lights of the lit rooms. `tone` says how each room
 * is lit. Everything in the group is owned by it: `disposeGroup` frees it.
 */
export function buildFloorGroup(world: World, palette: Palette, tone: (roomId: string) => RoomTone): Group {
  const group = new Group();
  group.name = "floor";
  const H = FP.wallHeightM;
  const doorH = FP.doorHeightM;

  const shade = (colour: Color, by: number) => colour.clone().multiplyScalar(by);
  const LIGHT: Record<RoomTone, number> = { lit: 1.45, plain: 1, dark: 0.72 };

  const faces = new Faces();
  const seams: number[] = [];
  const grid: number[] = [];
  const edges: number[] = [];
  const panels = new Faces();

  for (const room of world.rooms) {
    const { x, y, w, h } = room.inner;
    const k = LIGHT[tone(room.id)];
    const floor = shade(palette.n700, k * 0.9);
    const ceiling = shade(palette.n850, k);
    faces.quad([[x, 0, y], [x + w, 0, y], [x + w, 0, y + h], [x, 0, y + h]], [0, 1, 0], floor);
    faces.quad([[x, H, y], [x + w, H, y], [x + w, H, y + h], [x, H, y + h]], [0, -1, 0], ceiling);
    // The plan's own grid on the floor, one line a unit: something for the eye to move against.
    const unit = FP.unitM;
    for (let gx = Math.ceil(room.outer.x / unit - 1e-6) * unit; gx < x + w; gx += unit) {
      if (gx > x) grid.push(gx, 0.004, y, gx, 0.004, y + h);
    }
    for (let gy = Math.ceil(room.outer.y / unit - 1e-6) * unit; gy < y + h; gy += unit) {
      if (gy > y) grid.push(x, 0.004, gy, x + w, 0.004, gy);
    }
    if (tone(room.id) === "lit") {
      // Ceiling lights: strips every few metres, and one light for the room.
      const cols = Math.max(1, Math.round(w / 3.6));
      const rows = Math.max(1, Math.round(h / 3.6));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cx = x + ((c + 0.5) * w) / cols;
          const cy = y + ((r + 0.5) * h) / rows;
          panels.quad(
            [[cx - 0.6, H - 0.01, cy - 0.15], [cx + 0.6, H - 0.01, cy - 0.15], [cx + 0.6, H - 0.01, cy + 0.15], [cx - 0.6, H - 0.01, cy + 0.15]],
            [0, -1, 0],
            palette.n100,
          );
        }
      }
      const lamp = new PointLight(palette.n100, 14, Math.max(w, h) * 0.9 + 3, 1.6);
      lamp.position.set(x + w / 2, H - 0.4, y + h / 2);
      group.add(lamp);
    }
  }

  const wallFace = (a: { x: number; y: number }, b: { x: number; y: number }, n: { x: number; y: number }, k: number, top: number) => {
    const low = shade(palette.n700, k * 0.8);
    const high = shade(palette.n600, k);
    faces.quad([[a.x, 0, a.y], [b.x, 0, b.y], [b.x, top, b.y], [a.x, top, a.y]], [n.x, 0, n.y], low, high);
    // Where the wall meets the floor, and the ceiling.
    edges.push(a.x, 0.01, a.y, b.x, 0.01, b.y);
    if (top === H) edges.push(a.x, H - 0.01, a.y, b.x, H - 0.01, b.y);
  };

  const roomOfFace = (p: { x: number; y: number }, n: { x: number; y: number }) =>
    world.rooms.find((r) => {
      const q = { x: p.x + n.x * 0.05, y: p.y + n.y * 0.05 };
      return q.x >= r.inner.x && q.x <= r.inner.x + r.inner.w && q.y >= r.inner.y && q.y <= r.inner.y + r.inner.h;
    });

  for (const wall of world.walls) {
    const mid = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
    const k = LIGHT[tone(roomOfFace(mid, wall.n)?.id ?? "")] ?? 1;
    wallFace(wall.a, wall.b, wall.n, k, H);
    // A seam every four plan units, so a long wall reads as one being walked past.
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    const along = { x: (wall.b.x - wall.a.x) / length, y: (wall.b.y - wall.a.y) / length };
    const step = FP.unitM * 4;
    const start = along.x !== 0 ? wall.a.x : wall.a.y;
    for (let at = Math.ceil(start / step + 1e-6) * step; at < start + length - 1e-6; at += step) {
      const d = at - start;
      const px = wall.a.x + along.x * d + wall.n.x * 0.004;
      const py = wall.a.y + along.y * d + wall.n.y * 0.004;
      seams.push(px, 0, py, px, H, py);
    }
  }

  const frames = new Group();
  frames.name = "door-frames";
  const lintel = new MeshLambertMaterial({ color: palette.n700 });
  const trim: number[] = [];
  for (const opening of world.openings) {
    const isDoor = opening.doorId !== null;
    for (const jamb of opening.jambs) wallFace(jamb.a, jamb.b, jamb.n, 1, isDoor ? doorH : H);
    const p = opening.passage;
    // The doorway's floor and, for a door, the wall over it.
    faces.quad([[p.x, 0, p.y], [p.x + p.w, 0, p.y], [p.x + p.w, 0, p.y + p.h], [p.x, 0, p.y + p.h]], [0, 1, 0], palette.n800);
    if (!isDoor) {
      faces.quad([[p.x, H, p.y], [p.x + p.w, H, p.y], [p.x + p.w, H, p.y + p.h], [p.x, H, p.y + p.h]], [0, -1, 0], palette.n900);
      continue;
    }
    const over = new Mesh(new BoxGeometry(p.w, H - doorH, p.h), lintel);
    over.position.set(p.x + p.w / 2, (H + doorH) / 2, p.y + p.h / 2);
    frames.add(over);
    // The frame, on both faces of the wall: up one side, across, down the other.
    for (const jambEnd of ["a", "b"] as const) {
      const [j0, j1] = opening.jambs;
      const out = opening.axis === "x" ? { x: jambEnd === "a" ? -0.006 : 0.006, y: 0 } : { x: 0, y: jambEnd === "a" ? -0.006 : 0.006 };
      const l = { x: j0[jambEnd].x + out.x, y: j0[jambEnd].y + out.y };
      const r = { x: j1[jambEnd].x + out.x, y: j1[jambEnd].y + out.y };
      trim.push(l.x, 0, l.y, l.x, doorH, l.y, l.x, doorH, l.y, r.x, doorH, r.y, r.x, doorH, r.y, r.x, 0, r.y);
    }
  }
  group.add(frames);

  const solid = new Mesh(faces.geometry(), new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  solid.name = "rooms";
  group.add(solid);
  const glow = new Mesh(panels.geometry(), new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false }));
  glow.name = "ceiling-lights";
  group.add(glow);
  group.add(lines(grid, palette.n600, 0.35));
  group.add(lines(seams, palette.n500, 0.35));
  group.add(lines(edges, palette.n500, 0.9));
  group.add(lines(trim, palette.n300, 1));
  return group;
}

/** Frees every geometry and material under `group`. */
export function disposeGroup(group: Group): void {
  group.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
