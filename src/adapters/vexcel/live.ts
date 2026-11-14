// The live Vexcel adapter: HTTP transport only. What it requests and how the
// response maps onto `Aerial` lives in mapping.ts (open question Q3).
//
// Vexcel is queried by place, not by our building id, so the adapter is given
// `locate`, which says where a building stands.
//
// Not exercised against Vexcel: there is no key yet. Its unit tests run it on
// a stubbed `fetch`.
import { aerialQuery, ENDPOINT, toAerial } from "./mapping";
import type { VexcelAdapter } from "./types";

export interface LiveVexcelConfig {
  base?: string;
  key?: string;
  /** Where a building stands, or `null` when the id is unknown. */
  locate: (buildingId: string) => Promise<{ lat: number; lng: number } | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class VexcelNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Vexcel live adapter not configured: ${missing.join(" and ")} missing`);
    this.name = "VexcelNotConfiguredError";
  }
}

export function createLiveVexcel(config: LiveVexcelConfig): VexcelAdapter {
  const { base: rawBase, key, locate } = config;
  if (!rawBase || !key) {
    const missing = [!rawBase && "VEXCEL_API_BASE", !key && "VEXCEL_API_KEY"];
    throw new VexcelNotConfiguredError(missing.filter((m): m is string => Boolean(m)));
  }

  const base = rawBase.replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 8_000;

  return {
    async getAerial(buildingId: string) {
      const at = await locate(buildingId);
      if (!at) return null;
      const response = await doFetch(`${base}${ENDPOINT}?${aerialQuery(at)}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Vexcel: GET ${ENDPOINT} answered ${response.status}`);
      return toAerial(await response.json());
    },
  };
}
