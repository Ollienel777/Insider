// Picks the live or the fake CoStar adapter from the environment (SPEC §7)
// and exports the one interface. Live needs `COSTAR_MODE` (or `HEIST_MODE`)
// set to `live` *and* `COSTAR_KIT_DIR`, the unpacked data kit; without it the
// fixtures answer and say so. Live, the map shows the kit's buildings next to
// the fixtures, and a fixture id (the demo's F1) is answered by the fixtures
// without touching the kit (`knownToFixtures`). A kit that fails to load is
// answered by the fixtures too, and from then on CoStar stays on fixtures
// (`Breaker`); the selection then carries that `fallback`. A kit building
// already read still opens after that, from memory, so a fallback never
// removes a page (PR #72's note).
import { syncDemoEpoch } from "@/lib/demo-epoch";
import { withFallback, type Fallback } from "@/lib/fallback";
import { missingForLive, serviceModes, type ServiceMode } from "@/lib/mode";
import { resetServerSlot, serverSlot } from "@/lib/server-breakers";
import type { Building } from "@/domain";
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
  /** A live building already in memory, for the fixtures to serve after a fallback. */
  cached?: (id: string) => Building | null;
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
  const live = createLiveCoStar({ kitDir: env.COSTAR_KIT_DIR });
  return { adapter: live, mode: "live", reason: "CoStar: live (data kit)", cached: (id) => live.cached(id) };
}

/**
 * `live` beside `fixtures`: the map lists the fixtures' buildings, then the
 * live ones; an id the fixtures know is answered by them, and only other ids
 * reach live. So a visit to F1 never touches live CoStar and never trips the
 * breaker: the fallback is scoped to the building, not the process (the
 * PR #106 note). Fixture ids (`F1`…) and kit ids (integers) cannot collide.
 */
export function knownToFixtures(live: CoStarAdapter, fixtures: CoStarAdapter): CoStarAdapter {
  return {
    listBuildings: async (city) => [...(await fixtures.listBuildings(city)), ...(await live.listBuildings(city))],
    getBuilding: async (id) => (await fixtures.getBuilding(id)) ?? live.getBuilding(id),
    getAvailableSpace: async (id) => (await fixtures.getAvailableSpace(id)) ?? live.getAvailableSpace(id),
  };
}

/** `fixtures`, except that a live building already in memory still opens by id. */
function withCached(fixtures: CoStarAdapter, cached: CoStarSelection["cached"]): CoStarAdapter {
  if (!cached) return fixtures;
  return {
    ...fixtures,
    getBuilding: async (id) => (await fixtures.getBuilding(id)) ?? cached(id),
    getAvailableSpace: async (id) => (await fixtures.getAvailableSpace(id)) ?? cached(id)?.availableSpace ?? null,
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
  if (options.forced) {
    return { adapter: withCached(fake, slot.selected?.cached), mode: "fake", reason: "CoStar: fixtures (forced in demo settings)" };
  }
  if (!slot.selected) {
    const chosen = selectCoStar(process.env);
    slot.selected = chosen.mode === "live" ? { ...chosen, adapter: withFallback(knownToFixtures(chosen.adapter, fake), fake, slot.breaker) } : chosen;
    console.info(slot.selected.reason);
  }
  if (slot.breaker.tripped) {
    return {
      adapter: withCached(fake, slot.selected.cached),
      mode: "fake",
      reason: "CoStar: fixtures (a live call failed)",
      fallback: slot.breaker.tripped,
    };
  }
  return slot.selected;
}

/** Forgets the selection and any failure, so the next use reads the environment again. */
export function resetCoStar(): void {
  resetServerSlot("costar");
}
