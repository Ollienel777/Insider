// Where the board's labels go, so that none covers another (#68): the room
// names painted on the tiles, the guards' ids, and the plan's marks. Every
// label is a box in board units, and two boxes that intersect are a collision.
//
// The room names are placed once per floor, clear of everything that never
// moves: the nodes (a numbered choice can stand on any of them), the entry and
// files labels, the cameras, and the PICK label beside a door. The labels that
// move with the run (a guard's id, a plan mark) then take the first of a few
// spots around their piece that is clear of all of those and of each other.
//
// What a label must keep clear of comes in two kinds. Another label's glyphs
// (`Taken.text`) it never covers. The board's marks (`Taken.marks`: a node's
// disc and choice ring, a pawn's body, a camera's housing) it avoids: of the spots
// clear of every label, it takes the first that covers the fewest marks.
import type { FloorGraph } from "@/domain";
import { LABEL_FONT, roomLabelFit, roomLabelMatrix, type LabelSlot, type Matrix, type Point } from "./iso";

export type Quad = readonly [Point, Point, Point, Point];

/** What labels placed from here on must keep clear of. */
export interface Taken {
  /** The glyphs of every label placed so far, a choice's number among them: never covered. */
  text: Quad[];
  /** The board's marks: avoided where there is room. */
  marks: Quad[];
}

/**
 * A board label's glyph box, in ems of its font: every label is set in
 * JetBrains Mono caps and digits, which advance 0.6em plus the 0.06em of
 * letter spacing (the browser measures a spaced label at up to 0.68em a
 * character, so that is what is kept), rise to the cap height above the
 * baseline, and drop a little below it only for a slash.
 */
export const GLYPH = { advance: 0.68, top: -0.78, bottom: 0.12 } as const;

/** Board units kept between two labels, so they never touch. */
const GAP = 2;

/** The font size of a guard's or a camera's id. */
export const PIECE_FONT = 12;
/** The font size of a node's label, a PICK label and a plan mark. */
export const MARK_FONT = 11;

/** Whether two convex quads intersect (the separating axis test); boxes that only touch do not. */
export function quadsOverlap(a: Quad, b: Quad): boolean {
  const axes = [a, b].flatMap((q) =>
    q.map((p, i) => {
      const n = q[(i + 1) % q.length];
      return { x: p.y - n.y, y: n.x - p.x };
    }),
  );
  return !axes.some((axis) => {
    const pa = a.map((p) => p.x * axis.x + p.y * axis.y);
    const pb = b.map((p) => p.x * axis.x + p.y * axis.y);
    return Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa);
  });
}

