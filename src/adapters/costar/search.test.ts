// The inventory search on the fixture inventory only: no kit record is ever
// in the repo (SPEC §4.5).
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CastingFilter, InventorySearch, Mission, SEARCH_TOP } from "@/domain";
import missionsRaw from "../../../fixtures/missions.json";
import { FIXTURE_INVENTORY, createFakeCoStar } from "./fake";
import { getCoStar, resetCoStar } from "./index";
import { CoStarKitNotMappedError, createLiveCoStar } from "./live";

const missions = Mission.array().parse(missionsRaw);
const romaine = missions.find((m) => m.id === "romaine-1974")!;

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
    expect(steps.at(-1)!.top.map((c) => c.id)).toEqual(["F1", "L01", "L02"]);
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
    expect(steps.at(-1)!.top.map((c) => c.id)).toEqual(["F1", "L01", "L02"]);
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

describe("searchInventory live (the kit is not mapped yet, #27)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetCoStar();
  });

  it("refuses with an error naming the kit files", async () => {
    const live = createLiveCoStar({ base: "https://costar.invalid/api", key: "test-key" });
    await expect(live.searchInventory(romaine.casting)).rejects.toThrow(CoStarKitNotMappedError);
    await expect(live.searchInventory([])).rejects.toThrow(/commercial-property\.jsonl.*commercial-listing-summary\.jsonl.*commercial-properties\.csv/);
  });

  it("falls back to the fixture inventory through the breaker, and the mode chip says fixtures", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("HEIST_MODE", "");
    vi.stubEnv("COSTAR_MODE", "live");
    vi.stubEnv("COSTAR_API_BASE", "https://costar.test/api");
    vi.stubEnv("COSTAR_API_KEY", "test-key");
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    resetCoStar();
    expect(getCoStar().mode).toBe("live");
    const { steps } = await getCoStar().adapter.searchInventory(romaine.casting);
    expect(steps.at(-1)!.top.map((c) => c.id)).toEqual(["F1", "L01", "L02"]);
    expect(getCoStar()).toMatchObject({ mode: "fake" });
    expect(getCoStar().fallback).toBeDefined();
  });
});
