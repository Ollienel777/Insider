// The Why card's model (SPEC §4.1, DESIGN.md "The signature element"): for a
// guard, camera, lock or zone on the board, the provenance entries the placer
// attached to it, in the placer's order, and nothing else. The card's rows are
// those entries with their value as text; it never writes a reason of its own.
// The one line it adds is how the placer chose a post, which the placer itself
// recorded on the guard.
//
// Pure: no DOM. Where the card and its thread sit is worked out here too, from
// the board's viewBox and the size it is drawn at.
import type { GuardIntent, Provenance, ProvenanceLayer } from "@/domain";
import type { RunState } from "@/engine";
import type { PlacedLevel } from "@/level/placer";
import { roomName, zoneName } from "./board";
import type { Frame, Point } from "./iso";

export type WhyKind = "guard" | "camera" | "lock" | "zone";

/** A board element the Why card can explain. Its `key` is what the board marks it with (`data-why`). */
export interface WhyTarget {
  key: string;
  kind: WhyKind;
  /** The element's id as the board labels it: G4, C2, a door's room, a room. */
  title: string;
  /** Where it is, and what it is. */
  subtitle: string;
  provenance: readonly Provenance[];
  /** The placer's own record of how it chose this element's node, when it recorded one. */
  placement: string | null;
}

/** One row of the card: one provenance entry, its value as text. */
export interface WhyRow {
  elementRole: string;
  layer: ProvenanceLayer;
  field: string;
  value: string;
  rule: string;
}

export const LAYER_LABEL: Readonly<Record<ProvenanceLayer, string>> = {
  costar: "CoStar",
  vexcel: "Vexcel",
  fiction: "Fiction",
};

/** The layer colour a thread draws in; game fiction has no data layer, so it draws neutral. */
export const THREAD_COLOUR: Readonly<Record<ProvenanceLayer, string>> = {
  costar: "var(--layer-costar)",
  vexcel: "var(--layer-vexcel)",
  fiction: "var(--n-400)",
};

export const whyKey = {
  guard: (id: string) => `guard:${id}`,
  camera: (id: string) => `camera:${id}`,
  lock: (doorId: string) => `lock:${doorId}`,
  room: (roomId: string) => `room:${roomId}`,
};

/** Every element on the placed level the card can explain, keyed as the board marks them. */
export function whyTargets(placed: PlacedLevel): WhyTarget[] {
  const { floor } = placed.level;
  const roomLabel = (roomId: string) => floor.rooms.find((r) => r.id === roomId)?.label ?? roomId;
  const targets: WhyTarget[] = [];

  for (const guard of placed.guards) {
    targets.push({
      key: whyKey.guard(guard.id),
      kind: "guard",
      title: guard.id,
      subtitle: `${guardOrigin(placed, guard.id)}, in the ${roomLabel(guard.roomId)}`,
      provenance: guard.provenance,
      placement: guard.post?.rule ?? null,
    });
  }

  for (const camera of placed.cameras) {
    targets.push({
      key: whyKey.camera(camera.id),
      kind: "camera",
      title: camera.id,
      subtitle: `Covers the ${roomName(floor, camera.cover[0])}`,
      provenance: camera.provenance,
      placement: null,
    });
  }

  for (const lock of placed.locks) {
    const zone = placed.zones.find((z) => z.zoneId === lock.zoneId);
    const room = zone ? roomLabel(zone.roomIds[0]) : lock.zoneId;
    targets.push({
      key: whyKey.lock(lock.doorId),
      kind: "lock",
      title: `${room} door`,
      subtitle: `Locked, ${placed.level.pickTurns} turns to pick`,
      provenance: lock.provenance,
      placement: null,
    });
  }

  // A room can hold several zones (four vacant suites share one tile): its card lists them all.
  for (const room of floor.rooms) {
    const zones = placed.zones.filter((z) => z.roomIds.includes(room.id));
    if (zones.length === 0) continue;
    targets.push({
      key: whyKey.room(room.id),
      kind: "zone",
      title: room.label,
      subtitle: zones.length === 1 ? zones[0].name : `${zones.length} zones: ${zones.map((z) => z.name).join(", ")}`,
      provenance: zones.flatMap((z) => z.provenance),
      placement: null,
    });
  }

  return targets;
}

/** What the placer set a guard to do: its post, or a round. */
function guardOrigin(placed: PlacedLevel, guardId: string): string {
  const post = placed.guards.find((g) => g.id === guardId)?.post;
  if (!post) return "On a round";
  const entry = placed.entries.find((e) => e.entryId === post.entryId);
  return `Posted for the ${entry?.label.toLowerCase() ?? post.entryId}`;
}

const DOING: Readonly<Record<GuardIntent, string>> = {
  hold: "holding",
  sweep: "sweeping",
  converge: "converging on",
  block: "blocking",
};

/**
 * The card's subtitle as the run stands now. A guard on its round or post
 * says where it stands; once the alarm or the Chief gives it an order, the
 * subtitle says the post (or round) was set at the start and names the order,
 * so the card never contradicts the Chief's panel. A lock picked open says so.
 */
export function liveSubtitle(placed: PlacedLevel, run: RunState, target: WhyTarget): string {
  const id = target.key.slice(target.key.indexOf(":") + 1);
  if (target.kind === "guard") {
    const guard = run.guards.find((g) => g.id === id);
    if (!guard) return target.subtitle;
    const origin = guardOrigin(placed, id);
    if (!guard.target) return `${origin}, in the ${roomName(placed.level.floor, guard.nodeId)}`;
    const isEntry = placed.entries.some((e) => e.entryId === guard.target!.zoneId);
    const zone = zoneName(placed, guard.target.zoneId);
    return `${origin} at the start; now ${DOING[guard.target.intent]} the ${isEntry ? zone.toLowerCase() : zone}`;
  }
  if (target.kind === "lock" && !run.locked.includes(id)) return "Picked open";
  return target.subtitle;
}

