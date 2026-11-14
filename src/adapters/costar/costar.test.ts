import { rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Building } from "@/domain";
import raw from "../../../fixtures/costar/buildings.json";
import { FIXTURE_BUILDINGS, createFakeCoStar } from "./fake";
import { getCoStar, resetCoStar, selectCoStar } from "./index";
import { SMOKE_KIT_BUILDING, smallFictionalKit } from "./test-kit";

// SPEC §7's table of fixture buildings.
const TABLE = [
  ["F1", "Halvorsen Tower", "LA", "Bunker Hill", 1974, "A", 42],
  ["F2", "Figueroa Exchange", "LA", "Financial District", 1989, "B", 52],
  ["F3", "Meridian on Wilshire", "LA", "Westlake", 2017, "A", 30],
  ["F4", "Smith Street Center", "Houston", "Downtown", 1983, "A", 50],
  ["F5", "Westchase Commons", "Houston", "Westchase", 2008, "B", 6],
] as const;

// Generous boxes around each metro, to catch a swapped or mistyped coordinate.
const BOUNDS = {
  LA: { lat: [33.7, 34.35], lng: [-118.7, -117.9] },
  Houston: { lat: [29.5, 30.1], lng: [-95.8, -95.0] },
} as const;

describe("fixtures/costar/buildings.json", () => {
  it("validates, record by record, against the Building schema", () => {
    expect(Array.isArray(raw)).toBe(true);
    for (const record of raw) {
      const result = Building.safeParse(record);
      expect(result.error?.issues ?? [], JSON.stringify(record).slice(0, 40)).toEqual([]);
    }
  });

  it("holds exactly the five buildings of SPEC §7, each marked as a fixture", () => {
    expect(
      FIXTURE_BUILDINGS.map((b) => [b.id, b.name, b.city, b.neighbourhood, b.yearBuilt, b.buildingClass, b.stories]),
    ).toEqual(TABLE);
    for (const b of FIXTURE_BUILDINGS) {
      expect(b.source).toBe("fixture");
      expect(b.layers).toEqual({ costar: true, vexcel: true, matterport: true });
    }
  });

  describe.each(TABLE.map(([id]) => id))("%s", (id) => {
    const b = FIXTURE_BUILDINGS.find((x) => x.id === id)!;

    it("sits inside its city", () => {
      const box = BOUNDS[b.city];
      expect(b.lat).toBeGreaterThan(box.lat[0]);
      expect(b.lat).toBeLessThan(box.lat[1]);
      expect(b.lng).toBeGreaterThan(box.lng[0]);
      expect(b.lng).toBeLessThan(box.lng[1]);
    });

    it("has areas that are not round placeholders and add up", () => {
      expect(b.rbaSf % 1000).not.toBe(0);
      expect(b.typicalFloorSf % 100).not.toBe(0);
      // Rentable area is close to plate × stories (lobby and mechanical floors
      // take a little off).
      const ratio = b.rbaSf / (b.typicalFloorSf * b.stories);
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThanOrEqual(1);
    });

    it("has plausible available suites", () => {
      expect(b.availableSpace.length).toBeGreaterThanOrEqual(3);
      const suites = b.availableSpace.map((s) => s.suite);
      expect(new Set(suites).size).toBe(suites.length);
      const perFloor = new Map<number, number>();
      for (const s of b.availableSpace) {
        // Suite numbers carry the floor: floor 22 → 22xx, floor 1 → 1xx.
        expect(s.suite).toMatch(new RegExp(`^${s.floor}\\d{2}$`));
        expect(s.floor).toBeGreaterThanOrEqual(1);
        expect(s.floor).toBeLessThanOrEqual(b.stories);
        expect(Number.isInteger(s.sf)).toBe(true);
        expect(s.sf % 100, `suite ${s.suite} is ${s.sf} sf`).not.toBe(0);
        expect(s.sf).toBeGreaterThan(1000);
        perFloor.set(s.floor, (perFloor.get(s.floor) ?? 0) + s.sf);
      }
      for (const [floor, sf] of perFloor) {
        expect(sf, `floor ${floor}`).toBeLessThan(b.typicalFloorSf);
      }
    });
  });

  it("F1 has floor 22 mostly available, suites 2202–2210, and scattered suites elsewhere", () => {
    const f1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
    const floor22 = f1.availableSpace.filter((s) => s.floor === 22);
    expect(floor22.map((s) => s.suite)).toEqual(
      ["2202", "2203", "2204", "2205", "2206", "2207", "2208", "2209", "2210"],
    );
    const area22 = floor22.reduce((sum, s) => sum + s.sf, 0);
    expect(area22 / f1.typicalFloorSf).toBeGreaterThan(0.5);

    const elsewhere = f1.availableSpace.filter((s) => s.floor !== 22);
    expect(new Set(elsewhere.map((s) => s.floor)).size).toBeGreaterThanOrEqual(3);
    // The rules table stages the floor with the most available area (SPEC §4.3).
    for (const floor of new Set(elsewhere.map((s) => s.floor))) {
      const area = elsewhere.filter((s) => s.floor === floor).reduce((sum, s) => sum + s.sf, 0);
      expect(area, `floor ${floor}`).toBeLessThan(area22);
    }
  });
});

