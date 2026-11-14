// Everything the live Vexcel adapter assumes about Vexcel's API, in one file:
// the requests it makes and how it reads the answers. live.ts only does
// transport and caching.
//
// The calls are Vexcel API 2.0's (base `https://api.vexcelgroup.com/v2`, the
// key in the `X-API-KEY` header), as Vexcel's public demo pages make them,
// and were checked against the live service on 2026-11-14 (issue 29):
// - `oriented/collections`: which oblique directions the `urban` layer has at
//   a point, newest collection first. Each direction is its own feature, with
//   `product-type` one of `oblique-north`, `-east`, `-south`, `-west`.
// - `ortho/extract`: the ortho clipped to a WKT polygon. A GET with the
//   polygon in the query works (the quickstart POSTs it; the answer is the
//   same image). Without `collection` it serves the newest.
// - `oriented/extract`: one oblique, by collection and direction, cropped
//   around a point.
// Both extracts answer an image (JPEG here) whose size is read from its header.
//
// Imagery is never stored (SPEC §10, open question Q3): live.ts holds the
// bytes in memory and the image route serves them; nothing writes them out.
import { z } from "zod";
import type { Aerial, AerialEntry, LngLat, ViewDir } from "@/domain";

/** Only the `urban` layer has obliques. */
export const LAYER = "urban";

/**
 * Vexcel's oblique `product-type` → our view. Vexcel names an oblique for the
 * way the camera looks: `oriented/query` puts the `oblique-north` cameras
 * about 3 km south of the target. Our views are named for the side the image
 * is taken from (`N` shows the north face), so north and south swap, as do
 * east and west.
 */
export const ORIENTATION: Record<string, Exclude<ViewDir, "ortho">> = {
  "oblique-north": "S",
  "oblique-east": "W",
  "oblique-south": "N",
  "oblique-west": "E",
};

/** A request: a path relative to the API base, and its query. */
export interface VexcelRequest {
  path: string;
  params: URLSearchParams;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** A box in degrees. */
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const wktPoint = ({ lat, lng }: LatLng) => `POINT(${lng} ${lat})`;
const wktBox = ({ west, south, east, north }: Bounds) =>
  `POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`;

/** Which oblique directions the `urban` layer has at a point, newest collection first. */
export function collectionsRequest(at: LatLng): VexcelRequest {
  return {
    path: "oriented/collections",
    params: new URLSearchParams({
      wkt: wktPoint(at),
      srid: "4326",
      layer: LAYER,
      "product-type": "oblique",
      "spatial-operation": "INTERSECT",
      "metadata-format": "JSON",
      include: "collection,layer,product-type,last-capture-date",
      "order-by": "first-capture-date-desc",
      "max-records": "8",
    }),
  };
}

/** The ortho, clipped to `box`. */
export function orthoRequest(box: Bounds): VexcelRequest {
  return {
    path: "ortho/extract",
    params: new URLSearchParams({
      layer: LAYER,
      wkt: wktBox(box),
      srid: "4326",
      zoom: "20",
      bands: "rgb",
      "image-format": "jpeg",
    }),
  };
}

/** One oblique, cropped to `bufferM` metres around the point. */
export function obliqueRequest(oblique: Oblique, at: LatLng, bufferM: number): VexcelRequest {
  return {
    path: "oriented/extract",
    params: new URLSearchParams({
      layer: oblique.layer,
      collection: oblique.collection,
      "product-type": oblique.productType,
      wkt: wktPoint(at),
      srid: "4326",
      "buffer-meter": String(Math.round(bufferM)),
      crop: "bounding_box",
      rotation: "natural",
      downsample: bufferM > 120 ? "2" : "1",
      "image-format": "jpeg",
    }),
  };
}

// ---- reading the answers ------------------------------------------------------

export interface Oblique {
  dir: Exclude<ViewDir, "ortho">;
  layer: string;
  collection: string;
  productType: string;
}

const Collections = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        collection: z.string().min(1),
        layer: z.string().min(1),
        "product-type": z.string(),
      }),
    }),
  ),
});

