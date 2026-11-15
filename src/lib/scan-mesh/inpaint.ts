// Filling a gap in a surface's picture with more of the surface (issue 118).
// Pure: pixels in, pixels out.
//
// A gap in a carpet should show carpet, not the blur of the colours round
// it. The picture is split in two: its shading (the slow change of light
// across a wall) and its grain (what is left: the carpet's weave, a
// ceiling tile's speckle). The shading is carried across the gap smoothly.
// The grain is copied from the surface that was seen: each missing pixel
// takes the grain of a seen pixel whose surroundings look like its own, and
// neighbours copy from neighbouring places, so whole scraps of the real
// texture carry over rather than single pixels (Ashikhmin's coherent
// synthesis, after Efros and Leung). The gap is filled from its rim inwards.

export interface InpaintOptions {
  /** Half the width of the window two places are compared over, pixels. */
  radius: number;
  /** Seen pixels tried at random for each missing one, beside its neighbours' places. */
  tries: number;
  /** The shading is the picture blurred over this many pixels either way. */
  blur: number;
  seed: number;
}

export const INPAINT: InpaintOptions = { radius: 3, tries: 6, blur: 6, seed: 1 };

export interface Inpainted {
  /** RGBA, alpha 255 throughout. */
  pixels: Uint8ClampedArray;
  /** Pixels that were missing and are now filled. */
  filled: number;
  /** For each pixel, the pixel its grain came from (itself where it was seen). */
  source: Int32Array;
}

/** A small repeatable random number generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `values` (three a pixel) averaged over a square of `radius` either way,
 * counting only the pixels `known` marks: the shading of the seen picture.
 * A pixel with no seen pixel in reach is left at 0, and `reach` (if given)
 * gets how much of each square was seen.
 */
export function knownBlur(values: Float32Array, known: Uint8Array, width: number, height: number, radius: number, reach?: Float32Array): Float32Array {
  const pass = (source: Float32Array, weight: Float32Array, horizontal: boolean): { colour: Float32Array; weight: Float32Array } => {
    const colour = new Float32Array(source.length);
    const out = new Float32Array(weight.length);
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    for (let line = 0; line < lines; line++) {
      const at = (k: number) => (horizontal ? line * width + k : k * width + line);
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (let k = -radius; k < length + radius; k++) {
        const enter = k + radius;
        if (enter < length) {
          const p = at(enter);
          r += source[p * 3];
          g += source[p * 3 + 1];
          b += source[p * 3 + 2];
          w += weight[p];
        }
        const leave = k - radius - 1;
        if (leave >= 0 && leave < length) {
          const p = at(leave);
          r -= source[p * 3];
          g -= source[p * 3 + 1];
          b -= source[p * 3 + 2];
          w -= weight[p];
        }
        if (k >= 0 && k < length) {
          const p = at(k);
          colour[p * 3] = r;
          colour[p * 3 + 1] = g;
          colour[p * 3 + 2] = b;
          out[p] = w;
        }
      }
    }
    return { colour, weight: out };
  };
  const masked = new Float32Array(values.length);
  const weight = new Float32Array(known.length);
  for (let p = 0; p < known.length; p++) {
    if (!known[p]) continue;
    weight[p] = 1;
    masked[p * 3] = values[p * 3];
    masked[p * 3 + 1] = values[p * 3 + 1];
    masked[p * 3 + 2] = values[p * 3 + 2];
  }
  const first = pass(masked, weight, true);
  const second = pass(first.colour, first.weight, false);
  const out = second.colour;
  for (let p = 0; p < known.length; p++) {
    const w = second.weight[p];
    if (reach) reach[p] = w;
    if (w > 1e-6) {
      out[p * 3] /= w;
      out[p * 3 + 1] /= w;
      out[p * 3 + 2] /= w;
    } else out[p * 3] = out[p * 3 + 1] = out[p * 3 + 2] = 0;
  }
  return out;
}

/**
 * The shading carried across the gaps: each missing pixel takes the seen
 * shading nearest it, from blurs of growing reach, then the whole is
 * smoothed where it was missing so no step shows.
 */
function spreadShading(image: Float32Array, known: Uint8Array, width: number, height: number, blur: number): Float32Array {
  const reach = new Float32Array(known.length);
  const out = knownBlur(image, known, width, height, blur, reach);
  const have = new Uint8Array(known.length);
  let missing = 0;
  for (let p = 0; p < known.length; p++) {
    if (reach[p] > 1e-6) have[p] = 1;
    else missing++;
  }
  // Wider and wider, until every pixel has a shading.
  for (let radius = blur * 2; missing > 0 && radius < (width + height) * 2; radius *= 2) {
    const wide = knownBlur(out, have, width, height, radius, reach);
    missing = 0;
    const got: number[] = [];
    for (let p = 0; p < known.length; p++) {
      if (have[p]) continue;
      if (reach[p] > 1e-6) {
        out[p * 3] = wide[p * 3];
        out[p * 3 + 1] = wide[p * 3 + 1];
        out[p * 3 + 2] = wide[p * 3 + 2];
        got.push(p);
      } else missing++;
    }
    for (const p of got) have[p] = 1;
  }
  // Smooth the carried shading inside the gaps; the seen pixels keep theirs.
  const all = new Uint8Array(known.length).fill(1);
  const smooth = knownBlur(out, all, width, height, blur);
  for (let p = 0; p < known.length; p++) {
    if (known[p]) continue;
    out[p * 3] = smooth[p * 3];
    out[p * 3 + 1] = smooth[p * 3 + 1];
    out[p * 3 + 2] = smooth[p * 3 + 2];
  }
  return out;
}

