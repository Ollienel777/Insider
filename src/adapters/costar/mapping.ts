// Everything the live CoStar adapter assumes about CoStar's data kit, in one
// file: which kit files it reads, which fields of their records, and how they
// map onto `Building` (SPEC §4.1, §4.5). The field names are the kit's own,
// from its `models/` pages and `schemas/`; kit.ts only streams the files.
//
// Taste rule (SPEC §1): only the commercial property and commercial listing
// datasets are read, never location occupancy or company detail (tenants).
// `KIT_FILES` is the complete list of files kit.ts may open, and a test
// proves nothing else is. No tenant or contact field is read from a record.
//
// Licence: no kit record, and nothing derived from one, is ever committed.
// Tests use hand-written, fictional records of the same shape.
import { z } from "zod";
import { AvailableSpace, Building, type City } from "@/domain";

/**
 * The only kit files the adapter may read, relative to `COSTAR_KIT_DIR`:
 * buildings, space for lease or sale, and the join to Matterport models.
 */
export const KIT_FILES = {
  properties: "data/commercial-property.jsonl",
  listings: "data/commercial-listing-summary.jsonl",
  scans: "commercial-properties.csv",
} as const;

export type KitFile = keyof typeof KIT_FILES;

/** A record the mapping cannot read: kit.ts skips it, counts it and logs it. */
export class KitRecordError extends Error {
  constructor(message: string) {
    super(`CoStar kit: ${message}`);
    this.name = "KitRecordError";
  }
}

// ---- enums (schemas/enums.json) ---------------------------------------------

/** `primaryAddress.researchMarketId` of the kit's two markets. */
export const MARKET_CITY: Record<number, City> = { 14: "Houston", 20: "LA" };

/** The property types the game stages (`PropertyType`); the rest (apartments, hotels, land…) are skipped. */
export const KIT_PROPERTY_TYPES = { 5: "office", 6: "retail", 2: "industrial", 7: "flex" } as const;
export type KitPropertyType = (typeof KIT_PROPERTY_TYPES)[keyof typeof KIT_PROPERTY_TYPES];

/** `BuildingClass`: 1 A, 2 B, 3 C. 0 (Unknown) and 4 (F) are not staged. */
const CLASS = { 1: "A", 2: "B", 3: "C" } as const;

/** `ConstructionStatus` 1: the building stands today. */
const EXISTING = 1;
/** `ConstructionEventType` 2: the year built. */
const CONSTRUCTION_COMPLETE = 2;
/** `ListingStatus` 1: on the market now. */
const ACTIVE = 1;

/**
 * A `FloorName` as a floor number, or `null` for a floor the game does not
 * stage (ground, lobby, basement, parking, mezzanine, penthouse…). 24 is the
 * first floor and 25 the second; 26 is the mezzanine, so 27 (third) to 149
 * (125th) are the value less 24.
 */
export function kitFloor(floorName: number): number | null {
  if (floorName === 24) return 1;
  if (floorName === 25) return 2;
  if (floorName >= 27 && floorName <= 149) return floorName - 24;
  return null;
}

// ---- record shapes (only the fields read; every other key is ignored) --------

const KitId = z.union([z.int().positive(), z.string().regex(/^\d+$/)]).transform(String);
const num = z.number().nullish();

const RawAddress = z.object({
  city: z.string().nullish(),
  latitude: num,
  longitude: num,
  researchMarketId: z.int().nullish(),
  streetNumber: z.string().nullish(),
  streetName: z.string().nullish(),
  streetType: z.string().nullish(),
});

const RawProperty = z.object({
  id: KitId,
  propertyType: z.int(),
  constructionStatus: z.int().nullish(),
  buildingClass: z.int().nullish(),
  buildingName: z.string().nullish(),
  rentableBuildingAreaSquareFeet: num,
  grossBuildingAreaSquareFeet: num,
  grossTypicalFloorSquareFeet: num,
  numStoriesAboveGrade: z.int().nullish(),
  constructionEvents: z.array(z.object({ eventType: z.int(), year: z.int().nullish() })).nullish(),
  primaryAddress: RawAddress.nullish(),
});

const RawSpace = z.object({
  id: KitId,
  propertyId: KitId.nullish(),
  floorName: z.int(),
  suite: z.string().nullish(),
  squareFeetMax: num,
  squareFeetMin: num,
  dateOffMarket: z.string().nullish(),
  isLeasePending: z.boolean().nullish(),
  isInventoryOffMarket: z.boolean().nullish(),
});

