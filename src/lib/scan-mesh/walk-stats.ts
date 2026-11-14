// The debug recorder's numbers, summed up (issue 118). Pure.
//
// A walk that reads as "one photo, then the next" shows up three ways: the
// weight at the centre of the screen flips from one panorama to the next over
// a few centimetres; the picture jumps at those moments while it barely
// changes in between; and the brightness steps when panoramas taken at
// different exposures hand over.

export interface WalkSample {
  /** Metres along the route. */
  walked: number;
  /** Each panorama's part in the centre pixel, by its index in the scan's list. */
  weights: Record<number, number>;
  /** Mean absolute change of every pixel since the frame before, 0 to 255. */
  change: number;
  /** Mean brightness of the frame, 0 to 255. */
  brightness: number;
}

export interface WalkStats {
  frames: number;
  metres: number;
  /** The fastest any one panorama's centre weight changed, per metre walked. */
  maxWeightPerMetre: number;
  /** The same, as the 95th percentile over frames. */
  p95WeightPerMetre: number;
  /** Share of frames where one panorama has more than 90% of the centre pixel. */
  dominated: number;
  /** How often the panorama with the most weight changed. */
  handovers: number;
  /** Frame-to-frame picture change: typical, and its largest. */
  medianChange: number;
  maxChange: number;
  /** Frames that changed more than three times the typical frame. */
  spikes: number;
  /** The largest brightness step between two frames, and the range over the walk. */
  maxBrightnessStep: number;
  brightnessRange: number;
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

function top(weights: Record<number, number>): number | null {
  let best: number | null = null;
  let most = -1;
  for (const [key, w] of Object.entries(weights)) {
    if (w > most) {
      most = w;
      best = Number(key);
    }
  }
  return best;
}

export function walkStats(samples: readonly WalkSample[]): WalkStats {
  const rates: number[] = [];
  let handovers = 0;
  let dominated = 0;
  let maxBrightnessStep = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (Math.max(0, ...Object.values(s.weights)) > 0.9) dominated++;
    if (i === 0) continue;
    const p = samples[i - 1];
    const step = s.walked - p.walked;
    if (step > 0) {
      const keys = new Set([...Object.keys(s.weights), ...Object.keys(p.weights)].map(Number));
      let most = 0;
      for (const k of keys) most = Math.max(most, Math.abs((s.weights[k] ?? 0) - (p.weights[k] ?? 0)));
      rates.push(most / step);
    }
    const a = top(p.weights);
    const b = top(s.weights);
    if (a !== null && b !== null && a !== b) handovers++;
    maxBrightnessStep = Math.max(maxBrightnessStep, Math.abs(s.brightness - p.brightness));
  }
  const changes = samples.slice(1).map((s) => s.change);
  const medianChange = percentile(changes, 0.5);
  const brightness = samples.map((s) => s.brightness);
  return {
    frames: samples.length,
    metres: samples.length > 0 ? samples[samples.length - 1].walked - samples[0].walked : 0,
    maxWeightPerMetre: Math.max(0, ...rates),
    p95WeightPerMetre: percentile(rates, 0.95),
    dominated: samples.length > 0 ? dominated / samples.length : 0,
    handovers,
    medianChange,
    maxChange: Math.max(0, ...changes),
    spikes: changes.filter((c) => c > 3 * Math.max(medianChange, 0.5)).length,
    maxBrightnessStep,
    brightnessRange: brightness.length > 0 ? Math.max(...brightness) - Math.min(...brightness) : 0,
  };
}
