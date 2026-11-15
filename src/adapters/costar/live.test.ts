// The live CoStar adapter on a fictional data kit (test-kit.ts): the mapping,
// the reader, and the taste rule that the tenant files are never opened.
// Every record here is hand-written; none comes from the real kit.
import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every file the reader opens, recorded (the taste rule's proof).
const opened = vi.hoisted(() => [] as string[]);
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const open = (async (file: string, ...rest: unknown[]) => {
    opened.push(String(file));
    return (real.open as (...a: unknown[]) => unknown)(file, ...rest);
  }) as typeof real.open;
  return { ...real, default: { ...real, open }, open };
});

import { loadKitIndex } from "./kit";
import { CoStarNotConfiguredError, createLiveCoStar } from "./live";
import { KIT_FILES, KitRecordError, kitFloor, kitId, mapSelection, toKitProperty, toListingSpaces, toScan } from "./mapping";
import { fictionalListing, fictionalProperty, smallFictionalKit, writeFictionalKit } from "./test-kit";

const dirs: string[] = [];
const kit = (dir: string) => (dirs.push(dir), dir);
const quiet = { warn: () => {} };

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  opened.length = 0;
  vi.restoreAllMocks();
});

const none = { spaces: () => [], scans: () => [] };

describe("mapping.ts", () => {
  it("maps a property, its vacant spaces and its first scan onto Building, marked costar", () => {
    const mapped = toKitProperty(fictionalProperty(900001), {
      spaces: () => [{ floor: 6, suite: "600", sf: 2410 }],
      scans: () => ["mpTestAAAA001", "mpTestAAAA002"],
    });
    expect(mapped).toEqual({
      propertyType: "office",
      building: {
        id: "900001",
        name: "Testwood Tower 900001",
        city: "LA",
        neighbourhood: "Testville",
        lat: 34.0512,
        lng: -118.2533,
        yearBuilt: 1981,
        buildingClass: "B",
        stories: 15,
        rbaSf: 182340,
        typicalFloorSf: 12160,
        availableSpace: [{ floor: 6, suite: "600", sf: 2410 }],
        layers: { costar: true, vexcel: false, matterport: true },
        matterportModelId: "mpTestAAAA001",
        source: "costar",
      },
    });
  });

  it("names a building with no name by its street, and has no scan without a model", () => {
    const mapped = toKitProperty(fictionalProperty(900002, { buildingName: " " }), none);
    expect(mapped).toMatchObject({ building: { name: "100 Example St", layers: { matterport: false } } });
    expect(typeof mapped !== "string" && "matterportModelId" in mapped.building).toBe(false);
  });

  it("falls back to RBA over stories for a missing typical floor, and GBA for a missing RBA", () => {
    const mapped = toKitProperty(fictionalProperty(1, { grossTypicalFloorSquareFeet: null, rentableBuildingAreaSquareFeet: null }), none);
    expect(mapped).toMatchObject({ building: { rbaSf: 190120, typicalFloorSf: 190120 / 15 } });
  });

  it("says why a well-formed property is not staged", () => {
    const skip = (o: Record<string, unknown>) => toKitProperty(fictionalProperty(1, o), none);
    expect(skip({ propertyType: 11 })).toBe("type");
    expect(skip({ constructionStatus: 3 })).toBe("status");
    expect(skip({ primaryAddress: { researchMarketId: 99, latitude: 1, longitude: 1 } })).toBe("market");
    expect(skip({ buildingClass: 4 })).toBe("class");
    expect(skip({ constructionEvents: [{ eventType: 1, year: 1990 }] })).toBe("year");
    expect(skip({ numStoriesAboveGrade: null })).toBe("stories");
    expect(skip({ primaryAddress: { researchMarketId: 14, latitude: null, longitude: -95 } })).toBe("location");
    expect(skip({ rentableBuildingAreaSquareFeet: null, grossBuildingAreaSquareFeet: null })).toBe("area");
  });

  it("fails loudly on a record with no id, or of the wrong shape (R1-M2)", () => {
    const noId = { ...fictionalProperty(1), id: undefined };
    expect(() => toKitProperty(noId, none)).toThrow(new KitRecordError("commercial property record has no id"));
    expect(() => kitId({ id: "x9" }, "scan")).toThrow(KitRecordError);
    expect(() => toKitProperty(fictionalProperty(1, { numStoriesAboveGrade: "tall" }), none)).toThrow(/numStoriesAboveGrade/);
    expect(() => toListingSpaces({ listingStatus: 1 })).toThrow("commercial listing record has no id");
  });

  it("reads numbered floors from FloorName, and nothing else", () => {
    expect([24, 25, 27, 30, 149].map(kitFloor)).toEqual([1, 2, 3, 6, 125]);
    expect([0, 14, 22, 23, 26, 150].map(kitFloor)).toEqual([null, null, null, null, null, null]);
  });

  it("takes vacant space only from active lease listings: on the market, not pending, on a numbered floor", () => {
    const listing = fictionalListing(1, 42, [
      {},
      { suite: null, id: 555 },
      { dateOffMarket: "2026-01-01T00:00:00Z" },
      { isLeasePending: true },
      { floorName: 23 },
      { squareFeetMax: 0 },
      { propertyId: 43, floorName: 27, suite: "300" },
    ]);
    expect(toListingSpaces(listing)).toEqual([
      { propertyId: "42", space: { floor: 6, suite: "600", sf: 2410 } },
      // A space with no suite name is never named by its kit id: the reader numbers it on its floor.
      { propertyId: "42", space: { floor: 6, suite: "unnamed space", sf: 2410 } },
      { propertyId: "43", space: { floor: 3, suite: "300", sf: 2410 } },
    ]);
    expect(toListingSpaces({ ...listing, listingStatus: 3 })).toEqual([]);
    expect(toListingSpaces({ ...listing, forLeaseSummary: null })).toEqual([]);
  });

  it("reads PropertyId and MatterportModelId from a CSV row by header position", () => {
    expect(toScan("12,mpTest1,1 Example St,Testville,CA", [0, 1])).toEqual(["12", "mpTest1"]);
    expect(toScan("12,,1 Example St,Testville,CA", [0, 1])).toBeNull();
    expect(() => toScan("12", [0, 1])).toThrow(KitRecordError);
  });

  it("pins only scanned buildings with a vacant floor, largest floor first, capped per city", () => {
    const b = (id: string, sf: number, matterport = true, city = "LA") =>
      ({ id, city, layers: { costar: true, vexcel: false, matterport }, availableSpace: sf ? [{ floor: 3, suite: "1", sf }, { floor: 3, suite: "2", sf }] : [] }) as never;
    const picked = mapSelection([b("5", 100), b("2", 900), b("3", 900), b("4", 0), b("6", 5000, false), b("7", 999, true, "Houston")], "LA", undefined, 2);
    expect(picked.map((x: { id: string }) => x.id)).toEqual(["2", "3"]);
  });

  it("pins only inside the map's area", () => {
    const at = (id: string, lat: number, lng: number) =>
      ({ id, city: "LA", lat, lng, layers: { costar: true, vexcel: false, matterport: true }, availableSpace: [{ floor: 3, suite: "1", sf: 900 }] }) as never;
    const area = { west: -118.3, east: -118.2, south: 34.0, north: 34.1 };
    const picked = mapSelection([at("1", 34.05, -118.25), at("2", 34.2, -118.25), at("3", 34.05, -118.1)], "LA", area);
    expect(picked.map((x: { id: string }) => x.id)).toEqual(["1"]);
  });
});