const RawListing = z.object({
  id: KitId,
  listingStatus: z.int(),
  propertyId: KitId.nullish(),
  forLeaseSummary: z.object({ spaces: z.array(RawSpace).nullish() }).nullish(),
});

/** A record's `id`, or a loud `KitRecordError` when it has none (R1-M2). */
export function kitId(record: unknown, what: string): string {
  const id = (record as { id?: unknown } | null)?.id;
  const parsed = KitId.safeParse(id);
  if (id === undefined || id === null) throw new KitRecordError(`${what} record has no id`);
  if (!parsed.success) throw new KitRecordError(`${what} record has an id that is not a positive integer`);
  return parsed.data;
}

function parse<T>(schema: z.ZodType<T>, record: unknown, what: string): T {
  const result = schema.safeParse(record);
  if (!result.success) {
    // Paths and expectations only: no value from the record reaches the message.
    const issue = result.error.issues[0];
    throw new KitRecordError(`${what} record does not match the kit's schema at ${issue.path.join(".") || "(root)"}: ${issue.code}`);
  }
  return result.data;
}

// ---- listings: space for lease ----------------------------------------------

/** One space of a listing, for the property it sits in. */
export interface ListingSpace {
  propertyId: string;
  space: AvailableSpace;
}

/**
 * The vacant spaces a listing markets now: active lease listings only, with
 * no off-market date and no lease pending, on a numbered floor and with a
 * size. A space with no suite number is named by its space id. Throws
 * `KitRecordError` on a record with no id or of the wrong shape.
 */
export function toListingSpaces(record: unknown): ListingSpace[] {
  kitId(record, "commercial listing");
  const listing = parse(RawListing, record, "commercial listing");
  if (listing.listingStatus !== ACTIVE || !listing.forLeaseSummary) return [];
  const out: ListingSpace[] = [];
  for (const raw of listing.forLeaseSummary.spaces ?? []) {
    if (raw.dateOffMarket || raw.isLeasePending || raw.isInventoryOffMarket) continue;
    const propertyId = raw.propertyId ?? listing.propertyId;
    const floor = kitFloor(raw.floorName);
    const sf = raw.squareFeetMax || raw.squareFeetMin;
    if (!propertyId || floor === null || !sf || sf <= 0) continue;
    const suite = raw.suite?.trim() || `space ${raw.id}`;
    out.push({ propertyId, space: AvailableSpace.parse({ floor, suite, sf }) });
  }
  return out;
}

// ---- the scan join: commercial-properties.csv --------------------------------

/** The columns read from the CSV; `Address`, `City` and `State` are not. */
const SCAN_COLUMNS = ["PropertyId", "MatterportModelId"] as const;

/** The column positions of `PropertyId` and `MatterportModelId`, from the header line. */
export function scanColumns(header: string): [number, number] {
  const names = header.replace(/^﻿/, "").split(",").map((c) => c.trim());
  const [p, m] = SCAN_COLUMNS.map((c) => names.indexOf(c));
  if (p < 0 || m < 0) throw new KitRecordError(`${KIT_FILES.scans} has no ${SCAN_COLUMNS.join(" and ")} header`);
  return [p, m];
}

/**
 * One CSV row as `[propertyId, modelId]`, or `null` for a property with no
 * model (an empty `MatterportModelId`). The kit's CSV has no quoted fields;
 * a row with too few columns or a non-numeric id is a `KitRecordError`.
 */
export function toScan(line: string, [p, m]: [number, number]): [string, string] | null {
  const cells = line.split(",");
  if (cells.length <= Math.max(p, m)) throw new KitRecordError(`${KIT_FILES.scans} row has too few columns`);
  const propertyId = kitId({ id: cells[p].trim() || undefined }, "scan");
  const modelId = cells[m].trim();
  return modelId ? [propertyId, modelId] : null;
}

// ---- properties: the Building -------------------------------------------------

/** Why a well-formed property record is not staged. */
export type SkipReason = "type" | "status" | "market" | "class" | "year" | "stories" | "location" | "area";

/** A staged kit property: its `Building`, and its type for the casting search. */
export interface KitProperty {
  building: Building;
  propertyType: KitPropertyType;
}

