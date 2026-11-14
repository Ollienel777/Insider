// The live CoStar adapter: CoStar's data kit, read from `COSTAR_KIT_DIR`
// (SPEC §4.5). The kit is indexed once per adapter, lazily, on the first call
// (kit.ts); every call after that answers from memory. A failed load rejects
// that call and is retried on the next one; the breaker in index.ts serves
// fixtures meanwhile, until `npm run demo:reset`.
import { BASEMAPS } from "@/components/map/basemap";
import type { Building, City } from "@/domain";
import { createFakeCoStar } from "./fake";
import { loadKitIndex, type KitIndex } from "./kit";
import { mapSelection } from "./mapping";
import type { CoStarAdapter } from "./types";

export interface LiveCoStarConfig {
  kitDir?: string;
  /** The kit reader; tests pass one over fictional records. */
  load?: (dir: string) => Promise<KitIndex>;
}

export class CoStarNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`CoStar live adapter not configured: ${missing.join(" and ")} missing`);
    this.name = "CoStarNotConfiguredError";
  }
}

export interface LiveCoStar extends CoStarAdapter {
  /** A building from the index already in memory, without loading it; `null` when not loaded or unknown. */
  cached(id: string): Building | null;
}

export function createLiveCoStar(config: LiveCoStarConfig): LiveCoStar {
  const { kitDir } = config;
  if (!kitDir) throw new CoStarNotConfiguredError(["COSTAR_KIT_DIR"]);
  const load = config.load ?? loadKitIndex;

  let loaded: KitIndex | null = null;
  let pending: Promise<KitIndex> | null = null;
  function index(): Promise<KitIndex> {
    pending ??= load(kitDir!).then(
      (kit) => {
        loaded = kit;
        const { records, indexed, scanned, malformed, ms } = kit.stats;
        const bad = malformed.properties + malformed.listings + malformed.scans;
        console.info(`CoStar kit: ${indexed} of ${records} properties staged (${scanned} with a scan) in ${ms} ms; ${bad} malformed records skipped`);
        return kit;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  }

  // The search does not read the kit yet: an `InventoryProperty` needs a
  // property type and entry kinds the kit mapping does not provide. Until it
  // does (#2), the search answers from the fixture inventory, marked
  // `source: "fixture"`, without throwing, so it never trips the breaker
  // that live buildings share.
  const fixtures = createFakeCoStar();
  const copy = <T>(value: T): T => structuredClone(value);
  const building = (kit: KitIndex, id: string) => kit.properties.get(id)?.building ?? null;

  return {
    async listBuildings(city: City) {
      const kit = await index();
      // Only where the map can draw a pin: the city's basemap.
      return mapSelection(
        [...kit.properties.values()].map((p) => p.building),
        city,
        BASEMAPS[city].bounds,
      ).map(copy);
    },
    async getBuilding(id: string) {
      const found = building(await index(), id);
      return found ? copy(found) : null;
    },
    async getAvailableSpace(id: string) {
      const found = building(await index(), id);
      return found ? copy(found.availableSpace) : null;
    },
    cached(id: string) {
      const found = loaded ? building(loaded, id) : null;
      return found ? copy(found) : null;
    },
    searchInventory: (filters) => fixtures.searchInventory(filters),
  };
}