/**
 * The newest collection's obliques, one per direction. A collection that
 * lacks a direction just has fewer views; directions are never mixed across
 * collections, so every view was flown the same day.
 */
export function toObliques(body: unknown): Oblique[] {
  const { features } = Collections.parse(body);
  const newest = features[0]?.properties.collection;
  const out: Oblique[] = [];
  for (const { properties: p } of features) {
    const dir = ORIENTATION[p["product-type"].toLowerCase()];
    if (p.collection !== newest || !dir || out.some((o) => o.dir === dir)) continue;
    out.push({ dir, layer: p.layer, collection: p.collection, productType: p["product-type"] });
  }
  return out;
}

// ---- framing and placing ------------------------------------------------------

const M_PER_DEG_LAT = 111_132;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** The middle of the footprint's corners. */
export function centreOf(footprint: LngLat[]): LatLng {
  const n = footprint.length;
  return {
    lng: footprint.reduce((s, [x]) => s + x, 0) / n,
    lat: footprint.reduce((s, [, y]) => s + y, 0) / n,
  };
}

/** The ortho's frame: 16:10 like the Scout's, the footprint with a margin round it. */
export function orthoBounds(footprint: LngLat[]): Bounds {
  const { lat, lng } = centreOf(footprint);
  const kx = mPerDegLng(lat);
  const halfW = Math.max(...footprint.map(([x]) => Math.abs(x - lng))) * kx;
  const halfH = Math.max(...footprint.map(([, y]) => Math.abs(y - lat))) * M_PER_DEG_LAT;
  // 60% of margin, at least 40 m across, then widened or heightened to 16:10.
  let w = Math.max(40, halfW * 1.6);
  let h = Math.max(25, halfH * 1.6);
  if (w / h < 1.6) w = h * 1.6;
  else h = w / 1.6;
  return { west: lng - w / kx, east: lng + w / kx, south: lat - h / M_PER_DEG_LAT, north: lat + h / M_PER_DEG_LAT };
}

/**
 * How far round the building's middle an oblique is cropped: the footprint,
 * plus the building's height (an oblique leans the roof out by about that
 * much), plus a margin.
 */
export function obliqueBufferM(aerial: Pick<Aerial, "footprint" | "heightM">): number {
  const { lat, lng } = centreOf(aerial.footprint);
  const kx = mPerDegLng(lat);
  const reach = Math.max(...aerial.footprint.map(([x, y]) => Math.hypot((x - lng) * kx, (y - lat) * M_PER_DEG_LAT)));
  return Math.min(250, Math.max(60, reach + aerial.heightM * 0.8 + 15));
}

/** A ground point's pixel on the ortho of `box`, `null` when it falls outside. */
export function orthoPixel([lng, lat]: LngLat, box: Bounds, size: { width: number; height: number }) {
  const x = ((lng - box.west) / (box.east - box.west)) * size.width;
  const y = ((box.north - lat) / (box.north - box.south)) * size.height;
  if (!(x >= 0 && y >= 0 && x <= size.width && y <= size.height)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * The hand-placed entries, pinned to pixels on the live ortho. Each entry's
 * `at` anchor is where it was placed by hand on the building; on the
 * north-up ortho that point has exactly one pixel. An entry with no anchor,
 * or one that falls off the image, cannot be drawn: it is dropped and logged,
 * and the rest of the aerial still answers.
 */
export function placeOnOrtho(
  entries: AerialEntry[],
  box: Bounds,
  size: { width: number; height: number },
  warn: (message: string) => void = console.warn,
): AerialEntry[] {
  const out: AerialEntry[] = [];
  for (const entry of entries) {
    const pixel = entry.at ? orthoPixel(entry.at.lngLat, box, size) : null;
    if (!pixel) {
      warn(`Vexcel: entry "${entry.id}" dropped (${entry.at ? "off the ortho" : "no anchor to place it by"})`);
      continue;
    }
    out.push({ ...entry, view: "ortho", ...pixel });
  }
  return out;
}
