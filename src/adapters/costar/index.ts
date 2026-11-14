// Picks the live or the fake CoStar adapter from the environment (SPEC §7)
// and exports the one interface. Live needs `COSTAR_MODE` (or `HEIST_MODE`)
// set to `live` *and* both `COSTAR_API_BASE` and `COSTAR_API_KEY`; with
// either missing it falls back to the fixtures and says so.
import { serviceModes, type ServiceMode } from "@/lib/mode";
import { createFakeCoStar } from "./fake";
import { createLiveCoStar } from "./live";
import type { CoStarAdapter } from "./types";

export type { CoStarAdapter } from "./types";

type Env = Record<string, string | undefined>;

export interface CoStarSelection {
  adapter: CoStarAdapter;
  /** Which implementation was chosen. */
  mode: ServiceMode;
  /** One line saying why, for logs and the mode chip's tooltip. */
  reason: string;
}

export function selectCoStar(env: Env): CoStarSelection {
  const requested = serviceModes(env).costar;
  if (requested === "fake") {
    return { adapter: createFakeCoStar(), mode: "fake", reason: "CoStar: fixtures (fake mode)" };
  }
  const missing = (["COSTAR_API_BASE", "COSTAR_API_KEY"] as const).filter((name) => !env[name]);
  if (missing.length > 0) {
    return {
      adapter: createFakeCoStar(),
      mode: "fake",
      reason: `CoStar: fixtures (live mode, but ${missing.join(" and ")} not set)`,
    };
  }
  return {
    adapter: createLiveCoStar({ base: env.COSTAR_API_BASE, key: env.COSTAR_API_KEY }),
    mode: "live",
    reason: "CoStar: live",
  };
}

let selected: CoStarSelection | undefined;

/** The process-wide CoStar adapter: the mode is read once, on first use. */
export function getCoStar(): CoStarSelection {
  if (!selected) {
    selected = selectCoStar(process.env);
    console.info(selected.reason);
  }
  return selected;
}
