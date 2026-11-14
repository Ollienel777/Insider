// The massing render's geometry (SPEC §4.5, the keyless Vexcel fake): a
// building's footprint and height, extruded and projected into each of the
// five views, plus where each tagged entry lands on each view. Pure: no DOM,
// no React, so it is tested on its own and the view only draws what it gets.
import type { Aerial, AerialEntry, ViewDir } from "@/domain";

/** The order ← and → step through. */
export const VIEW_ORDER: readonly ViewDir[] = ["N", "E", "S", "W", "ortho"];

/** Every view is drawn into the same frame, so the cross-fade never resizes. */
export const FRAME = { width: 1600, height: 1000 } as const;

/** How far the obliques look down from the horizon. */
const PITCH = (42 * Math.PI) / 180;
/**
 * The obliques are turned this far off their cardinal direction, so a
 * rectangular block shows two faces and reads as a solid, not an elevation.
 */
const YAW = (28 * Math.PI) / 180;
/** The light comes from the south-west, high (screen-independent). */
const SUN = normalise3([-0.55, -0.7, 0.9]);
/** Shadow cast on the ground, metres per metre of height. */
const SHADOW = [0.42, 0.3] as const;

type V2 = readonly [number, number];
type V3 = readonly [number, number, number];

export interface Face {
  /** The polygon in frame coordinates, as an SVG `points` string. */
  points: string;
  /** 0 (darkest) to 1 (lit), from the face's normal against the light. */
  light: number;
}

export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Marker {
  entry: AerialEntry;
  /** Where the entry lands, as fractions of the frame (0..1). */
  x: number;
  y: number;
  /** False when the entry is on a face turned away from this view. */
  facing: boolean;
  /**
   * The label's callout: it sits clear of the building on `side`, at
   * (`labelX`, `labelY`) as fractions of the frame, joined to the marker by a
   * leader. Labels on one side never sit closer than `LABEL_GAP`.
   */
  side: "left" | "right";
  labelX: number;
  labelY: number;
}

/** The least vertical distance between two labels on one side, in frame units. */
export const LABEL_GAP = 52;
/** How far the label column stands off the building, in frame units. */
const LABEL_STANDOFF = 64;

/**
 * Lays the labels out as callouts in two columns either side of the building,
 * each as near its marker's height as the ones above it allow. A marker near
 * the middle (a roof hatch, say) goes to whichever column has fewer.
 */
export function layoutLabels(
  points: { x: number; y: number }[],
  building: { x0: number; x1: number },
): { side: "left" | "right"; labelX: number; labelY: number }[] {
  const mid = (building.x0 + building.x1) / 2;
  const band = (building.x1 - building.x0) * 0.15;
  const sides: ("left" | "right" | null)[] = points.map((p) =>
    p.x < mid - band ? "left" : p.x > mid + band ? "right" : null,
  );
  sides.forEach((side, i) => {
    if (side) return;
    const left = sides.filter((s) => s === "left").length;
    const right = sides.filter((s) => s === "right").length;
    sides[i] = left < right ? "left" : "right";
  });
  const out = points.map((p, i) => {
    const side = sides[i]!;
    return { side, labelX: side === "left" ? building.x0 - LABEL_STANDOFF : building.x1 + LABEL_STANDOFF, labelY: p.y };
  });
  // A leader that would run through another marker on its way out (one
  // nearer the column, at about the same height) bends above or below it.
  out.forEach((o, i) => {
    for (let j = 0; j < points.length; j++) {
      if (j === i || out[j].side !== o.side) continue;
      const outer = Math.abs(o.labelX - points[j].x) < Math.abs(o.labelX - points[i].x);
      if (outer && Math.abs(points[i].y - points[j].y) < LABEL_GAP) {
        o.labelY = points[i].y <= points[j].y ? points[j].y - LABEL_GAP : points[j].y + LABEL_GAP;
      }
    }
  });
  for (const side of ["left", "right"] as const) {
    const order = out
      .map((o, i) => i)
      .filter((i) => out[i].side === side)
      .sort((a, b) => out[a].labelY - out[b].labelY);
    for (let k = 1; k < order.length; k++) {
      const prev = out[order[k - 1]];
      const cur = out[order[k]];
      cur.labelY = Math.max(cur.labelY, prev.labelY + LABEL_GAP);
    }
    // Pushed off the bottom: slide the column up, keeping the gaps.
    const last = order.length ? out[order[order.length - 1]] : null;
    const overflow = last ? last.labelY - (FRAME.height - LABEL_GAP / 2) : 0;
    if (overflow > 0) for (const i of order) out[i].labelY -= overflow;
  }
  return out;
}

