// The inventory search (SPEC §4.4, C2): deterministic code over an
// inventory, the same for the fixtures and the kit. It applies a mission's
// casting filters in the order given and reports, after each, how many
// properties are left and the best of them. The Casting Director chooses the
// order and judges ties; nothing here calls a model.
import {
  type Building,
  type CastingFilter,
  type InventoryProperty,
  type InventorySearch,
  SEARCH_TOP,
  type SearchCandidate,
  type VacantFloor,
} from "@/domain";

/** The property's floors, each with its available suites added up, largest first, then lowest. */
export function vacantFloors(p: InventoryProperty): VacantFloor[] {
  const floors = new Map<number, VacantFloor>();
  for (const s of p.availableSpace) {
    const f = floors.get(s.floor) ?? { floor: s.floor, sf: 0, suites: [] };
    f.sf += s.sf;
    f.suites.push(s.suite);
    floors.set(s.floor, f);
  }
  return [...floors.values()].sort((a, b) => b.sf - a.sf || a.floor - b.floor);
}

/** Whether `p` passes `f`, as `CastingFilter` documents each kind. */
export function passes(p: InventoryProperty, f: CastingFilter): boolean {
  switch (f.kind) {
    case "city":
      return p.city === f.city;
    case "yearBuilt":
      return (f.yearBuilt.min ?? -Infinity) <= p.yearBuilt && p.yearBuilt <= (f.yearBuilt.max ?? Infinity);
    case "buildingClass":
      return f.buildingClass.includes(p.buildingClass);
    case "propertyTypes":
      return f.propertyTypes.includes(p.propertyType);
    case "minVacantFloorSf":
      return (vacantFloors(p)[0]?.sf ?? 0) >= f.minVacantFloorSf;
    case "needsScan":
      return p.layers.matterport;
    case "needsEntry":
      return f.needsEntry.some((kind) => p.entries.includes(kind));
    default: {
      const unknown: never = f;
      throw new Error(`unknown casting filter kind: ${(unknown as { kind?: unknown }).kind}`);
    }
  }
}

function toCandidate(p: InventoryProperty, vacantFloor: VacantFloor | null): SearchCandidate {
  const { id, name, city, neighbourhood, lat, lng, yearBuilt, buildingClass, propertyType, stories, layers, source } = p;
  return structuredClone({ id, name, city, neighbourhood, lat, lng, yearBuilt, buildingClass, propertyType, stories, layers, source, vacantFloor });
}

/**
 * The best `SEARCH_TOP` of `left`: largest vacant floor first, then id in
 * numeric order (`localeCompare` with `numeric: true`, so F2 before F10).
 */
function top(left: readonly InventoryProperty[]): SearchCandidate[] {
  return left
    .map((p) => ({ p, floor: vacantFloors(p)[0] ?? null }))
    .sort((a, b) => (b.floor?.sf ?? 0) - (a.floor?.sf ?? 0) || a.p.id.localeCompare(b.p.id, "en", { numeric: true }))
    .slice(0, SEARCH_TOP)
    .map(({ p, floor }) => toCandidate(p, floor));
}

/**
 * Applies `filters` in order to `inventory`; one step for the whole
 * inventory, then one per filter. `source` names the inventory.
 */
export function searchInventory(
  inventory: readonly InventoryProperty[],
  filters: readonly CastingFilter[],
  source: Building["source"],
): InventorySearch {
  let left = inventory;
  const steps = [{ label: `${inventory.length} buildings in the inventory`, count: inventory.length, top: top(left) }];
  for (const f of filters) {
    left = left.filter((p) => passes(p, f));
    steps.push({ label: f.label, count: left.length, top: top(left) });
  }
  return { steps, source };
}
