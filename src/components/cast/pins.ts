// The cast map's pins (SPEC §2 beat 2): every property the casting search ran
// on, with the funnel row at which it drops out. Worked out on the server with
// the inventory search's own filter code (`passes`, src/adapters/costar/
// search.ts), so the pins and the funnel's counts can never disagree, and the
// 61-property inventory never enters the browser bundle: the page passes only
// these few fields.
import { passes } from "@/adapters/costar/search";
import type { CastingFilter, CastingResult, InventoryProperty, Mission } from "@/domain";
import type { MapBuilding } from "@/components/map/types";

export type CastPinData = Pick<MapBuilding, "id" | "name" | "city" | "neighbourhood" | "lat" | "lng" | "layers"> & {
  /** The funnel row whose filter this property fails (1 for the first filter); null when it passes them all. */
  outAt: number | null;
};

/**
 * The mission's filters in the order the funnel applied them: the funnel's
 * rows after the first (the whole inventory) name the filters by label, in the
 * order the Casting Director chose. Null when a row names no filter of the
 * mission.
 */
export function funnelFilters(result: Pick<CastingResult, "funnel">, mission: Pick<Mission, "casting">): CastingFilter[] | null {
  const filters: CastingFilter[] = [];
  for (const row of result.funnel.slice(1)) {
    const filter = mission.casting.find((f) => f.label === row.label);
    if (!filter) return null;
    filters.push(filter);
  }
  return filters;
}

const pinOf = (p: Pick<InventoryProperty, keyof Omit<CastPinData, "outAt">>, outAt: number | null): CastPinData => {
  const { id, name, city, neighbourhood, lat, lng, layers } = p;
  return { id, name, city, neighbourhood, lat, lng, layers: { ...layers }, outAt };
};

/**
 * One pin per property of `inventory`, each with the row it drops out at,
 * when the cached funnel is this inventory's: its first count is the
 * inventory's size and every count after matches what the filters leave.
 * Otherwise (a shortlist cast live on CoStar's data kit, whose inventory the
 * browser never sees) only the three finalists are pinned, none dimming.
 */
export function castPins(
  result: Pick<CastingResult, "funnel" | "finalists">,
  mission: Pick<Mission, "casting">,
  inventory: readonly InventoryProperty[],
): { pins: CastPinData[]; perFilter: boolean } {
  const finalistsOnly = { pins: result.finalists.map((c) => pinOf(c, null)), perFilter: false };
  const filters = funnelFilters(result, mission);
  if (!filters || result.funnel[0].count !== inventory.length) return finalistsOnly;

  const pins = inventory.map((p) => {
    const failed = filters.findIndex((f) => !passes(p, f));
    return pinOf(p, failed < 0 ? null : failed + 1);
  });
  const agrees = result.funnel.every((row, i) => pins.filter((p) => p.outAt === null || p.outAt > i).length === row.count);
  const finalistsIn = result.finalists.every((c) => pins.some((p) => p.id === c.id && p.outAt === null));
  return agrees && finalistsIn ? { pins, perFilter: true } : finalistsOnly;
}