/** An upright box, as a quad. */
export function box(left: number, top: number, right: number, bottom: number): Quad {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/** The glyph box of an upright label at (x, y) on its baseline, grown by `pad` on every side. */
export function textBox(
  x: number,
  y: number,
  chars: number,
  font: number,
  anchor: LabelSpot["anchor"] = "start",
  pad = GAP,
): Quad {
  const width = chars * GLYPH.advance * font;
  const left = anchor === "start" ? x : anchor === "middle" ? x - width / 2 : x - width;
  return box(left - pad, y + GLYPH.top * font - pad, left + width + pad, y + GLYPH.bottom * font + pad);
}

/** The glyph box of a label drawn through `m` (a room label lying on its tile). */
export function matrixBox(m: Matrix, chars: number, font: number): Quad {
  const [a, b, c, d, e, f] = m;
  const at = (x: number, y: number): Point => ({ x: a * x + c * y + e, y: b * x + d * y + f });
  const width = chars * GLYPH.advance * font;
  const top = GLYPH.top * font;
  const bottom = GLYPH.bottom * font;
  return [at(0, top), at(width, top), at(width, bottom), at(0, bottom)];
}

const clearOf = (q: Quad, quads: readonly Quad[]) => !quads.some((t) => quadsOverlap(q, t));

/** A node on the board: its disc and a choice's ring are marks; a choice's number is a label. */
export function addNode(taken: Taken, p: Point): void {
  taken.marks.push(box(p.x - 18, p.y - 12, p.x + 18, p.y + 12));
  // The number's glyph (13px, set on its middle at the node: from its cap height above the node to
  // half of it below), with the gap every label keeps.
  taken.text.push(box(p.x - 4.5 - GAP, p.y - 10 - GAP, p.x + 4.5 + GAP, p.y + 5 + GAP));
}

/** A wall camera: its housing, and its id (see `CameraPiece`). */
export function addCamera(taken: Taken, p: Point, id: string): void {
  taken.marks.push(box(p.x - 16, p.y - 30, p.x + 16, p.y + 3));
  taken.text.push(textBox(p.x + 20, p.y - 34, id.length, PIECE_FONT));
}

/** A pawn's body and head, standing on `p` (see `Pawn`). */
export function addPawn(taken: Taken, p: Point): void {
  taken.marks.push(box(p.x - 12, p.y - 41, p.x + 12, p.y + 4));
}

/** Where a label stands relative to its piece, and which way it runs from there. */
export interface LabelSpot {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
}

/** A guard's id: right of its head by default, then left of it, then above it, then beside its body. */
export const PAWN_SPOTS: readonly LabelSpot[] = [
  { x: 14, y: -34, anchor: "start" },
  { x: -14, y: -34, anchor: "end" },
  { x: 0, y: -46, anchor: "middle" },
  { x: 14, y: -12, anchor: "start" },
  { x: -14, y: -12, anchor: "end" },
];

/**
 * Of the `candidates` clear of every label `taken`, the first that covers
 * the fewest of its marks; when none is clear, the one covering the fewest labels. Its box
 * is added to `taken`.
 */
function choose<T extends { quad: Quad }>(candidates: readonly T[], taken: Taken): T {
  let chosen: T | null = null;
  let fewest = Infinity;
  for (const c of candidates) {
    if (!clearOf(c.quad, taken.text)) continue;
    const covered = taken.marks.filter((m) => quadsOverlap(c.quad, m)).length;
    if (covered < fewest) {
      chosen = c;
      fewest = covered;
      if (covered === 0) break;
    }
  }
  // None clears every label: the one that covers the fewest.
  const textHits = (c: T) => taken.text.filter((t) => quadsOverlap(c.quad, t)).length;
  const pick = chosen ?? candidates.reduce((best, c) => (textHits(c) < textHits(best) ? c : best));
  taken.text.push(pick.quad);
  return pick;
}

/** The spot (relative to `origin`) where a label of `chars` characters goes, by `choose`. */
export function placeLabel(
  origin: Point,
  spots: readonly LabelSpot[],
  chars: number,
  font: number,
  taken: Taken,
): LabelSpot {
  const candidates = spots.map((spot) => ({ spot, quad: textBox(origin.x + spot.x, origin.y + spot.y, chars, font, spot.anchor) }));
  return choose(candidates, taken).spot;
}

export interface RoomLabel {
  roomId: string;
  text: string;
  matrix: Matrix;
  quad: Quad;
}

/** A room this narrow (in floor units) or narrower is a corridor: one row of nodes, end to end. */
const CORRIDOR_WIDTH = 4;

/**
 * Whether a room's back edge (the one its label runs along) is the floor's
 * outer wall: no other room's tile lies against any of it.
 */
export function backEdgeIsOuter(room: Pick<FloorGraph["rooms"][number], "id" | "rect">, rooms: FloorGraph["rooms"]): boolean {
  const r = room.rect;
  const alongX = r.w >= r.h;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return !rooms.some((o) => {
    if (o.id === room.id) return false;
    const q = o.rect;
    return alongX
      ? near(q.y + q.h, r.y) && q.x < r.x + r.w && q.x + q.w > r.x
      : near(q.x + q.w, r.x) && q.y < r.y + r.h && q.y + q.h > r.y;
  });
}

/**
 * Each room's name on its tile, by `choose`: along the back edge where it
 * fits whole (the default), else slid along it, else along the front edge,
 * else smaller. A corridor whose back edge is the floor's outer wall takes its
 * name just outside that edge (#83 R1-N2): on the tile, every spot is under a
 * node or a pawn at some point in the run.
 */
export function placeRoomLabels(
  floor: Pick<FloorGraph, "rooms">,
  label: (roomLabel: string) => string,
  taken: Taken,
): RoomLabel[] {
  return floor.rooms.map((room) => {
    const text = label(room.label);
    const { edge, em } = roomLabelFit(room.rect, text.length);
    const slots: LabelSlot[] = [];
    // A corridor along the floor's outer wall: every spot on its tile is under a node or a pawn
    // at some point in the run, so its name goes just outside, where nothing ever stands.
    const corridor = Math.min(room.rect.w, room.rect.h) <= CORRIDOR_WIDTH && backEdgeIsOuter(room, floor.rooms);
    const sides = corridor ? (["outside", "back", "front"] as const) : (["back", "front"] as const);
    for (const scale of [1, 0.85]) {
      const slack = edge - 0.6 - em * scale * text.length * GLYPH.advance;
      for (const side of sides) {
        for (let shift = 0; shift <= slack + 1e-9; shift += 0.25) slots.push({ side, shift, scale });
      }
    }
    const candidates = slots.map((slot) => {
      const matrix = roomLabelMatrix(room.rect, text.length, slot);
      return { roomId: room.id, text, matrix, quad: matrixBox(matrix, text.length, LABEL_FONT) };
    });
    return choose(candidates, taken);
  });
}
