// Everything the live Vexcel adapter assumes about Vexcel's API, in one file.
//
// Open question Q3 (SPEC §11) is unanswered: what the event's Vexcel keys
// include (obliques, ortho, entry detection). Every path, query parameter,
// field name and orientation name below is therefore a guess shaped like a
// typical aerial-imagery API. When Q3 is answered, this is the file to
// change; live.ts only does transport.
//
// Imagery is never stored in the repo (SPEC §10): the live adapter passes the
// image URLs Vexcel returns through, and nothing here writes them to disk.
import { z } from "zod";
import { Aerial, type AerialEntry, type AerialView, type EntryKind, type LngLat, type ViewDir } from "@/domain";

/** The request path, relative to `VEXCEL_API_BASE`. */
export const ENDPOINT = "/aerial";

/**
 * Vexcel's orientation name → our view. Ours are named for the side the
 * image is taken from (`N` shows the north face). If Vexcel names an oblique
 * for the direction the camera looks instead, swap north with south and east
 * with west here, and nowhere else.
 */
export const ORIENTATION: Record<string, ViewDir> = {
  north: "N",
  east: "E",
  south: "S",
  west: "W",
  nadir: "ortho",
};

/** Vexcel's entry type → our kind; anything unlisted is a service door. */
export const ENTRY_KIND: Record<string, EntryKind> = {
  loading_dock: "dock",
  parking_entrance: "garage",
  main_entrance: "lobby",
  roof_access: "roof",
};

/** Query parameters: a point, and the views wanted. */
export function aerialQuery(at: { lat: number; lng: number }): URLSearchParams {
  return new URLSearchParams({
    lat: String(at.lat),
    lng: String(at.lng),
    views: Object.keys(ORIENTATION).join(","),
    entries: "true",
  });
}

// ---- response shape (guessed; see the header) --------------------------------

const num = z.coerce.number();

const RawImage = z.object({
  orientation: z.string(),
  url: z.string().min(1),
  width: num.pipe(z.int().positive()),
  height: num.pipe(z.int().positive()),
});

const RawEntry = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  type: z.string(),
  label: z.string().min(1),
  orientation: z.string(),
  pixel: z.object({ x: num, y: num }),
  note: z.string().default(""),
});

const RawAerial = z.object({
  images: z.array(RawImage),
  /** A GeoJSON Polygon; its outer ring is the footprint. */
  footprint: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([num, num]))).min(1) }),
  heightM: num,
  entries: z.array(RawEntry).default([]),
});

/** Maps a Vexcel response onto `Aerial`; throws, naming the field, when it does not fit. */
export function toAerial(body: unknown): Aerial {
  const raw = RawAerial.parse(body);

  const views: AerialView[] = [];
  for (const image of raw.images) {
    const dir = ORIENTATION[image.orientation.toLowerCase()];
    if (dir && !views.some((v) => v.dir === dir)) {
      views.push({ dir, url: image.url, width: image.width, height: image.height });
    }
  }

  // An entry on a view we did not keep has nowhere to be drawn, so it is dropped.
  const entries: AerialEntry[] = [];
  for (const entry of raw.entries) {
    const view = ORIENTATION[entry.orientation.toLowerCase()];
    if (!view || !views.some((v) => v.dir === view)) continue;
    entries.push({
      id: entry.id,
      kind: ENTRY_KIND[entry.type.toLowerCase()] ?? "service",
      label: entry.label,
      view,
      x: entry.pixel.x,
      y: entry.pixel.y,
      note: entry.note,
    });
  }

  // GeoJSON closes a ring by repeating its first point; the footprint does not.
  const ring: LngLat[] = raw.footprint.coordinates[0].map(([lng, lat]) => [lng, lat]);
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();

  return Aerial.parse({ views, entries, footprint: ring, heightM: raw.heightM, source: "vexcel" });
}
