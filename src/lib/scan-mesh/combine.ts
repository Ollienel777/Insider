// How the panoramas' colours for one point of the mesh become one colour
// (issue 118). Pure, and the same sums as the mesh's shader
// (app/spike/mesh/projection.ts), so they can be tested here.
//
// blend.ts says how much each panorama counts for a point by where it stood.
// Two things go wrong that it can't see, because they depend on the colours
// and on what each panorama actually saw:
//
// - Doubles. Something thin the mesh doesn't model (a hanging lamp, a sign, a
//   chair leg) lands on the wall behind it at a different spot in each
//   panorama. Blended half and half, it shows twice, faintly. Where the
//   panoramas' colours for a point disagree, the weights are sharpened
//   towards the strongest: one sharp copy instead of two faint ones. Where
//   they agree (most of every frame) nothing changes, so the hand-over from
//   one panorama to the next stays smooth. The sharpening grows with the
//   disagreement, so there is no threshold to flicker across.
// - Grey. A point that no panorama in use saw (the edge of a door next to
//   the eye, or a corner the depth cubes are too coarse to resolve) used to
//   take an even trace of every panorama: four unrelated colours averaged,
//   which reads as a grey smudge. It now takes the panorama that came
//   closest to seeing it (the smallest distance between where its view
//   stopped and the point), as long as no panorama saw it at all.
// - The disc under a tripod (issue 198). Each photograph is blurred straight
//   down, so a panorama can give up its say for the patch under its own
//   tripod. It gives it up only as far as another panorama saw the point, and
//   only among the panoramas that saw it: what was seen, and the filling of
//   what nobody saw, are worked out as before. A neighbour whose view a wall
//   or door frame blocked never paints that blocker over floor the panorama
//   saw itself; there the blurred disc stays.
import { HIDDEN } from "./blend";
import type { Rgb } from "./exposure";

export interface PanoSample {
  /** The panorama's colour for the point, 0 to 1, its exposure gain applied. */
  colour: Rgb;
  /** Its say from blend.ts's rule, before whether it saw the point: share, facing, angle. */
  base: number;
  /** 1 when it saw the point, 0 when something stood between, and in between at the soft edge. */
  seen: number;
  /** Metres between where its view stopped and the point; 0 when it saw the point. */
  miss: number;
  /** How much of its say it gives up because the point is in the blurred patch under its own tripod, 0 (absent) to 1: the fade times how deep in the patch. */
  nadir?: number;
}

export interface CombineOptions {
  /** Lean on the strongest panorama where the colours disagree. */
  agree: boolean;
  /** Fill a point nobody saw from the panorama nearest to seeing it, not from an average. */
  fill: boolean;
}

export interface Combined {
  /** Each sample's final part in the colour, summing to 1 (all 0 when no sample has a say). */
  weights: number[];
  colour: Rgb | null;
  /** The part of the say that came from panoramas that saw the point. */
  seenFraction: number;
  /** How far the samples' colours were from their blend before the sharpening, 0 to 1. */
  spread: number;
  /** The same after it: how much of a second picture is left showing. */
  ghost: number;
}

/** A panorama this many metres short of seeing a point counts about a third as much for filling it. */
export const FILL_REACH = 0.15;
/** How hard the filling leans on the panorama nearest to seeing the point. */
export const FILL_POWER = 8;
/** Below this part of the say from panoramas that saw it, a point is filled instead. */
export const SEEN_FLOOR = 0.05;
/** Colour spread (mean absolute difference, 0 to 1) where the sharpening starts, and where it is full. */
export const AGREE_LOW = 0.025;
export const AGREE_HIGH = 0.09;
/** The power the weights are raised to at full disagreement is 1 + this. */
export const SHARPEN = 11;

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Mean absolute difference of two colours, 0 to 1. */
export const colourGap = (a: Rgb, b: Rgb) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;

const normalise = (w: number[]) => {
  const total = w.reduce((a, b) => a + b, 0);
  return total > 0 ? w.map((x) => x / total) : w.map(() => 0);
};

const blendOf = (samples: readonly PanoSample[], w: readonly number[]): Rgb => {
  const c = [0, 0, 0];
  samples.forEach((s, i) => {
    for (let k = 0; k < 3; k++) c[k] += s.colour[k] * w[i];
  });
  return [c[0], c[1], c[2]];
};

const spreadOf = (samples: readonly PanoSample[], w: readonly number[], about: Rgb) =>
  samples.reduce((sum, s, i) => sum + w[i] * colourGap(s.colour, about), 0);

export function combineSamples(samples: readonly PanoSample[], options: CombineOptions): Combined {
  const baseTotal = samples.reduce((sum, s) => sum + Math.max(0, s.base), 0);
  if (baseTotal <= 0) return { weights: samples.map(() => 0), colour: null, seenFraction: 0, spread: 0, ghost: 0 };
  const seenWeights = samples.map((s) => Math.max(0, s.base) * s.seen);
  const seenFraction = seenWeights.reduce((a, b) => a + b, 0) / baseTotal;
  // Under its own tripod a panorama gives up its say only as far as another one saw the point.
  const kept = samples.map((s, i) => {
    const cover = samples.reduce((most, o, j) => (j !== i && o.base > 0 ? Math.max(most, o.seen) : most), 0);
    return 1 - (s.nadir ?? 0) * cover;
  });

  let weights: number[];
  if (!options.fill) {
    weights = normalise(samples.map((s, i) => Math.max(0, s.base) * (s.seen * kept[i] + HIDDEN)));
  } else {
    // In logs, so a panorama metres short of the point doesn't underflow to nothing.
    const scores = samples.map((s) => (s.base > 0 ? Math.log(s.base) - s.miss / FILL_REACH : -Infinity));
    const best = Math.max(...scores);
    const fill = normalise(scores.map((score) => (score === -Infinity ? 0 : Math.exp(FILL_POWER * (score - best)))));
    const seen = normalise(seenWeights.map((w, i) => w * kept[i]));
    const t = smoothstep(0, SEEN_FLOOR, seenFraction);
    weights = fill.map((f, i) => f + (seen[i] - f) * t);
  }

  const before = blendOf(samples, weights);
  const spread = spreadOf(samples, weights, before);
  if (options.agree) {
    const power = 1 + SHARPEN * smoothstep(AGREE_LOW, AGREE_HIGH, spread);
    const most = Math.max(...weights);
    if (most > 0) weights = normalise(weights.map((w) => (w / most) ** power));
  }
  const colour = blendOf(samples, weights);
  return { weights, colour, seenFraction, spread, ghost: spreadOf(samples, weights, colour) };
}
