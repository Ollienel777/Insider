// The inventory search on the fixture inventory only: no kit record is ever
// in the repo (SPEC §4.5).
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CastingFilter, InventorySearch, Mission, SEARCH_TOP } from "@/domain";
import finalists from "../../../fixtures/inventory-finalists.json";
import missionsRaw from "../../../fixtures/missions.json";
import { FIXTURE_INVENTORY, createFakeCoStar } from "./fake";
import { getCoStar, resetCoStar } from "./index";
import { createLiveCoStar } from "./live";
import { passes, searchInventory } from "./search";

const missions = Mission.array().parse(missionsRaw);
const romaine = missions.find((m) => m.id === "romaine-1974")!;
const ROMAINE: string[] = finalists["romaine-1974"];

describe("searchInventory on the fake adapter", () => {
  const costar = createFakeCoStar();

  it("returns one step for the whole inventory, then one per filter, in order", async () => {
    const search = await costar.searchInventory(romaine.casting);
    expect(InventorySearch.safeParse(search).success).toBe(true);
    expect(search.steps.map((s) => s.label)).toEqual([
      `${FIXTURE_INVENTORY.length} buildings in the inventory`,
      ...romaine.casting.map((f) => f.label),
    ]);
    expect(search.steps[0].count).toBe(FIXTURE_INVENTORY.length);
    for (let i = 1; i < search.steps.length; i++) {
      expect(search.steps[i].count).toBeLessThan(search.steps[i - 1].count);
    }
  });

  it("shows at most the top five per step, largest vacant floor first", async () => {
    const { steps } = await costar.searchInventory(romaine.casting);
    for (const step of steps) {
      expect(step.top).toHaveLength(Math.min(step.count, SEARCH_TOP));
      const sf = step.top.map((c) => c.vacantFloor?.sf ?? 0);
      expect(sf).toEqual([...sf].sort((a, b) => b - a));
    }
    expect(steps.at(-1)!.top.map((c) => c.id)).toEqual(ROMAINE);
  });

  it("gives each candidate its floor with the most available area, and no tenant field", async () => {
    const { steps } = await costar.searchInventory(romaine.casting);
    const f1 = steps.at(-1)!.top[0];
    expect(f1.vacantFloor?.floor).toBe(22);
    expect(f1.vacantFloor?.suites).toEqual(["2202", "2203", "2204", "2205", "2206", "2207", "2208", "2209", "2210"]);
    expect(Object.keys(f1)).not.toContain("tenant");
  });

  it("answers the order the caller chooses, one filter at a time", async () => {
    const reversed = [...romaine.casting].reverse();
    const { steps } = await costar.searchInventory(reversed);
    expect(steps.map((s) => s.label).slice(1)).toEqual(reversed.map((f) => f.label));
    expect(steps.at(-1)!.top.map((c) => c.id)).toEqual(ROMAINE);
    const one = await costar.searchInventory(romaine.casting.slice(0, 1));
    expect(one.steps).toHaveLength(2);
  });

  it("returns the whole inventory for no filters, and rejects a malformed one", async () => {
    expect((await costar.searchInventory([])).steps).toHaveLength(1);
    const bad = [{ kind: "needsEntry", label: "a roof", needsEntry: ["roof"] }] as unknown as CastingFilter[];
    await expect(costar.searchInventory(bad)).rejects.toThrow();
  });

  it("hands out copies, so a caller cannot change the inventory", async () => {
    const { steps } = await costar.searchInventory([]);
    steps[0].top[0].layers.matterport = false;
    steps[0].top[0].vacantFloor!.suites.length = 0;
    const again = await costar.searchInventory([]);
    expect(again.steps[0].top[0]).not.toEqual(steps[0].top[0]);
  });
});

describe.each(missions.map((m) => m.id))("searchInventory for %s", (id) => {
  it("ends with the mission's expected three finalists, best first", async () => {
    const mission = missions.find((m) => m.id === id)!;
    const { steps } = await createFakeCoStar().searchInventory(mission.casting);
    expect(steps.at(-1)!.top.map((c) => c.id)).toEqual((finalists as Record<string, string[]>)[id]);
  });
});

describe("searchInventory live (the kit is not mapped yet, #27)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetCoStar();
  });

  // A hand-written live building in the shape mapping.ts assumes; not a CoStar record.
  const PROPERTY = {
    propertyId: 48213,
    propertyName: "Sample Plaza",
    city: "Los Angeles",
    submarket: "Downtown Los Angeles",
    latitude: 34.0489,
    longitude: -118.2551,
    yearBuilt: 1986,
    buildingClass: "A",
    numberOfStories: 34,
    rentableBuildingArea: 702318,
    typicalFloorSize: 21460,
  };

  it("answers from the fixture inventory, marked as fixtures, without calling CoStar", async () => {
    const fetch = vi.fn();
    const live = createLiveCoStar({ base: "https://costar.invalid/api", key: "test-key", fetch });
    const search = await live.searchInventory(romaine.casting);
    expect(search).toEqual(await createFakeCoStar().searchInventory(romaine.casting));
    expect(search.source).toBe("fixture");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves live buildings live: no breaker trip, no fallback", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("HEIST_MODE", "");
    vi.stubEnv("COSTAR_MODE", "live");
    vi.stubEnv("COSTAR_API_BASE", "https://costar.test/api");
    vi.stubEnv("COSTAR_API_KEY", "test-key");
    const hits: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      hits.push(path);
      if (path === "/api/properties") return Response.json([PROPERTY]);
      if (path === "/api/properties/48213") return Response.json(PROPERTY);
      if (path === "/api/properties/48213/spaces") return Response.json({ items: [] });
      return new Response("", { status: 404 });
    });
    resetCoStar();

    const search = await getCoStar().adapter.searchInventory(romaine.casting);
    expect(search.source).toBe("fixture");
    expect(search.steps.at(-1)!.top.map((c) => c.id)).toEqual(ROMAINE);
    expect(getCoStar()).toMatchObject({ mode: "live" });
    expect(getCoStar().fallback).toBeUndefined();

    expect((await getCoStar().adapter.listBuildings("LA")).map((b) => [b.id, b.source])).toEqual([["48213", "costar"]]);
    expect((await getCoStar().adapter.getBuilding("48213"))?.name).toBe("Sample Plaza");
    expect(hits).toContain("/api/properties");
    expect(hits).toContain("/api/properties/48213");
    expect(getCoStar()).toMatchObject({ mode: "live" });
  });
});

describe("the funnel itself", () => {
  // An invented property with nothing on the market (no fixture has one).
  const f1 = FIXTURE_INVENTORY.find((p) => p.id === "F1")!;
  const empty = { ...structuredClone(f1), id: "Z99", availableSpace: [] };

  it("ranks a property with no vacant floor last, with vacantFloor null, and minVacantFloorSf drops it", () => {
    const all = searchInventory([empty, f1], [], "fixture");
    expect(all.steps[0].top.map((c) => [c.id, c.vacantFloor?.floor ?? null])).toEqual([["F1", 22], ["Z99", null]]);
    const filtered = searchInventory([empty, f1], [{ kind: "minVacantFloorSf", label: "any floor", minVacantFloorSf: 1 }], "fixture");
    expect(filtered.steps[1].top.map((c) => c.id)).toEqual(["F1"]);
  });

  it("throws on a filter kind it does not know, instead of emptying the funnel", () => {
    const unknown = { kind: "roofDeck", label: "a roof deck" } as unknown as CastingFilter;
    expect(() => passes(f1, unknown)).toThrow(/unknown casting filter kind: roofDeck/);
  });
});
