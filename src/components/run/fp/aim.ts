// What the player is looking at in first person (issue 115): the guard,
// cleaner or camera nearest the middle of the view, which F, or a click with
// the mouse locked, opens the Why card for. Pure: the labels as drawn on the
// screen this frame in, one label out.
import { whyKey } from "../why";

/** A label as the view drew it this frame. */
export interface DrawnLabel {
  /** The actors' key: `p:G1` for a guard or a cleaner, `c:C2` for a camera. */
  key: string;
  tone: string;
  /** Where it was drawn, in pixels from the view's top left. */
  x: number;
  y: number;
  /** Nothing solid between the player and it. */
  inSight: boolean;
}

/** How far either side of the middle of the view, in pixels, a label still counts as looked at. */
export const AIM_RADIUS_PX = 90;

const AIMABLE = new Set(["guard", "cleaner", "camera"]);

/**
 * The watcher's label nearest the middle of a `w` by `h` view, side to side, within `radius`; null if
 * none is. Only the side-to-side distance counts: a camera hangs at the ceiling and a near guard's
 * label well above the crosshair, and the arrow keys turn the view but cannot tip it up.
 */
export function aimedAt(labels: readonly DrawnLabel[], w: number, h: number, radius: number = AIM_RADIUS_PX): DrawnLabel | null {
  let best: DrawnLabel | null = null;
  let bestD = radius;
  for (const label of labels) {
    if (!label.inSight || !AIMABLE.has(label.tone) || label.y < 0 || label.y > h) continue;
    const d = Math.abs(label.x - w / 2);
    if (d <= bestD) {
      bestD = d;
      best = label;
    }
  }
  return best;
}

/** The Why card's key for a label the view drew, or null for one the card does not explain. */
export function whyKeyOf(label: Pick<DrawnLabel, "key" | "tone">): string | null {
  const id = label.key.slice(2);
  if (label.key.startsWith("c:")) return whyKey.camera(id);
  if (!label.key.startsWith("p:")) return null;
  return label.tone === "cleaner" ? whyKey.cleaner(id) : whyKey.guard(id);
}
