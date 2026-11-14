// The inventory search on the fixture inventory only: no kit record is ever
// in the repo (SPEC §4.5).
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { type CastingFilter, InventorySearch, Mission, SEARCH_TOP } from "@/domain";
import finalists from "../../../fixtures/inventory-finalists.json";
import missionsRaw from "../../../fixtures/missions.json";
import { FIXTURE_INVENTORY, createFakeCoStar } from "./fake";
import { getCoStar, resetCoStar } from "./index";
import { createLiveCoStar } from "./live";
import { passes, searchInventory } from "./search";
import { smallFictionalKit } from "./test-kit";

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
    const inventoryBefore = structuredClone(FIXTURE_INVENTORY);
    const { steps } = await costar.searchInventory([]);
    const before = structuredClone(steps[0].top[0]);
    expect(before.layers.matterport).toBe(true);
    steps[0].top[0].layers.matterport = false;
    steps[0].top[0].vacantFloor!.suites.length = 0;
    const again = await costar.searchInventory([]);
    expect(again.steps[0].top[0]).toEqual(before);
    expect(FIXTURE_INVENTORY).toEqual(inventoryBefore);
  });
});

describe.each(missions.map((m) => m.id))("searchInventory for %s", (id) => {
  it("ends with the mission's expected three finalists, best first", async () => {
    const mission = missions.find((m) => m.id === id)!;
    const { steps } = await createFakeCoStar().searchInventory(mission.casting);
    expect(steps.at(-1)!.top.map((c) => c.id)).toEqual((finalists as Record<string, string[]>)[id]);
  });
});

describe("searchInventory live (the kit is not searched yet, #2)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetCoStar();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** Live mode on the fictional kit in test-kit.ts; no real kit record. */
  function live() {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = smallFictionalKit();
    dirs.push(dir);
    vi.stubEnv("HEIST_MODE", "");
    vi.stubEnv("COSTAR_MODE", "live");
    vi.stubEnv("COSTAR_KIT_DIR", dir);
    resetCoStar();
  }

  it("answers from the fixture inventory, marked as fixtures, without reading the kit", async () => {
    const load = vi.fn();
    const costar = createLiveCoStar({ kitDir: "/kits/costar-test", load });
    const search = await costar.searchInventory(romaine.casting);
    expect(search).toEqual(await createFakeCoStar().searchInventory(romaine.casting));
    expect(search.source).toBe("fixture");
    expect(load).not.toHaveBeenCalled();
  });

  it("leaves live buildings live: no breaker trip, no fallback", async () => {
    live();
    const search = await getCoStar().adapter.searchInventory(romaine.casting);
    expect(search.source).toBe("fixture");
    expect(search.steps.at(-1)!.top.map((c) => c.id)).toEqual(ROMAINE);
    expect(getCoStar()).toMatchObject({ mode: "live" });
    expect(getCoStar().fallback).toBeUndefined();

    expect((await getCoStar().adapter.listBuildings("LA")).map((b) => [b.id, b.source])).toContainEqual(["900001", "costar"]);
    expect((await getCoStar().adapter.getBuilding("900001"))?.source).toBe("costar");
    expect(getCoStar()).toMatchObject({ mode: "live" });
  });

  it("rejects a malformed filter to the caller, and live buildings stay live", async () => {
    live();
    const bad = [{ kind: "roofDeck", label: "a roof deck" }] as unknown as CastingFilter[];
    await expect(getCoStar().adapter.searchInventory(bad)).rejects.toThrow(ZodError);
    expect(getCoStar()).toMatchObject({ mode: "live" });
    expect(getCoStar().fallback).toBeUndefined();
    expect((await getCoStar().adapter.listBuildings("LA")).map((b) => b.source)).toContain("costar");
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
