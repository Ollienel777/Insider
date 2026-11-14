// The live CoStar adapter: HTTP transport only. What it requests and how the
// response maps onto `Building` lives in mapping.ts (open question Q1).
//
// Not exercised against CoStar: there is no key yet. Its unit tests run it on
// a stubbed `fetch`.
import type { Building, City } from "@/domain";
import { ENDPOINTS, KIT_FILES, propertyQuery, spaceQuery, toAvailableSpace, toBuilding, unwrapItem, unwrapList } from "./mapping";
import type { CoStarAdapter } from "./types";

export interface LiveCoStarConfig {
  base?: string;
  key?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class CoStarNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`CoStar live adapter not configured: ${missing.join(" and ")} missing`);
    this.name = "CoStarNotConfiguredError";
  }
}

/**
 * The live inventory search reads CoStar's data kit, whose field names are
 * not yet known (#27). Thrown under `withFallback`, it trips the breaker and
 * the fixture inventory answers.
 */
export class CoStarKitNotMappedError extends Error {
  constructor() {
    super(`CoStar: the kit inventory search is not mapped yet (${Object.values(KIT_FILES).join(", ")} in COSTAR_KIT_DIR; #27)`);
    this.name = "CoStarKitNotMappedError";
  }
}

export function createLiveCoStar(config: LiveCoStarConfig): CoStarAdapter {
  const { base: rawBase, key } = config;
  if (!rawBase || !key) {
    const missing = [!rawBase && "COSTAR_API_BASE", !key && "COSTAR_API_KEY"];
    throw new CoStarNotConfiguredError(missing.filter((m): m is string => Boolean(m)));
  }

  const base = rawBase.replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 8_000;

  /** GET a path; `null` on 404, an error naming the status on anything else. */
  async function get(path: string, query: URLSearchParams): Promise<unknown | null> {
    const response = await doFetch(`${base}${path}?${query}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`CoStar: GET ${path} answered ${response.status}`);
    return response.json();
  }

  async function spacesOf(id: string): Promise<unknown[] | null> {
    const body = await get(ENDPOINTS.spaces(id), spaceQuery());
    return body === null ? null : unwrapList(body);
  }

  async function building(property: unknown): Promise<Building> {
    const id = String((property as { propertyId?: unknown }).propertyId);
    return toBuilding(property, (await spacesOf(id)) ?? []);
  }

  return {
    async listBuildings(city: City) {
      const body = await get(ENDPOINTS.properties, propertyQuery(city));
      const list = await Promise.all(unwrapList(body ?? []).map(building));
      return list.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    },
    async getBuilding(id: string) {
      const body = await get(ENDPOINTS.property(id), propertyQuery());
      return body === null ? null : building(unwrapItem(body));
    },
    async getAvailableSpace(id: string) {
      const rows = await spacesOf(id);
      return rows === null ? null : toAvailableSpace(rows);
    },
    async searchInventory() {
      throw new CoStarKitNotMappedError();
    },
  };
}