describe("the kit reader", () => {
  it("indexes the kit once: buildings joined to their spaces and scans", async () => {
    const index = await loadKitIndex(kit(smallFictionalKit()), quiet);
    expect([...index.properties.keys()].sort()).toEqual(["900001", "900002", "900004"]);
    const a = index.properties.get("900001")!.building;
    expect(a.availableSpace).toEqual([
      { floor: 6, suite: "600", sf: 2410 },
      { floor: 7, suite: "701", sf: 5120 },
    ]);
    expect(a.matterportModelId).toBe("mpTestAAAA001");
    expect(index.properties.get("900004")!.building).toMatchObject({ city: "Houston", buildingClass: "A", availableSpace: [{ floor: 20, suite: "unnamed space 1" }] });
    // No kit space id names a space anywhere in the index.
    for (const { building } of index.properties.values()) for (const s of building.availableSpace) expect(s.suite).not.toMatch(/\d{5,}/);
    expect(index.stats).toMatchObject({ records: 4, indexed: 3, skipped: { type: 1 }, spaces: 3, scanned: 3 });
  });

  it("never opens location occupancy or company detail: only the three KIT_FILES", async () => {
    const dir = kit(smallFictionalKit());
    await loadKitIndex(dir, quiet);
    const relative = opened.map((f) => path.relative(dir, f).split(path.sep).join("/"));
    expect(relative.sort()).toEqual(Object.values(KIT_FILES).sort());
    expect(relative.some((f) => /location-occupancy|company-detail/.test(f))).toBe(false);
  });

  it("skips, counts and logs malformed records without their content, and keeps going", async () => {
    const dir = kit(
      writeFictionalKit({
        properties: [fictionalProperty(1), '{"id": 2, "propertyType": broken', fictionalProperty(3, { id: undefined }), fictionalProperty(4)],
        listings: ["not json", fictionalListing(9, 4, [{}])],
        scans: [[1, "mpTestA"], "nope,mpTestB", [4, "mpTestD"]],
      }),
    );
    const warn = vi.fn();
    const index = await loadKitIndex(dir, { warn });
    expect([...index.properties.keys()]).toEqual(["1", "4"]);
    expect(index.properties.get("4")!.building.availableSpace).toHaveLength(1);
    expect(index.stats.malformed).toEqual({ properties: 2, listings: 1, scans: 1 });
    const lines = warn.mock.calls.map(([m]) => String(m));
    expect(lines).toHaveLength(4);
    expect(lines).toContain(`CoStar kit: skipped ${KIT_FILES.properties} line 2 (invalid JSON)`);
    expect(lines.some((l) => l.includes("line 3") && l.includes("has no id"))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/broken|nope|not json/);
  });

  it("rejects when the kit directory is missing", async () => {
    await expect(loadKitIndex(path.join(kit(smallFictionalKit()), "missing"), quiet)).rejects.toThrow(/ENOENT/);
  });
});