/**
 * `rgba` (four a pixel) with every pixel `known` does not mark filled in
 * from the ones it does. Seen pixels come back unchanged. Null when nothing
 * was seen: there is nothing to fill from. With `region` (x, y, width,
 * height) only the missing pixels inside it get grain; the rest get the
 * carried shading alone, which costs next to nothing.
 */
export function inpaint(
  rgba: Uint8ClampedArray | Uint8Array,
  known: Uint8Array,
  width: number,
  height: number,
  options: InpaintOptions = INPAINT,
  region: readonly [number, number, number, number] | null = null,
): Inpainted | null {
  const count = width * height;
  const seen: number[] = [];
  for (let p = 0; p < count; p++) if (known[p]) seen.push(p);
  if (seen.length === 0) return null;
  const image = new Float32Array(count * 3);
  for (let p = 0; p < count; p++) {
    image[p * 3] = rgba[p * 4];
    image[p * 3 + 1] = rgba[p * 4 + 1];
    image[p * 3 + 2] = rgba[p * 4 + 2];
  }
  const shading = spreadShading(image, known, width, height, options.blur);
  // The grain: what the seen picture has over its own shading.
  const grain = new Float32Array(count * 3);
  for (const p of seen) {
    grain[p * 3] = image[p * 3] - shading[p * 3];
    grain[p * 3 + 1] = image[p * 3 + 1] - shading[p * 3 + 1];
    grain[p * 3 + 2] = image[p * 3 + 2] - shading[p * 3 + 2];
  }

  const source = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  for (const p of seen) {
    source[p] = p;
    done[p] = 1;
  }
  // The missing pixels, rim first: breadth-first from the seen ones.
  const order: number[] = [];
  const queued = Uint8Array.from(known);
  let frontier = seen;
  while (frontier.length > 0) {
    const next: number[] = [];
    const reachTo = (q: number) => {
      if (queued[q]) return;
      queued[q] = 1;
      next.push(q);
    };
    for (const p of frontier) {
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0) reachTo(p - 1);
      if (x < width - 1) reachTo(p + 1);
      if (y > 0) reachTo(p - width);
      if (y < height - 1) reachTo(p + width);
    }
    for (const p of next) order.push(p);
    frontier = next;
  }

  const rand = random(options.seed);
  const { radius } = options;
  /** How unlike the grain round `p` (as far as it is filled) is to the seen grain round `q`; Infinity when too little of `q`'s surroundings was seen. */
  const cost = (p: number, q: number): number => {
    const px = p % width;
    const py = (p - px) / width;
    const qx = q % width;
    const qy = (q - qx) / width;
    let sum = 0;
    let n = 0;
    let lacking = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const ay = py + dy;
      const by = qy + dy;
      if (ay < 0 || ay >= height) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const ax = px + dx;
        if (ax < 0 || ax >= width) continue;
        const a = ay * width + ax;
        if (!done[a]) continue;
        const bx = qx + dx;
        if (by < 0 || by >= height || bx < 0 || bx >= width || !known[by * width + bx]) {
          lacking++;
          continue;
        }
        const b = by * width + bx;
        const dr = grain[a * 3] - grain[b * 3];
        const dg = grain[a * 3 + 1] - grain[b * 3 + 1];
        const db = grain[a * 3 + 2] - grain[b * 3 + 2];
        sum += dr * dr + dg * dg + db * db;
        n++;
      }
    }
    if (n === 0 || lacking > n) return Infinity;
    // A place whose surroundings were only partly seen is a worse match than its seen part says.
    return (sum / n) * (1 + lacking / n);
  };

  let filled = 0;
  for (const p of order) {
    const x = p % width;
    const y = (p - x) / width;
    if (region && (x < region[0] || y < region[1] || x >= region[0] + region[2] || y >= region[1] + region[3])) continue;
    filled++;
    let best = -1;
    let least = Infinity;
    const consider = (q: number) => {
      if (q < 0 || q >= count || !known[q]) return;
      const c = cost(p, q);
      if (c < least) {
        least = c;
        best = q;
      }
    };
    // Where each filled neighbour's grain came from, moved over by one: the same scrap goes on.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const n = ny * width + nx;
        if (!done[n]) continue;
        const s = source[n];
        const sx = (s % width) - dx;
        const sy = (s - (s % width)) / width - dy;
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        consider(sy * width + sx);
      }
    }
    for (let k = 0; k < options.tries; k++) consider(seen[Math.floor(rand() * seen.length)]);
    if (best === -1) best = seen[Math.floor(rand() * seen.length)];
    source[p] = best;
    grain[p * 3] = grain[best * 3];
    grain[p * 3 + 1] = grain[best * 3 + 1];
    grain[p * 3 + 2] = grain[best * 3 + 2];
    done[p] = 1;
  }

  const pixels = new Uint8ClampedArray(count * 4);
  for (let p = 0; p < count; p++) {
    if (known[p]) {
      pixels[p * 4] = rgba[p * 4];
      pixels[p * 4 + 1] = rgba[p * 4 + 1];
      pixels[p * 4 + 2] = rgba[p * 4 + 2];
    } else {
      pixels[p * 4] = shading[p * 3] + grain[p * 3];
      pixels[p * 4 + 1] = shading[p * 3 + 1] + grain[p * 3 + 1];
      pixels[p * 4 + 2] = shading[p * 3 + 2] + grain[p * 3 + 2];
    }
    pixels[p * 4 + 3] = 255;
  }
  return { pixels, filled, source };
}
