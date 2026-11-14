// A fictional CoStar data kit for tests: hand-written records in the kit's
// shape (field names from its `models/` pages), with invented names, ids and
// numbers. No record here comes from, or is derived from, the real kit.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** An office property record, fictional, with the fields mapping.ts reads and a few it ignores. */
export function fictionalProperty(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    propertyType: 5,
    propertySubtype: 0,
    buildingClass: 2,
    constructionStatus: 1,
    buildingName: `Testwood Tower ${id}`,
    rentableBuildingAreaSquareFeet: 182340,
    grossBuildingAreaSquareFeet: 190120,
    grossTypicalFloorSquareFeet: 12160,
    numStoriesAboveGrade: 15,
    constructionEvents: [
      { eventType: 1, year: 1979, month: null },
      { eventType: 2, year: 1981, month: 6 },
    ],
    primaryAddress: {
      id: id * 10,
      city: "Testville",
      latitude: 34.0512,
      longitude: -118.2533,
      researchMarketId: 20,
      streetNumber: "100",
      streetName: "Example",
      streetType: "St",
    },
    contacts: [{ name: "Not Read" }],
    attachments: [],
    ...overrides,
  };
}

/** An active lease listing on `propertyId`, fictional. */
export function fictionalListing(id: number, propertyId: number, spaces: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return {
    id,
    listingType: 14,
    listingStatus: 1,
    propertyId,
    listingContacts: [{ name: "Not Read" }],
    forLeaseSummary: {
      spaceCount: spaces.length,
      spaces: spaces.map((s, i) => ({
        id: id * 100 + i,
        propertyId,
        floorName: 30, // the sixth floor
        suite: `6${String(i).padStart(2, "0")}`,
        squareFeetMax: 2410,
        dateOffMarket: null,
        isLeasePending: false,
        ...s,
      })),
    },
    ...overrides,
  };
}

export interface FictionalKit {
  properties: (Record<string, unknown> | string)[];
  listings: (Record<string, unknown> | string)[];
  /** `[PropertyId, MatterportModelId]` rows; a string is written as a raw line. */
  scans: ([number | string, string] | string)[];
}

const line = (r: Record<string, unknown> | string) => (typeof r === "string" ? r : JSON.stringify(r));

/**
 * Writes `kit` to a new temporary directory, laid out as the real kit is,
 * including the two tenant files the adapter must never open.
 */
export function writeFictionalKit(kit: FictionalKit): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "heist-kit-"));
  mkdirSync(path.join(dir, "data"));
  writeFileSync(path.join(dir, "data", "commercial-property.jsonl"), kit.properties.map(line).join("\n") + "\n");
  writeFileSync(path.join(dir, "data", "commercial-listing-summary.jsonl"), kit.listings.map(line).join("\r\n") + "\r\n");
  const rows = kit.scans.map((r) => (typeof r === "string" ? r : `${r[0]},${r[1]},1 Example St,Testville,CA`));
  writeFileSync(path.join(dir, "commercial-properties.csv"), ["PropertyId,MatterportModelId,Address,City,State", ...rows].join("\n") + "\n");
  writeFileSync(path.join(dir, "data", "location-occupancy.jsonl"), '{"id":1,"propertyId":900001}\n');
  writeFileSync(path.join(dir, "data", "company-detail.jsonl"), '{"id":1}\n');
  return dir;
}

/**
 * The kit building the recorded kit path plays (#95): a fictional LA office,
 * built 1968, Class B, twelve stories, two suites free on floor 6 and one on
 * floor 9, with a fictional scan id. Its level is the Level Builder's
 * recorded run, fixtures/llm/scripts/builder-900101-romaine-1974.json.
 */
export const SMOKE_KIT_BUILDING = "900101";

/** A kit holding only `SMOKE_KIT_BUILDING`, for the smoke server (`HEIST_TEST_KIT=1`) and the tests. */
export function smokeFictionalKit(): string {
  const id = Number(SMOKE_KIT_BUILDING);
  return writeFictionalKit({
    properties: [
      fictionalProperty(id, {
        buildingClass: 2,
        buildingName: "Testwood Exchange",
        numStoriesAboveGrade: 12,
        constructionEvents: [{ eventType: 2, year: 1968, month: 3 }],
        primaryAddress: {
          id: id * 10,
          city: "Testville",
          latitude: 34.0489,
          longitude: -118.2551,
          researchMarketId: 20,
          streetNumber: "200",
          streetName: "Example",
          streetType: "Ave",
        },
      }),
    ],
    listings: [
      fictionalListing(700101, id, [
        { floorName: 30, suite: "610", squareFeetMax: 6200 },
        { floorName: 30, suite: "640", squareFeetMax: 4100 },
        { floorName: 33, suite: "905", squareFeetMax: 2300 },
      ]),
    ],
    scans: [[id, "mpTestEEEE001"]],
  });
}

/** A small kit: three LA offices and one Houston one, two of them pinnable. */
export function smallFictionalKit(): string {
  return writeFictionalKit({
    properties: [
      fictionalProperty(900001),
      fictionalProperty(900002, { buildingName: null }),
      fictionalProperty(900003, { propertyType: 11 }), // apartments: not staged
      fictionalProperty(900004, {
        buildingClass: 1,
        primaryAddress: { city: "Testburg", latitude: 29.7581, longitude: -95.3672, researchMarketId: 14 },
      }),
    ],
    listings: [
      fictionalListing(700001, 900001, [{}, { floorName: 31, suite: "701", squareFeetMax: 5120 }]),
      fictionalListing(700004, 900004, [{ floorName: 44, suite: null }]),
    ],
    scans: [
      [900001, "mpTestAAAA001"],
      [900001, "mpTestAAAA002"],
      [900002, "mpTestBBBB001"],
      [900003, ""],
      [900004, "mpTestDDDD001"],
    ],
  });
}
