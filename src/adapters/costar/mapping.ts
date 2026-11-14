// Everything the live CoStar adapter assumes about CoStar's API, in one file.
//
// Open question Q1 (SPEC §11) is unanswered: which fields the event toolkit
// exposes, and whether through OpenAPI or MCP. Every endpoint path, query
// parameter, field name and response envelope below is therefore a guess
// shaped like a typical REST property API. When Q1 is answered (#2), this is
// the file to change; live.ts only does transport.
//
// Taste rule (SPEC §1): no tenant field is ever requested. `REQUESTED_FIELDS`
// is the complete list sent to CoStar, and a test checks it.
import { z } from "zod";
import { AvailableSpace, Building, type City } from "@/domain";

/**
 * The only kit files the casting search may read, relative to
 * `COSTAR_KIT_DIR`: buildings, space for lease or sale, and the join to
 * Matterport models. Unverified: the paths are SPEC §4.5's, never checked
 * against a kit, and their fields are not pinned until the kit's `schemas/`
 * are read (#2). Nothing reads them yet.
 */
export const KIT_FILES = {
  properties: "data/commercial-property.jsonl",
  listings: "data/commercial-listing-summary.jsonl",
  scans: "commercial-properties.csv",
} as const;

/** Request paths, relative to `COSTAR_API_BASE`. */
export const ENDPOINTS = {
  properties: "/properties",
  property: (id: string) => `/properties/${encodeURIComponent(id)}`,
  spaces: (id: string) => `/properties/${encodeURIComponent(id)}/spaces`,
} as const;

/** How each game city is named in a CoStar query. */
export const CITY_QUERY: Record<City, { city: string; state: string }> = {
  LA: { city: "Los Angeles", state: "CA" },
  Houston: { city: "Houston", state: "TX" },
};

/** The property fields requested, and nothing else. */
export const REQUESTED_FIELDS = [
  "propertyId",
  "propertyName",
  "city",
  "submarket",
  "latitude",
  "longitude",
  "yearBuilt",
  "buildingClass",
  "numberOfStories",
  "rentableBuildingArea",
  "typicalFloorSize",
] as const;

/** The space fields requested; only spaces whose status is available. */
export const REQUESTED_SPACE_FIELDS = ["floor", "suite", "availableSf"] as const;
export const SPACE_STATUS = "available";

/** Query parameters for each request. */
export function propertyQuery(city?: City): URLSearchParams {
  const params = new URLSearchParams({ fields: REQUESTED_FIELDS.join(","), propertyType: "office" });
  if (city) {
    params.set("city", CITY_QUERY[city].city);
    params.set("state", CITY_QUERY[city].state);
  }
  return params;
}

export function spaceQuery(): URLSearchParams {
  return new URLSearchParams({ fields: REQUESTED_SPACE_FIELDS.join(","), status: SPACE_STATUS });
}

// ---- response shapes (guessed; see the header) ------------------------------

const num = z.coerce.number();

const RawProperty = z.object({
  propertyId: z.union([z.string(), z.number()]).transform(String),
  propertyName: z.string().min(1),
  city: z.string(),
  submarket: z.string().min(1),
  latitude: num,
  longitude: num,
  yearBuilt: num,
  buildingClass: z.string(),
  numberOfStories: num,
  rentableBuildingArea: num,
  typicalFloorSize: num,
});

const RawSpace = z.object({
  floor: z.union([z.string(), z.number()]),
  suite: z.union([z.string(), z.number()]).transform(String),
  availableSf: num,
});

/** A list response: `{ items: [...] }`, or a bare array. */
export function unwrapList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const items = (body as { items?: unknown } | null)?.items;
  if (Array.isArray(items)) return items;
  throw new Error("CoStar: expected a list response (an array, or { items: [...] })");
}

/** A single-record response: `{ item: {...} }`, or the bare record. */
export function unwrapItem(body: unknown): unknown {
  const item = (body as { item?: unknown } | null)?.item;
  return item ?? body;
}

function toCity(name: string): City {
  const match = (Object.keys(CITY_QUERY) as City[]).find(
    (city) => CITY_QUERY[city].city.toLowerCase() === name.trim().toLowerCase(),
  );
  if (!match) throw new Error(`CoStar: city "${name}" is not one the game stages`);
  return match;
}

/**
 * Available spaces, mapped. A row whose floor is not a whole number (for
 * example "LL" or "Ground") is dropped, since the game stages numbered floors.
 */
export function toAvailableSpace(rows: unknown[]): AvailableSpace[] {
  const spaces: AvailableSpace[] = [];
  for (const row of rows) {
    const raw = RawSpace.parse(row);
    const floor = Number(raw.floor);
    if (!Number.isInteger(floor)) continue;
    spaces.push(AvailableSpace.parse({ floor, suite: raw.suite, sf: raw.availableSf }));
  }
  return spaces;
}

/** One CoStar property, plus its available spaces, as a `Building`. */
export function toBuilding(property: unknown, spaces: unknown[]): Building {
  const raw = RawProperty.parse(property);
  return Building.parse({
    id: raw.propertyId,
    name: raw.propertyName,
    city: toCity(raw.city),
    neighbourhood: raw.submarket,
    lat: raw.latitude,
    lng: raw.longitude,
    yearBuilt: raw.yearBuilt,
    buildingClass: raw.buildingClass.trim().toUpperCase(),
    stories: raw.numberOfStories,
    rbaSf: raw.rentableBuildingArea,
    typicalFloorSf: raw.typicalFloorSize,
    availableSpace: toAvailableSpace(spaces),
    // Whether Vexcel and Matterport cover the building is not CoStar's to
    // say; those adapters answer it, so a live record claims only its own.
    layers: { costar: true, vexcel: false, matterport: false },
    source: "costar",
  });
}