describe("the fake adapter", () => {
  const costar = createFakeCoStar();

  it("lists F1–F3 for LA and F4–F5 for Houston", async () => {
    expect((await costar.listBuildings("LA")).map((b) => b.id)).toEqual(["F1", "F2", "F3"]);
    expect((await costar.listBuildings("Houston")).map((b) => b.id)).toEqual(["F4", "F5"]);
  });

  it("gets a building and its available space by id, and null for an unknown id", async () => {
    const f1 = await costar.getBuilding("F1");
    expect(f1?.name).toBe("Halvorsen Tower");
    expect(await costar.getAvailableSpace("F1")).toEqual(f1?.availableSpace);
    expect(await costar.getBuilding("F9")).toBeNull();
    expect(await costar.getAvailableSpace("F9")).toBeNull();
  });

  it("hands out copies, so a caller cannot change the fixtures", async () => {
    const f1 = await costar.getBuilding("F1");
    f1!.availableSpace.length = 0;
    (await costar.getAvailableSpace("F1"))!.pop();
    expect((await costar.getBuilding("F1"))?.availableSpace).toHaveLength(13);
  });
});

describe("selectCoStar (the mode switch)", () => {
  const KIT = { COSTAR_KIT_DIR: "/kits/costar-test" };

  it("is fake with an empty environment", () => {
    const s = selectCoStar({});
    expect(s.mode).toBe("fake");
    expect(s.reason).toBe("CoStar: fixtures (fake mode)");
  });

  it("is fake when COSTAR_MODE is fake, even with a kit and HEIST_MODE=live", () => {
    const s = selectCoStar({ ...KIT, HEIST_MODE: "live", COSTAR_MODE: "fake" });
    expect(s.mode).toBe("fake");
  });

  it("falls back to fake when COSTAR_MODE is live but COSTAR_KIT_DIR is missing, and says why", async () => {
    const s = selectCoStar({ COSTAR_MODE: "live" });
    expect(s.mode).toBe("fake");
    expect(s.reason).toBe("CoStar: fixtures (live mode, but COSTAR_KIT_DIR not set)");
    expect((await s.adapter.listBuildings("LA")).map((b) => b.id)).toEqual(["F1", "F2", "F3"]);
  });

  it("treats an empty COSTAR_KIT_DIR as missing", () => {
    expect(selectCoStar({ COSTAR_MODE: "live", COSTAR_KIT_DIR: "" }).mode).toBe("fake");
  });

  it("is live with COSTAR_MODE=live and a kit, or HEIST_MODE=live alone", () => {
    expect(selectCoStar({ ...KIT, COSTAR_MODE: "live" })).toMatchObject({ mode: "live", reason: "CoStar: live (data kit)" });
    expect(selectCoStar({ ...KIT, HEIST_MODE: "live" }).mode).toBe("live");
  });
});