export function whyTarget(placed: PlacedLevel, key: string): WhyTarget | null {
  return whyTargets(placed).find((t) => t.key === key) ?? null;
}

/** The card's rows: the element's provenance, one row per entry, in order. */
export function whyRows(target: WhyTarget): WhyRow[] {
  return target.provenance.map((p) => ({
    elementRole: p.elementRole,
    layer: p.layer,
    field: p.field,
    value: String(p.value),
    rule: p.rule,
  }));
}

/** The thread draws in the first row's layer colour. */
export function threadColour(target: WhyTarget): string {
  return THREAD_COLOUR[target.provenance[0]?.layer ?? "fiction"];
}

// ---- where the card and its thread sit -------------------------------------

/** A board point (viewBox units) in the board's own CSS pixels, as `preserveAspectRatio="xMidYMid meet"` draws it. */
export function toScreen(frame: Frame, size: { width: number; height: number }, p: Point): Point {
  const scale = Math.min(size.width / frame.width, size.height / frame.height);
  const offX = (size.width - frame.width * scale) / 2;
  const offY = (size.height - frame.height * scale) / 2;
  return { x: (p.x - frame.minX) * scale + offX, y: (p.y - frame.minY) * scale + offY };
}

export const CARD_WIDTH = 384;
/** The gap between the piece and the card the thread spans, and the card's margin inside the board. */
const GAP = 48;
const MARGIN = 16;
/** Where on the card's near edge the thread lands: level with the title. */
const THREAD_LANDING = 40;

export interface CardPlacement {
  left: number;
  top: number;
  side: "right" | "left";
  /** The thread, from the piece to the card's near edge. */
  from: Point;
  to: Point;
}

/**
 * How far, in pixels, the card keeps its edge from a point it must not cover:
 * half a choice's badge (about 35 by 21 at 1440 by 900) and a little air.
 */
export const AVOID_RADIUS = { x: 22, y: 14 } as const;

/**
 * The card beside the piece: on its right when it fits, else its left, and
 * kept inside the board. The card is narrower than the board in every layout
 * the Run and Plan screens use; on a board too narrow for it, it sits at the
 * left margin.
 *
 * `avoid` holds the points the card must leave visible: the player's numbered
 * choices and the player (R3-M3, the wow beat). The card takes the first
 * place that covers none of them: the usual side at the usual height, the
 * other side at the usual height, then either side slid up or down, nearest
 * the usual height first. When no place clears them all, it takes the one
 * that covers the fewest, in the same order.
 */
export function placeCard(
  anchor: Point,
  board: { width: number; height: number },
  cardHeight: number,
  avoid: readonly Point[] = [],
): CardPlacement {
  const width = Math.min(CARD_WIDTH, board.width - 2 * MARGIN);
  const fitsRight = anchor.x + GAP + width <= board.width - MARGIN;
  const fitsLeft = anchor.x - GAP - width >= MARGIN;
  const usual = fitsRight || !fitsLeft ? "right" : "left";
  const leftOf = (side: "right" | "left") => {
    const raw = side === "right" ? anchor.x + GAP : anchor.x - GAP - width;
    return Math.max(MARGIN, Math.min(raw, board.width - MARGIN - width));
  };
  const maxTop = Math.max(MARGIN, board.height - MARGIN - cardHeight);
  const clampTop = (t: number) => Math.max(MARGIN, Math.min(t, maxTop));
  const usualTop = clampTop(anchor.y - THREAD_LANDING);
  const covered = (left: number, top: number) =>
    avoid.filter(
      (p) =>
        p.x > left - AVOID_RADIUS.x &&
        p.x < left + width + AVOID_RADIUS.x &&
        p.y > top - AVOID_RADIUS.y &&
        p.y < top + cardHeight + AVOID_RADIUS.y,
    ).length;
  const placement = (side: "right" | "left", top: number): CardPlacement => {
    const left = leftOf(side);
    const edgeX = side === "right" ? left : left + width;
    const landing = Math.max(top + 16, Math.min(anchor.y, top + cardHeight - 16));
    return { left, top, side, from: anchor, to: { x: edgeX, y: landing } };
  };

  const sides: ("right" | "left")[] = [usual];
  const other = usual === "right" ? "left" : "right";
  if (other === "right" ? fitsRight : fitsLeft) sides.push(other);
  if (avoid.length > 0) {
    // The usual height on each side, then slid up or down, nearest the usual height first, in 8px steps.
    const tops: number[] = [];
    for (let t = MARGIN; t <= maxTop; t += 8) tops.push(t);
    tops.push(maxTop);
    tops.sort((a, b) => Math.abs(a - usualTop) - Math.abs(b - usualTop));
    const candidates = [usualTop, ...tops].flatMap((top) => sides.map((side) => ({ side, top })));
    let best = candidates[0];
    let fewest = Infinity;
    for (const c of candidates) {
      const n = covered(leftOf(c.side), c.top);
      if (n === 0) return placement(c.side, c.top);
      if (n < fewest) [best, fewest] = [c, n];
    }
    return placement(best.side, best.top);
  }
  return placement(usual, usualTop);
}