describe("the live adapter", () => {
  it("refuses to start without COSTAR_KIT_DIR", () => {
    expect(() => createLiveCoStar({})).toThrow(CoStarNotConfiguredError);
    expect(() => createLiveCoStar({})).toThrow("COSTAR_KIT_DIR missing");
  });

  it("loads the kit once, lazily, for every call and both cities", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const dir = kit(smallFictionalKit());
    const load = vi.fn((d: string) => loadKitIndex(d, quiet));
    const costar = createLiveCoStar({ kitDir: dir, load });
    expect(load).not.toHaveBeenCalled();
    expect(costar.cached("900001")).toBeNull();
    const [la, houston] = await Promise.all([costar.listBuildings("LA"), costar.listBuildings("Houston")]);
    expect(la.map((b) => b.id)).toEqual(["900001"]); // 900002 has a scan but nothing on the market
    expect(houston.map((b) => b.id)).toEqual(["900004"]);
    expect((await costar.getBuilding("900002"))?.name).toBe("100 Example St");
    expect(await costar.getBuilding("F1")).toBeNull();
    expect(await costar.getAvailableSpace("900004")).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(costar.cached("900001")?.id).toBe("900001");
  });

  it("hands out copies, and retries a load that failed", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const dir = kit(smallFictionalKit());
    let fail = true;
    const costar = createLiveCoStar({
      kitDir: dir,
      load: (d) => (fail ? Promise.reject(new Error("kit unreadable")) : loadKitIndex(d, quiet)),
    });
    await expect(costar.listBuildings("LA")).rejects.toThrow("kit unreadable");
    fail = false;
    (await costar.getBuilding("900001"))!.availableSpace.length = 0;
    expect((await costar.getBuilding("900001"))!.availableSpace).toHaveLength(2);
  });
});
