// Picks the live or the fake CoStar adapter from the environment (SPEC §7)
// and exports the one interface. Live needs `COSTAR_MODE` (or `HEIST_MODE`)
// set to `live` *and* both `COSTAR_API_BASE` and `COSTAR_API_KEY`; with
// either missing it falls back to the fixtures and says so. A live call that
// fails is answered by the fixtures too, and from then on CoStar stays on
// fixtures (`Breaker`); the selection then carries that `fallback`. So does a
// building live CoStar does not know but the fixtures do (`knownToFixtures`).
import { syncDemoEpoch } from "@/lib/demo-epoch";
import { UnknownToLiveError, withFallback, type Fallback } from "@/lib/fallback";
import { missingForLive, serviceModes, type ServiceMode } from "@/lib/mode";
import { resetServerSlot, serverSlot } from "@/lib/server-breakers";
import { createFakeCoStar } from "./fake";
import { createLiveCoStar } from "./live";
import type { CoStarAdapter } from "./types";

export type { CoStarAdapter } from "./types";

type Env = Record<string, string | undefined>;

export interface CoStarSelection {
  adapter: CoStarAdapter;
  /** Which implementation answers. */
  mode: ServiceMode;
  /** One line saying why, for logs and the mode chip's tooltip. */
  reason: string;
  /** Set once a live call has failed and the fixtures took over. */
  fallback?: Fallback;
}

export function selectCoStar(env: Env): CoStarSelection {
  const requested = serviceModes(env).costar;
  if (requested === "fake") {
    return { adapter: createFakeCoStar(), mode: "fake", reason: "CoStar: fixtures (fake mode)" };
  }
  const missing = missingForLive("costar", env);
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

/**
 * `live`, except that a building it answers `null` for but `fixtures` know
 * throws `UnknownToLiveError`. Under `withFallback` that trips the breaker,
 * so the fixture building (the demo's, whose cached levels exist only under
 * fixture ids) is served and the mode chip reports fixtures. An id neither
 * knows stays `null`.
 */
export function knownToFixtures(live: CoStarAdapter, fixtures: CoStarAdapter): CoStarAdapter {
  async function orFixture<T>(id: string, answer: T | null, fixture: () => Promise<T | null>): Promise<T | null> {
    if (answer === null && (await fixture()) !== null) throw new UnknownToLiveError("costar", id);
    return answer;
  }
  return {
    listBuildings: (city) => live.listBuildings(city),
    getBuilding: async (id) => orFixture(id, await live.getBuilding(id), () => fixtures.getBuilding(id)),
    getAvailableSpace: async (id) => orFixture(id, await live.getAvailableSpace(id), () => fixtures.getAvailableSpace(id)),
  };
}

const fake = createFakeCoStar();
// The breaker and the selection are process-wide (`serverSlot`), shared by
// every bundle that loads this module: the routes, the pages and AppShell.
const slot = serverSlot<CoStarSelection>("costar");

/**
 * The process-wide CoStar adapter: the mode is read once, on first use.
 * `forced` (the demo settings' switch) answers from the fixtures without
 * touching the live service. Read `mode` and `fallback` after a call to know
 * what that call served.
 */
export function getCoStar(options: { forced?: boolean } = {}): CoStarSelection {
  // A new demo epoch (`npm run demo:reset`) resets the breaker here too, not
  // only when a page renders.
  syncDemoEpoch();
  if (options.forced) return { adapter: fake, mode: "fake", reason: "CoStar: fixtures (forced in demo settings)" };
  if (!slot.selected) {
    const chosen = selectCoStar(process.env);
    slot.selected = chosen.mode === "live" ? { ...chosen, adapter: withFallback(knownToFixtures(chosen.adapter, fake), fake, slot.breaker) } : chosen;
    console.info(slot.selected.reason);
  }
  if (slot.breaker.tripped) {
    return { adapter: fake, mode: "fake", reason: "CoStar: fixtures (a live call failed)", fallback: slot.breaker.tripped };
  }
  return slot.selected;
}

/** Forgets the selection and any failure, so the next use reads the environment again. */
export function resetCoStar(): void {
  resetServerSlot("costar");
}