export interface MassingView {
  dir: ViewDir;
  ground: Line[];
  /** The building's base on the ground (and its cast shadow). */
  shadow: string;
  pad: string;
  walls: Face[];
  /** The storey lines on the visible walls. */
  floors: Line[];
  roof: Face;
  /** The parapet line just inside the roof edge. */
  parapet: string;
  markers: Marker[];
  /** The ground point under the building's centre, for the ground's fade. */
  centre: { x: number; y: number };
  /** Frame units per metre. */
  scale: number;
}

/** A view's name, as the caption and the chips say it. */
export const VIEW_LABEL: Record<ViewDir, { chip: string; caption: string }> = {
  N: { chip: "N", caption: "From the north" },
  E: { chip: "E", caption: "From the east" },
  S: { chip: "S", caption: "From the south" },
  W: { chip: "W", caption: "From the west" },
  ortho: { chip: "Ortho", caption: "Straight down" },
};

/** Which face an entry is tagged on, in words. */
export function entryFace(entry: AerialEntry, heightM: number): string {
  if (entry.kind === "roof" || (entry.at && entry.at.elevM >= heightM)) return "Roof";
  const face: Record<ViewDir, string> = { N: "North face", E: "East face", S: "South face", W: "West face", ortho: "Roof" };
  return face[entry.view];
}

/** The view one step from `dir`, wrapping round. */
export function stepView(dir: ViewDir, by: 1 | -1): ViewDir {
  const i = VIEW_ORDER.indexOf(dir);
  return VIEW_ORDER[(i + by + VIEW_ORDER.length) % VIEW_ORDER.length];
}

/** `[lng, lat]` to metres east and north of `origin`. */
function toLocal(origin: V2) {
  const k = (Math.PI / 180) * 6_371_000;
  const cos = Math.cos((origin[1] * Math.PI) / 180);
  return ([lng, lat]: V2): V2 => [(lng - origin[0]) * k * cos, (lat - origin[1]) * k];
}

