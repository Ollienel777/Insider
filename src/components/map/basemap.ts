// The static basemap per city (SPEC §2 beat 1, §5: no tile server) and the
// projection that places a building's pin on it. basemaps.json holds each
// image's size and the lat/lng bounds it was rendered for; the render script
// (scripts/basemap/render.mjs) reads the same file, so pins and streets agree.
import type { City } from "@/domain";
import basemaps from "./basemaps.json";

export interface Bounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface Basemap {
  /** Public path of the image. */
  file: string;
  width: number;
  height: number;
  bounds: Bounds;
}

export const BASEMAPS: Readonly<Record<City, Basemap>> = basemaps;

/** The attribution every basemap carries: the streets are OpenStreetMap data (ODbL). */
export const ATTRIBUTION = {
  text: "© OpenStreetMap contributors",
  href: "https://www.openstreetmap.org/copyright",
} as const;

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/**
 * Where (`lat`, `lng`) falls on the basemap, as fractions of its width and
 * height from the top-left corner (Web Mercator, as the image was drawn).
 * Values outside 0..1 are off the image.
 */
export function project(bounds: Bounds, lat: number, lng: number): { x: number; y: number } {
  const top = mercatorY(bounds.north);
  return {
    x: (lng - bounds.west) / (bounds.east - bounds.west),
    y: (top - mercatorY(lat)) / (top - mercatorY(bounds.south)),
  };
}

const mercatorSpan = (b: Bounds) => mercatorY(b.north) - mercatorY(b.south);

/** Width over height of `bounds` as drawn in Web Mercator, as the basemaps are. */
export function aspect(bounds: Bounds): number {
  return (((bounds.east - bounds.west) * Math.PI) / 180) / mercatorSpan(bounds);
}

/**
 * The view that shows the whole basemap and every point in `points`: the
 * basemap's own bounds when they all fall on it, else the bounds of both,
 * padded on each widened side by a share of the span, so a pin and its label
 * clear the edge and the map's caption (top) and legend (bottom).
 */
export function fitView(
  basemap: Bounds,
  points: readonly { lat: number; lng: number }[],
  pad: { x: number; top: number; bottom: number } = { x: 0.1, top: 0.2, bottom: 0.14 },
): Bounds {
  const outside = points.filter((p) => p.lng < basemap.west || p.lng > basemap.east || p.lat < basemap.south || p.lat > basemap.north);
  if (outside.length === 0) return basemap;
  const west = Math.min(basemap.west, ...outside.map((p) => p.lng));
  const east = Math.max(basemap.east, ...outside.map((p) => p.lng));
  const south = Math.min(basemap.south, ...outside.map((p) => p.lat));
  const north = Math.max(basemap.north, ...outside.map((p) => p.lat));
  const dx = (east - west) * pad.x;
  const dy = north - south;
  return {
    west: west < basemap.west ? west - dx : west,
    east: east > basemap.east ? east + dx : east,
    south: south < basemap.south ? south - dy * pad.bottom : south,
    north: north > basemap.north ? north + dy * pad.top : north,
  };
}

/** Where `inner` (the basemap image) sits in `view`, as CSS percentages of the view's box. */
export function placeIn(view: Bounds, inner: Bounds): { left: number; top: number; width: number; height: number } {
  const top = project(view, inner.north, inner.west);
  const bottom = project(view, inner.south, inner.east);
  return { left: top.x * 100, top: top.y * 100, width: (bottom.x - top.x) * 100, height: (bottom.y - top.y) * 100 };
}
