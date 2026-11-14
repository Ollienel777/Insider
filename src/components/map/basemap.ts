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
