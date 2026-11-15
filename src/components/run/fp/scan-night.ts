// The night look's settings and measurements for the Run's first person on a
// live scan (issue 198). The look itself is the scan renderer's
// (spike/mesh/night.ts); here are its numbers and the two heights it needs,
// both measured from the scan's mesh while the page runs.
//
// No building's numbers are in this file. A look tuned by hand for one scan
// is set on the machine that shows it, in `.env.local`.
import type { NightLook } from "@/app/spike/mesh/night";

type Settings = Omit<NightLook, "floorY" | "ceilingY">;

/** The look with nothing set: a dim room, a torch a little brighter than the picture, black by nine metres. */
export const NIGHT_DEFAULTS: Settings = Object.freeze({ ambient: 0.1, torch: 1.1, reachM: 9, coneDeg: 34 });

export interface NightEnv {
  NEXT_PUBLIC_SCAN_NIGHT?: string;
  NEXT_PUBLIC_SCAN_NIGHT_AMBIENT?: string;
  NEXT_PUBLIC_SCAN_NIGHT_TORCH?: string;
  NEXT_PUBLIC_SCAN_NIGHT_REACH_M?: string;
  NEXT_PUBLIC_SCAN_NIGHT_CONE_DEG?: string;
}

/** The page's settings. Each name is written out, so the build can put its value in the page. */
const pageEnv = (): NightEnv => ({
  NEXT_PUBLIC_SCAN_NIGHT: process.env.NEXT_PUBLIC_SCAN_NIGHT,
  NEXT_PUBLIC_SCAN_NIGHT_AMBIENT: process.env.NEXT_PUBLIC_SCAN_NIGHT_AMBIENT,
  NEXT_PUBLIC_SCAN_NIGHT_TORCH: process.env.NEXT_PUBLIC_SCAN_NIGHT_TORCH,
  NEXT_PUBLIC_SCAN_NIGHT_REACH_M: process.env.NEXT_PUBLIC_SCAN_NIGHT_REACH_M,
  NEXT_PUBLIC_SCAN_NIGHT_CONE_DEG: process.env.NEXT_PUBLIC_SCAN_NIGHT_CONE_DEG,
});

/** `text` as a number within [low, high], else `fallback`: a typo in a setting must not black the scene out. */
function within(text: string | undefined, low: number, high: number, fallback: number): number {
  if (text === undefined || text.trim() === "") return fallback;
  const value = Number(text);
  return Number.isFinite(value) && value >= low && value <= high ? value : fallback;
}

/**
 * The look for a live scan, or null when it is switched off
 * (`NEXT_PUBLIC_SCAN_NIGHT=0`). On by default, so the machine that shows the
 * demo needs no setting.
 */
export function nightSettings(env: NightEnv = pageEnv()): Settings | null {
  if (["0", "off", "false"].includes((env.NEXT_PUBLIC_SCAN_NIGHT ?? "").trim().toLowerCase())) return null;
  return {
    ambient: within(env.NEXT_PUBLIC_SCAN_NIGHT_AMBIENT, 0, 1, NIGHT_DEFAULTS.ambient),
    torch: within(env.NEXT_PUBLIC_SCAN_NIGHT_TORCH, 0.2, 3, NIGHT_DEFAULTS.torch),
    reachM: within(env.NEXT_PUBLIC_SCAN_NIGHT_REACH_M, 2, 60, NIGHT_DEFAULTS.reachM),
    coneDeg: within(env.NEXT_PUBLIC_SCAN_NIGHT_CONE_DEG, 10, 80, NIGHT_DEFAULTS.coneDeg),
  };
}

/** How far under the lowest floor the plain floor lies: behind the scan's own floor and its lumps, never in front. */
export const FLOOR_GAP_M = 0.12;
/** How far over the highest ceiling the plain ceiling lies: over the light fittings recessed into a ceiling, too. */
export const CEILING_GAP_M = 0.4;
/** A ceiling farther than this over a scan position is an atrium or the sky: not a room's ceiling. */
export const CEILING_MAX_M = 6;

/** The plain floor's height: just under the lowest floor the board stands on, so it shows only through a hole. Null with no floor measured. */
export function fillFloorY(floors: readonly number[]): number | null {
  const known = floors.filter((y) => Number.isFinite(y));
  return known.length ? Math.min(...known) - FLOOR_GAP_M : null;
}

/**
 * The plain ceiling's height: just over the highest ceiling above the scan's
 * positions. `rises` is how far up the mesh is over each position (null where
 * the ray met nothing). Null when no position has a ceiling within reach.
 */
export function fillCeilingY(positions: readonly { y: number; rise: number | null }[]): number | null {
  const tops = positions.filter((p) => p.rise !== null && p.rise > 0 && p.rise <= CEILING_MAX_M).map((p) => p.y + (p.rise as number));
  return tops.length ? Math.max(...tops) + CEILING_GAP_M : null;
}
