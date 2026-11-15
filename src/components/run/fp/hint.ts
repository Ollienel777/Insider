// The first-time controls hint (issue 146): what a player handed the mouse
// has tried so far, and when the hint can go. It goes once they have both
// walked and looked about; E is ticked off when tried but never keeps it up,
// since a judge may never need it.
//
// Pure: the view feeds it what the walker and the controller measured.

/** How far the body must have walked, in metres, before moving counts as learned. */
export const HINT_WALK_M = 1.5;
/** How far the view must have turned, in radians (yaw and pitch together), before looking counts. */
export const HINT_LOOK_RAD = 0.5;
/** How long the hint takes to fade, in milliseconds. */
export const HINT_FADE_MS = 700;

export interface HintProgress {
  /** Metres walked since the view opened. */
  walkedM: number;
  /** Radians turned since the view opened, by the mouse, a drag or the arrow keys. */
  lookedRad: number;
  /** E went down. */
  used: boolean;
}

export const NO_PROGRESS: HintProgress = Object.freeze({ walkedM: 0, lookedRad: 0, used: false });

export interface HintTicks {
  move: boolean;
  look: boolean;
  use: boolean;
}

export function hintTicks(p: HintProgress): HintTicks {
  return { move: p.walkedM >= HINT_WALK_M, look: p.lookedRad >= HINT_LOOK_RAD, use: p.used };
}

/** The hint has done its job: the player has walked and looked. */
export function hintDone(p: HintProgress): boolean {
  const t = hintTicks(p);
  return t.move && t.look;
}

export type HintPhase = "shown" | "fading" | "gone";

/**
 * Where the hint is, `sinceDoneMs` after it was done (null while it is not).
 * Under reduced motion it goes at once.
 */
export function hintPhase(sinceDoneMs: number | null, still: boolean): HintPhase {
  if (sinceDoneMs === null) return "shown";
  if (still || sinceDoneMs >= HINT_FADE_MS) return "gone";
  return "fading";
}