function normalise3(v: V3): V3 {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** A camera: `project` maps a point in metres to frame units before fitting. */
interface Camera {
  /** The horizontal direction the camera looks along (east, north). */
  forward: V2;
  project(p: V3): V2;
}

function camera(dir: ViewDir): Camera {
  if (dir === "ortho") {
    // Straight down, north up.
    return { forward: [0, 0], project: ([x, y]) => [x, -y] };
  }
  // `N` stands north and looks south; the others likewise.
  const base: Record<Exclude<ViewDir, "ortho">, number> = { N: -Math.PI / 2, E: Math.PI, S: Math.PI / 2, W: 0 };
  const angle = base[dir] + YAW;
  const forward: V2 = [Math.cos(angle), Math.sin(angle)];
  // Looking along `forward`, the right hand points along forward × up.
  const right: V2 = [forward[1], -forward[0]];
  const sin = Math.sin(PITCH);
  const cos = Math.cos(PITCH);
  return {
    forward,
    project: ([x, y, z]) => {
      const across = x * right[0] + y * right[1];
      const depth = x * forward[0] + y * forward[1];
      // Farther away and higher up both sit higher on the screen.
      return [across, -(depth * sin + z * cos)];
    },
  };
}

/** Signed area in the east-north plane: positive when the ring runs anticlockwise. */
function signedArea(ring: readonly V2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function hull(points: V2[]): V2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: V2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: V2[] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The distance from `p` to the segment `a`–`b`. */
function toSegment(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const fmt = (n: number) => Number(n.toFixed(1));
const pts = (ring: readonly V2[]) => ring.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");

/**
 * Every view of the building's massing. The four obliques share one scale,
 * so turning round never changes the building's size; the top-down view has
 * its own, since it shows only the roof.
 */
export function buildMassing(aerial: Pick<Aerial, "footprint" | "heightM" | "entries">, stories: number): MassingView[] {
  const n = aerial.footprint.length;
  const origin: V2 = [
    aerial.footprint.reduce((s, [x]) => s + x, 0) / n,
    aerial.footprint.reduce((s, [, y]) => s + y, 0) / n,
  ];
  const local = toLocal(origin);
  let ring = aerial.footprint.map((p) => local(p));
  // Walls' outward normals assume an anticlockwise ring.
  if (signedArea(ring) < 0) ring = [...ring].reverse();
  const h = aerial.heightM;
  const extent = Math.max(...ring.map(([x, y]) => Math.hypot(x, y)));

  const shadowRing = hull([...ring, ...ring.map(([x, y]): V2 => [x + SHADOW[0] * h, y + SHADOW[1] * h])]);
  const padRing = ring.map(([x, y]): V2 => [x * 1.3, y * 1.3]);
  const reach = Math.max(extent * 3.2, 120);
  const step = reach > 400 ? 20 : 10;

  // The unfitted projections, to find each view's bounds and the shared scale.
  const raw = VIEW_ORDER.map((dir) => {
    const cam = camera(dir);
    const corners = [...ring.map(([x, y]): V3 => [x, y, 0]), ...ring.map(([x, y]): V3 => [x, y, h])].map(cam.project);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    return { dir, cam, box: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } };
  });
  const fit = (box: { x0: number; x1: number; y0: number; y1: number }, w: number, hgt: number) =>
    Math.min((FRAME.width * w) / (box.x1 - box.x0 || 1), (FRAME.height * hgt) / (box.y1 - box.y0 || 1));
  const obliqueScale = Math.min(...raw.filter((r) => r.dir !== "ortho").map((r) => fit(r.box, 0.5, 0.72)));

  return raw.map(({ dir, cam, box }) => {
    const scale = dir === "ortho" ? fit(box, 0.42, 0.56) : obliqueScale;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const place = (p: V3): V2 => {
      const [x, y] = cam.project(p);
      return [FRAME.width / 2 + (x - cx) * scale, FRAME.height / 2 + (y - cy) * scale];
    };
    const flat = (r: readonly V2[], z = 0) => r.map(([x, y]) => place([x, y, z]));

    const ground: Line[] = [];
    for (let v = -Math.ceil(reach / step) * step; v <= reach; v += step) {
      for (const [a, b] of [
        [[v, -reach, 0], [v, reach, 0]],
        [[-reach, v, 0], [reach, v, 0]],
      ] as [V3, V3][]) {
        const [x1, y1] = place(a);
        const [x2, y2] = place(b);
        ground.push({ x1: fmt(x1), y1: fmt(y1), x2: fmt(x2), y2: fmt(y2) });
      }
    }

    // Walls turned towards the camera, drawn far to near.
    const walls: (Face & { depth: number })[] = [];
    const floors: Line[] = [];
    const storey = h / Math.max(1, stories);
    const every = storey * scale * Math.cos(PITCH) < 10 ? Math.ceil(10 / (storey * scale * Math.cos(PITCH))) : 1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len === 0) continue;
      const normal: V2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      if (dir === "ortho" || normal[0] * cam.forward[0] + normal[1] * cam.forward[1] >= -0.02) continue;
      const lit = Math.max(0, normal[0] * SUN[0] + normal[1] * SUN[1]);
      const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      walls.push({
        points: pts([place([a[0], a[1], 0]), place([b[0], b[1], 0]), place([b[0], b[1], h]), place([a[0], a[1], h])]),
        // Sun, plus a little fill from the camera so the two faces seen never match.
        light: Number(Math.min(1, 0.1 + 0.55 * lit + 0.3 * -(normal[0] * cam.forward[0] + normal[1] * cam.forward[1])).toFixed(2)),
        depth: mid[0] * cam.forward[0] + mid[1] * cam.forward[1],
      });
      for (let f = every; f < stories; f += every) {
        const [x1, y1] = place([a[0], a[1], f * storey]);
        const [x2, y2] = place([b[0], b[1], f * storey]);
        floors.push({ x1: fmt(x1), y1: fmt(y1), x2: fmt(x2), y2: fmt(y2) });
      }
    }
    walls.sort((p, q) => q.depth - p.depth);

    const facing = (entry: AerialEntry): boolean => {
      if (dir === "ortho" || !entry.at || entry.at.elevM >= h) return true;
      const p = local(entry.at.lngLat);
      let best = Infinity;
      let normal: V2 = [0, 0];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const d = toSegment(p, a, b);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        if (d < best) {
          best = d;
          normal = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
        }
      }
      return normal[0] * cam.forward[0] + normal[1] * cam.forward[1] < -0.02;
    };

    const placed = aerial.entries.flatMap((entry) => {
      if (!entry.at) return [];
      const [x, y] = place([...local(entry.at.lngLat), entry.at.elevM]);
      return [{ entry, x, y }];
    });
    const labels = layoutLabels(placed, {
      x0: FRAME.width / 2 + (box.x0 - cx) * scale,
      x1: FRAME.width / 2 + (box.x1 - cx) * scale,
    });
    const markers: Marker[] = placed.map(({ entry, x, y }, i) => ({
      entry,
      x: x / FRAME.width,
      y: y / FRAME.height,
      facing: facing(entry),
      side: labels[i].side,
      labelX: labels[i].labelX / FRAME.width,
      labelY: labels[i].labelY / FRAME.height,
    }));

    const [gx, gy] = place([0, 0, 0]);
    return {
      dir,
      ground,
      shadow: pts(flat(shadowRing)),
      pad: pts(flat(padRing)),
      walls: walls.map(({ points, light }) => ({ points, light })),
      floors,
      roof: { points: pts(flat(ring, h)), light: 0.85 },
      parapet: pts(flat(ring.map(([x, y]): V2 => [x * 0.88, y * 0.88]), h)),
      markers,
      centre: { x: fmt(gx), y: fmt(gy) },
      scale,
    };
  });
}