describe("the fictional test kit in fake mode (HEIST_TEST_KIT=1, the recorded kit path, #95)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the fictional kit building by id, read through the kit mapping, and stays fake", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const s = selectCoStar({ HEIST_MODE: "fake", HEIST_TEST_KIT: "1" });
    expect(s.mode).toBe("fake");
    expect(s.reason).toBe("CoStar: fixtures (fake mode), and the fictional test kit by id");
    const kit = await s.adapter.getBuilding(SMOKE_KIT_BUILDING);
    expect(kit).toMatchObject({ id: SMOKE_KIT_BUILDING, name: "Testwood Exchange", source: "costar", yearBuilt: 1968, buildingClass: "B" });
    expect(kit?.matterportModelId).toBe("mpTestEEEE001");
    expect(await s.adapter.getAvailableSpace(SMOKE_KIT_BUILDING)).toHaveLength(3);
    // The fixtures answer as before: the map lists them alone, and F1 is F1.
    expect((await s.adapter.listBuildings("LA")).map((b) => b.id)).toEqual(["F1", "F2", "F3"]);
    expect((await s.adapter.getBuilding("F1"))?.source).toBe("fixture");
    expect(await s.adapter.getBuilding("F9")).toBeNull();
  });

  it("is off unless asked for, and never on in live mode", async () => {
    expect(await selectCoStar({ HEIST_MODE: "fake" }).adapter.getBuilding(SMOKE_KIT_BUILDING)).toBeNull();
    expect(selectCoStar({ COSTAR_MODE: "live", HEIST_TEST_KIT: "1" }).reason).toBe("CoStar: fixtures (live mode, but COSTAR_KIT_DIR not set)");
  });
});

describe("live CoStar beside the fixtures (issue 27; the PR #106 note)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetCoStar();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function live(dir: string) {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("HEIST_MODE", "");
    vi.stubEnv("COSTAR_MODE", "live");
    vi.stubEnv("COSTAR_KIT_DIR", dir);
    resetCoStar();
  }
  const fictional = () => {
    const dir = smallFictionalKit();
    dirs.push(dir);
    return dir;
  };

  it("the map lists the fixtures, then the kit's pins, per city", async () => {
    live(fictional());
    const { adapter } = getCoStar();
    expect((await adapter.listBuildings("LA")).map((b) => [b.id, b.source])).toEqual([
      ["F1", "fixture"],
      ["F2", "fixture"],
      ["F3", "fixture"],
      ["900001", "costar"],
    ]);
    expect((await adapter.listBuildings("Houston")).map((b) => b.id)).toEqual(["F4", "F5", "900004"]);
    expect(getCoStar()).toMatchObject({ mode: "live" });
  });

  it("F1 is served by the fixtures without tripping CoStar, and a kit building still reads live after it", async () => {
    live(fictional());
    expect((await getCoStar().adapter.getBuilding("F1"))?.name).toBe("Halvorsen Tower");
    expect(await getCoStar().adapter.getAvailableSpace("F1")).toHaveLength(13);
    expect(getCoStar().mode).toBe("live");
    expect(getCoStar().fallback).toBeUndefined();

    const kitBuilding = await getCoStar().adapter.getBuilding("900001");
    expect(kitBuilding).toMatchObject({ id: "900001", source: "costar" });
    expect(getCoStar().mode).toBe("live");
  });

  it("an id neither knows stays not found, and live", async () => {
    live(fictional());
    expect(await getCoStar().adapter.getBuilding("NOPE")).toBeNull();
    expect(getCoStar()).toMatchObject({ mode: "live" });
    expect(getCoStar().fallback).toBeUndefined();
  });

  it("a kit that fails to load trips CoStar to the fixtures, with one fallback", async () => {
    live(path.join(fictional(), "missing"));
    expect((await getCoStar().adapter.listBuildings("LA")).map((b) => b.id)).toEqual(["F1", "F2", "F3"]);
    expect(getCoStar()).toMatchObject({ mode: "fake", fallback: { service: "costar" } });
  });

  it("a kit building already read still opens when CoStar is forced to fixtures (the PR #72 note)", async () => {
    live(fictional());
    await getCoStar().adapter.listBuildings("LA");
    const forced = getCoStar({ forced: true });
    expect(forced.mode).toBe("fake");
    expect((await forced.adapter.getBuilding("900001"))?.id).toBe("900001");
    expect(await forced.adapter.getAvailableSpace("900001")).toHaveLength(2);
    expect((await forced.adapter.listBuildings("LA")).map((b) => b.id)).toEqual(["F1", "F2", "F3"]);
  });
});
