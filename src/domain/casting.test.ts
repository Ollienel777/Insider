import { describe, expect, it } from "vitest";
import {
  Building,
  type Candidate,
  Casting,
  CastingResult,
  type CastingFilter,
  Inventory,
  type InventoryProperty,
  Mission,
} from "@/domain";
import { searchInventory, vacantFloors } from "@/adapters/costar/search";
import buildingsRaw from "../../fixtures/costar/buildings.json";
import inventoryRaw from "../../fixtures/inventory.json";
import finalistsRaw from "../../fixtures/inventory-finalists.json";
import missionsRaw from "../../fixtures/missions.json";

const missions = Mission.array().parse(missionsRaw);
const inventory = Inventory.parse(inventoryRaw);
const buildings = Building.array().parse(buildingsRaw);

// The funnel is the app's own: `searchInventory` (src/adapters/costar/search.ts, #23).
function funnel(filters: CastingFilter[], all: InventoryProperty[]) {
  const { steps } = searchInventory(all, filters, "fixture");
  return { steps: steps.map(({ label, count }) => ({ label, count })), ranked: steps[steps.length - 1].top };
}

// ---- the fixtures ----------------------------------------------------------

/** Each mission's expected finalists, its own fixture building first (SPEC §7). */
const EXPECTED: Record<string, string[]> = finalistsRaw;

describe("fixtures/missions.json", () => {
  it("holds the five missions of SPEC §4.6, romaine-1974 first", () => {
    expect(missions.map((m) => m.id)).toEqual(Object.keys(EXPECTED));
  });

  it("casts each mission in its own city", () => {
    for (const m of missions) {
      const city = m.casting.find((f) => f.kind === "city");
      expect(city && city.kind === "city" && city.city, m.id).toBe(m.city);
    }
  });
});

describe("fixtures/inventory.json", () => {
  it("holds about 60 properties in LA and Houston", () => {
    expect(inventory.length).toBeGreaterThanOrEqual(55);
    expect(inventory.length).toBeLessThanOrEqual(65);
    expect(new Set(inventory.map((p) => p.city))).toEqual(new Set(["LA", "Houston"]));
  });

  it("carries the five fixture buildings unchanged", () => {
    for (const b of buildings) {
      const p = inventory.find((q) => q.id === b.id);
      expect(p, b.id).toBeDefined();
      const asBuilding = Object.fromEntries(
        Object.entries(p!).filter(([key]) => key !== "propertyType" && key !== "entries"),
      );
      expect(asBuilding).toEqual(b);
    }
  });

  it("keeps each building's floor area consistent", () => {
    for (const p of inventory) {
      expect(p.rbaSf, p.id).toBeGreaterThanOrEqual(p.typicalFloorSf);
      for (const f of vacantFloors(p)) {
        expect(f.floor, p.id).toBeLessThanOrEqual(p.stories);
        expect(f.sf, p.id).toBeLessThanOrEqual(p.typicalFloorSf);
      }
    }
  });

  it("shows entries only where the aerial layer exists", () => {
    for (const p of inventory) if (!p.layers.vexcel) expect(p.entries, p.id).toEqual([]);
  });

  it.each(Object.entries(EXPECTED))("narrows %s to exactly three finalists, its own building first", (id, expected) => {
    const mission = missions.find((m) => m.id === id)!;
    const { steps, ranked } = funnel(mission.casting, inventory);
    expect(steps).toHaveLength(mission.casting.length + 1);
    // Every filter takes something away, so each row of the funnel tells.
    for (let i = 1; i < steps.length; i++) expect(steps[i].count, steps[i].label).toBeLessThan(steps[i - 1].count);
    expect(steps[steps.length - 1].count).toBe(expected.length);
    expect(ranked.map((p) => p.id)).toEqual(expected);
  });
});

// ---- the schemas -----------------------------------------------------------

const romaine = missions[0];

function candidate(p: InventoryProperty): Candidate {
  const floor = vacantFloors(p)[0];
  return {
    id: p.id,
    name: p.name,
    city: p.city,
    neighbourhood: p.neighbourhood,
    lat: p.lat,
    lng: p.lng,
    yearBuilt: p.yearBuilt,
    buildingClass: p.buildingClass,
    propertyType: p.propertyType,
    stories: p.stories,
    layers: p.layers,
    source: p.source,
    vacantFloor: { floor: floor.floor, sf: floor.sf, suites: floor.suites },
    fit: [{ criterion: "built", value: p.yearBuilt }],
    reason: "A dark floor tonight, and a way in on the aerial.",
  };
}

/** The shortlist the Casting Director would write for `mission` on the fixture inventory. */
function shortlist(mission: Mission) {
  const { steps, ranked } = funnel(mission.casting, inventory);
  return {
    missionId: mission.id,
    funnel: steps,
    finalists: ranked.slice(0, 3).map((c) => candidate(inventory.find((p) => p.id === c.id)!)),
    trace: {
      events: [{ atMs: 0, kind: "todo", agent: "casting-director", label: "Read the mission", status: "completed" }],
    },
    source: "fixture",
  } satisfies CastingResult;
}

const result = shortlist(romaine);

describe("Casting", () => {
  it("rejects a filter kind given twice", () => {
    const twice = [...romaine.casting, { kind: "needsScan", label: "a scan, again" }];
    expect(Casting.safeParse(twice).success).toBe(false);
  });

  it("rejects a year range with no bound, or upside down", () => {
    const bad = (yearBuilt: object) => [{ kind: "yearBuilt", label: "built", yearBuilt }];
    expect(Casting.safeParse(bad({})).success).toBe(false);
    expect(Casting.safeParse(bad({ min: 1990, max: 1980 })).success).toBe(false);
  });

  it("rejects an entry the casting cannot ask for", () => {
    expect(Casting.safeParse([{ kind: "needsEntry", label: "a roof", needsEntry: ["roof"] }]).success).toBe(false);
  });

  it("rejects a mission with no casting", () => {
    expect(Mission.safeParse({ ...romaine, casting: undefined }).success).toBe(false);
  });
});

describe("CastingResult", () => {
  it.each(missions.map((m) => [m.id, m] as const))("accepts the %s shortlist", (id, mission) => {
    const parsed = CastingResult.parse(shortlist(mission));
    expect(parsed.finalists.map((c) => c.id)).toEqual(EXPECTED[id]);
  });

  it("wants exactly three finalists", () => {
    expect(CastingResult.safeParse({ ...result, finalists: result.finalists.slice(0, 2) }).success).toBe(false);
  });

  it("rejects a finalist named twice", () => {
    const finalists = [result.finalists[0], result.finalists[0], result.finalists[1]];
    expect(CastingResult.safeParse({ ...result, finalists }).success).toBe(false);
  });

  it("rejects a funnel whose count rises", () => {
    const funnel = [...result.funnel, { label: "more", count: 9 }];
    expect(CastingResult.safeParse({ ...result, funnel }).success).toBe(false);
  });

  it("rejects a funnel that ends below three", () => {
    const funnel = [...result.funnel, { label: "fewer", count: 2 }];
    expect(CastingResult.safeParse({ ...result, funnel }).success).toBe(false);
  });

  it("rejects a tenant field on a finalist", () => {
    const finalists = [{ ...result.finalists[0], tenant: "Acme" }, ...result.finalists.slice(1)];
    expect(CastingResult.safeParse({ ...result, finalists }).success).toBe(false);
  });
});