export interface KitJoin {
  /** The property's vacant spaces, from the listings. */
  spaces: (propertyId: string) => AvailableSpace[];
  /** The property's Matterport model ids, in CSV order. */
  scans: (propertyId: string) => string[];
}

function streetLine(address: z.infer<typeof RawAddress>): string | null {
  const line = [address.streetNumber, address.streetName, address.streetType].filter((p) => p?.trim()).join(" ");
  return line || null;
}

/**
 * One commercial property record as a staged `Building`, or the reason it is
 * not staged (not an office, retail, industrial or flex building; not
 * standing; outside the two markets; missing class, year, stories, location
 * or area). Throws `KitRecordError` on a record with no id or of the wrong
 * shape.
 */
export function toKitProperty(record: unknown, join: KitJoin): KitProperty | SkipReason {
  const id = kitId(record, "commercial property");
  const raw = parse(RawProperty, record, "commercial property");
  const propertyType = KIT_PROPERTY_TYPES[raw.propertyType as keyof typeof KIT_PROPERTY_TYPES];
  if (!propertyType) return "type";
  if (raw.constructionStatus !== EXISTING) return "status";
  const address = raw.primaryAddress;
  const city = MARKET_CITY[address?.researchMarketId ?? -1];
  if (!address || !city) return "market";
  const buildingClass = CLASS[raw.buildingClass as keyof typeof CLASS];
  if (!buildingClass) return "class";
  const yearBuilt = raw.constructionEvents?.find((e) => e.eventType === CONSTRUCTION_COMPLETE)?.year;
  if (!yearBuilt || yearBuilt < 1800 || yearBuilt > 2100) return "year";
  const stories = raw.numStoriesAboveGrade;
  if (!stories || stories <= 0) return "stories";
  const { latitude: lat, longitude: lng } = address;
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return "location";
  const rbaSf = raw.rentableBuildingAreaSquareFeet || raw.grossBuildingAreaSquareFeet;
  if (!rbaSf || rbaSf <= 0) return "area";
  const typicalFloorSf = raw.grossTypicalFloorSquareFeet && raw.grossTypicalFloorSquareFeet > 0 ? raw.grossTypicalFloorSquareFeet : rbaSf / stories;

  const [matterportModelId] = join.scans(id);
  const building = Building.parse({
    id,
    name: raw.buildingName?.trim() || streetLine(address) || `Property ${id}`,
    city,
    neighbourhood: address.city?.trim() || (city === "LA" ? "Los Angeles" : "Houston"),
    lat,
    lng,
    yearBuilt,
    buildingClass,
    stories,
    rbaSf,
    typicalFloorSf,
    availableSpace: join.spaces(id),
    // Vexcel coverage is not the kit's to say; the Vexcel adapter answers it.
    layers: { costar: true, vexcel: false, matterport: matterportModelId !== undefined },
    ...(matterportModelId && { matterportModelId }),
    source: "costar",
  });
  return { building, propertyType };
}

// ---- which kit buildings the map pins -----------------------------------------

/**
 * Live pins per city on the map. The kit stages a few hundred buildings per
 * city; the map pins the ones a heist can use, bounded so the fixtures stay
 * readable: buildings with a Matterport scan and a floor on the market now,
 * largest vacant floor first (ties by id), at most this many per city.
 * Every staged kit building still opens by id.
 */
export const MAP_LIMIT_PER_CITY = 20;

/** The largest floor's available area, summed over its suites. */
export function largestVacantFloorSf(building: Pick<Building, "availableSpace">): number {
  const perFloor = new Map<number, number>();
  for (const s of building.availableSpace) perFloor.set(s.floor, (perFloor.get(s.floor) ?? 0) + s.sf);
  return Math.max(0, ...perFloor.values());
}

export function mapSelection(buildings: Iterable<Building>, city: City, limit = MAP_LIMIT_PER_CITY): Building[] {
  return [...buildings]
    .filter((b) => b.city === city && b.layers.matterport && b.availableSpace.length > 0)
    .map((b) => ({ b, sf: largestVacantFloorSf(b) }))
    .sort((x, y) => y.sf - x.sf || x.b.id.localeCompare(y.b.id, "en", { numeric: true }))
    .slice(0, limit)
    .map(({ b }) => b);
}
