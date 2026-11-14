// Picks the live or the fake Vexcel adapter from the environment (SPEC §7)
// and exports the one interface. Live needs `VEXCEL_MODE` (or `HEIST_MODE`)
// set to `live` *and* both `VEXCEL_API_BASE` and `VEXCEL_API_KEY`; with
// either missing it falls back to the massing fixtures and says so.
import { serviceModes, type ServiceMode } from "@/lib/mode";
import { createFakeVexcel, fixtureLocation } from "./fake";
import { createLiveVexcel } from "./live";
import type { VexcelAdapter } from "./types";

export type { VexcelAdapter } from "./types";

type Env = Record<string, string | undefined>;

export interface VexcelSelection {
  adapter: VexcelAdapter;
  /** Which implementation was chosen. */
  mode: ServiceMode;
  /** One line saying why, for logs and the mode chip's tooltip. */
  reason: string;
}

export function selectVexcel(env: Env): VexcelSelection {
  const requested = serviceModes(env).vexcel;
  if (requested === "fake") {
    return { adapter: createFakeVexcel(), mode: "fake", reason: "Vexcel: fixtures (fake mode)" };
  }
  const missing = (["VEXCEL_API_BASE", "VEXCEL_API_KEY"] as const).filter((name) => !env[name]);
  if (missing.length > 0) {
    return {
      adapter: createFakeVexcel(),
      mode: "fake",
      reason: `Vexcel: fixtures (live mode, but ${missing.join(" and ")} not set)`,
    };
  }
  return {
    // Live imagery is fetched at the fixture building's own block until the
    // CoStar adapter can say where a building stands.
    adapter: createLiveVexcel({
      base: env.VEXCEL_API_BASE,
      key: env.VEXCEL_API_KEY,
      locate: async (id) => fixtureLocation(id),
    }),
    mode: "live",
    reason: "Vexcel: live",
  };
}

let selected: VexcelSelection | undefined;

/** The process-wide Vexcel adapter: the mode is read once, on first use. */
export function getVexcel(): VexcelSelection {
  if (!selected) {
    selected = selectVexcel(process.env);
    console.info(selected.reason);
  }
  return selected;
}
