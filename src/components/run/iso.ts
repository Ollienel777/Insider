// The board's isometric projection (DESIGN.md, the hero screen): a fixed
// camera looking down the floor's diagonal, so rooms read as low tiles and
// pieces stand up out of them. Floor units (the FloorGraph's x, y) map to
// board units, which are CSS pixels when the board is drawn at its design
// size; the SVG then scales the whole thing to the visual area.
import type { FloorGraph } from "@/domain";

/** Board units per floor unit. */
export const SCALE = 12;
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

/** The depth of a room tile's front faces, in board units. */
export const TILE_DEPTH = 6;
/** Space kept around the floor: pieces stand up to this far above their node. */
const PAD = { top: 64, right: 32, bottom: 32, left: 32 };

export interface Point {
  x: number;
  y: number;
}

/** A floor point on the board. */
export function project(x: number, y: number): Point {
  return { x: (x - y) * COS * SCALE, y: (x + y) * SIN * SCALE };
}

/** The four corners of a floor rectangle on the board: back, right, front, left. */
export function projectRect(rect: { x: number; y: number; w: number; h: number }): [Point, Point, Point, Point] {
  return [
    project(rect.x, rect.y),
    project(rect.x + rect.w, rect.y),
    project(rect.x + rect.w, rect.y + rect.h),
    project(rect.x, rect.y + rect.h),
  ];
}

export interface Frame {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** The board's viewBox: every room and node, with room for the pieces. */
export function frameOf(floor: FloorGraph): Frame {
  const points = [
    ...floor.rooms.flatMap((r) => projectRect(r.rect)),
    ...floor.nodes.map((n) => project(n.x, n.y)),
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - PAD.left;
  const minY = Math.min(...ys) - PAD.top;
  return {
    minX,
    minY,
    width: Math.max(...xs) + PAD.right - minX,
    height: Math.max(...ys) + TILE_DEPTH + PAD.bottom - minY,
  };
}

/** `points` as an SVG points attribute. */
export function pointsAttr(points: readonly Point[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

export const round = (n: number) => Math.round(n * 10) / 10;

/** The font size room labels are set in, in their own text units. */
export const LABEL_FONT = 11;

/**
 * Where a room's label lies: flat on the floor along the room's longer back
 * edge (the north edge, or the west one for a tall room), just inside it,
 * shrunk to fit the edge. Returns an SVG `matrix(...)` that maps text units
 * onto the board, so the label reads as painted on the tile.
 */
export function roomLabelTransform(rect: { x: number; y: number; w: number; h: number }, chars: number): string {
  return matrixAttr(roomLabelMatrix(rect, chars));
}

/**
 * Where on its tile a room label lies (`roomLabelMatrix`): along the back
 * edge (as `roomLabelTransform` puts it) or the front one, `shift` floor
 * units along that edge, at `scale` times its largest size.
 */
export interface LabelSlot {
  side: "back" | "front";
  shift: number;
  scale: number;
}

/** A 2D affine matrix, as SVG's `matrix(a b c d e f)`. */
export type Matrix = readonly [number, number, number, number, number, number];

/** How much of its edge a room label can run along, and its largest size there, in floor units per em. */
export function roomLabelFit(rect: { w: number; h: number }, chars: number): { edge: number; em: number } {
  const edge = Math.max(rect.w, rect.h);
  // At most 1.1, so the label fits the edge with 0.3 to spare at each end.
  return { edge, em: Math.min(1.1, (edge - 0.6) / Math.max(1, chars * 0.66)) };
}

/** The matrix that maps a room label's text units onto the board, so it reads as painted on the tile. */
export function roomLabelMatrix(
  rect: { x: number; y: number; w: number; h: number },
  chars: number,
  slot: LabelSlot = { side: "back", shift: 0, scale: 1 },
): Matrix {
  const alongX = rect.w >= rect.h;
  const em = roomLabelFit(rect, chars).em * slot.scale;
  const k = SCALE * (em / LABEL_FONT);
  // On the back edge the baseline sits a cap height in from it; on the front edge, just in from it.
  const inset = slot.side === "back" ? 0.3 + em * 0.75 : 0.3;
  const s = slot.shift;
  // Text runs along u and its baseline's "down" is v, both floor directions.
  const [u, v, at] = alongX
    ? [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: rect.x + 0.3 + s, y: slot.side === "back" ? rect.y + inset : rect.y + rect.h - inset },
      ]
    : [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: slot.side === "back" ? rect.x + inset : rect.x + rect.w - inset, y: rect.y + rect.h - 0.3 - s },
      ];
  const screen = (d: { x: number; y: number }) => ({ x: (d.x - d.y) * COS * k, y: (d.x + d.y) * SIN * k });
  const a = screen(u);
  const c = screen(v);
  const o = project(at.x, at.y);
  return [a.x, a.y, c.x, c.y, o.x, o.y];
}

/** `m` as an SVG transform attribute. */
export function matrixAttr(m: Matrix): string {
  return `matrix(${m.map((n) => Math.round(n * 1000) / 1000).join(" ")})`;
}

/** The convex hull of `points` (Andrew's monotone chain), counter-clockwise. */
export function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
