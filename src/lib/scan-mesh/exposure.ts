// Matching neighbouring panoramas' exposure and white balance (issue 118).
// Pure: colour pairs in, one gain per panorama and channel out.
//
// Each panorama was shot with its own exposure, so the same wall can be a
// little brighter or warmer in one than in the next, and even a smooth blend
// then reads as one photo giving way to another. For pairs of panoramas that
// saw the same points of the mesh, the typical ratio of their colours there
// says how far apart they are; one gain per panorama, solved over all the
// pairs at once, brings neighbours together while keeping the scan's overall
// look (the gains average to one).

export type Rgb = readonly [number, number, number];

export interface PairObservation {
  /** Indices of the two panoramas. */
  a: number;
  b: number;
  /** The same point's colour in each, 0 to 255, one entry per point. */
  colourA: readonly Rgb[];
  colourB: readonly Rgb[];
}

export interface PairRatio {
  a: number;
  b: number;
  /** Per channel, the typical log(colour in b / colour in a). */
  logRatio: Rgb;
  /** How many points it rests on. */
  count: number;
}

/** Below and above these, a channel says nothing about exposure: noise, or clipped. */
const DARK = 12;
const BRIGHT = 245;
/** A pair needs this many usable points to count. */
export const MIN_POINTS = 24;

const median = (values: number[]): number => {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The typical colour ratio between two panoramas over the points both saw,
 * or null with too few usable points. The median, so a point one of them saw
 * wrongly (a person walking through, a reflection) doesn't pull it.
 */
export function pairRatio(observation: PairObservation): PairRatio | null {
  const { a, b, colourA, colourB } = observation;
  const logs: [number[], number[], number[]] = [[], [], []];
  for (let i = 0; i < Math.min(colourA.length, colourB.length); i++) {
    const p = colourA[i];
    const q = colourB[i];
    const usable = [0, 1, 2].every((c) => p[c] > DARK && p[c] < BRIGHT && q[c] > DARK && q[c] < BRIGHT);
    if (!usable) continue;
    for (let c = 0; c < 3; c++) logs[c].push(Math.log(q[c] / p[c]));
  }
  const count = logs[0].length;
  if (count < MIN_POINTS) return null;
  return { a, b, logRatio: [median(logs[0]), median(logs[1]), median(logs[2])], count };
}

/**
 * How far apart neighbours' colours are, typically, as a fraction (0.1 is
 * 10%): the root mean square over pairs and channels of the log ratio left
 * once `gains` are applied (none given means all ones: "before").
 */
export function pairMismatch(ratios: readonly PairRatio[], gains: readonly Rgb[]): number {
  let sum = 0;
  let n = 0;
  for (const r of ratios) {
    const ga = gains[r.a] ?? [1, 1, 1];
    const gb = gains[r.b] ?? [1, 1, 1];
    for (let c = 0; c < 3; c++) {
      // gain a · colour a against gain b · colour b
      const left = r.logRatio[c] + Math.log(gb[c]) - Math.log(ga[c]);
      sum += left * left;
      n++;
    }
  }
  return n > 0 ? Math.expm1(Math.sqrt(sum / n)) : 0;
}

/**
 * One gain per panorama and channel, multiplying its colours, so that
 * gain[a] · colour in a ≈ gain[b] · colour in b over every pair: the least
 * squares answer in log space, pulled a little toward 1 (`pull`) so a
 * panorama with few pairs stays put, then scaled so the gains of the
 * panoramas in any pair average to one, and clamped to [min, max].
 */
export function solveGains(
  count: number,
  ratios: readonly PairRatio[],
  options: { pull?: number; iterations?: number; min?: number; max?: number } = {},
): Rgb[] {
  const { pull = 2, iterations = 200, min = 0.6, max = 1.6 } = options;
  const logs: number[][] = Array.from({ length: count }, () => [0, 0, 0]);
  const links: { other: number; target: Rgb; weight: number }[][] = Array.from({ length: count }, () => []);
  for (const r of ratios) {
    if (r.a < 0 || r.b < 0 || r.a >= count || r.b >= count || r.a === r.b) continue;
    const weight = Math.sqrt(r.count);
    // log g[a] - log g[b] = log(colour b / colour a)
    links[r.a].push({ other: r.b, target: r.logRatio, weight });
    links[r.b].push({ other: r.a, target: [-r.logRatio[0], -r.logRatio[1], -r.logRatio[2]], weight });
  }
  // Gauss-Seidel: each panorama in turn moves to the best gain given its neighbours'.
  for (let pass = 0; pass < iterations; pass++) {
    for (let i = 0; i < count; i++) {
      if (links[i].length === 0) continue;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let total = pull;
        for (const link of links[i]) {
          sum += link.weight * (logs[link.other][c] + link.target[c]);
          total += link.weight;
        }
        logs[i][c] = sum / total;
      }
    }
  }
  const linked = logs.filter((_, i) => links[i].length > 0);
  const mean = [0, 1, 2].map((c) => (linked.length ? linked.reduce((s, g) => s + g[c], 0) / linked.length : 0));
  return logs.map((g, i) =>
    links[i].length === 0
      ? ([1, 1, 1] as const)
      : ([0, 1, 2].map((c) => Math.min(max, Math.max(min, Math.exp(g[c] - mean[c])))) as unknown as Rgb),
  );
}
