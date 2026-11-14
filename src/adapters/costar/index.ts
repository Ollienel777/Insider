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
import { showcaseIds } from "@/lib/showcase";
import { missingForLive, serviceModes, type ServiceMode } from "@/lib/mode";
import { resetServerSlot, serverSlot } from "@/lib/server-breakers";
import type { Building } from "@/domain";
import { createFakeCoStar } from "./fake";
import { loadKitIndex } from "./kit";
import { createLiveCoStar } from "./live";
import { smokeFictionalKit } from "./test-kit";
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
    if (env.HEIST_TEST_KIT === "1") {
      return { adapter: withTestKit(createFakeCoStar()), mode: "fake", reason: "CoStar: fixtures (fake mode), and the fictional test kit by id" };
    }
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
    searchInventory: (filters) => live.searchInventory(filters),
  };
}

/**
 * `live`, showing only the showcase's buildings when the server has a list
 * (`SHOWCASE_LEVELS`, #93): any other kit building is neither listed nor
 * found by id. With no list (`ids` null), every kit building shows.
 */
export function onlyShowcase(live: CoStarAdapter, ids: Set<string> | null): CoStarAdapter {
  if (!ids) return live;
  return {
    listBuildings: async (city) => (await live.listBuildings(city)).filter((b) => ids.has(b.id)),
    getBuilding: async (id) => (ids.has(id) ? live.getBuilding(id) : null),
    getAvailableSpace: async (id) => (ids.has(id) ? live.getAvailableSpace(id) : null),
    searchInventory: (filters) => live.searchInventory(filters),
  };
}

/**
 * `fixtures`, plus the fictional test kit's building by id only (#95): the
 * recorded kit path in the smoke (`HEIST_TEST_KIT=1`, set by
 * playwright.config.ts alone) plays a kit building with no real kit and no
 * keys. The kit is read through the real kit mapping, from records invented
 * in test-kit.ts, written to a temporary directory on first use. The map,
 * the search and every fixture answer exactly as without it.
 */
function withTestKit(fixtures: CoStarAdapter): CoStarAdapter {
  const kit = createLiveCoStar({ kitDir: "(fictional test kit)", load: () => loadKitIndex(smokeFictionalKit()) });
  return {
    ...fixtures,
    getBuilding: async (id) => (await fixtures.getBuilding(id)) ?? kit.getBuilding(id),
    getAvailableSpace: async (id) => (await fixtures.getAvailableSpace(id)) ?? kit.getAvailableSpace(id),
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
 * what that call served, except for `searchInventory`: it reports
 * what served it in its own `source`, not through `mode`/`fallback`. Live
 * inventory search is still answered from the fixture inventory (`source:
 * "fixture"`), outside the breaker: the kit reader does not search yet (#2).
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
    if (chosen.mode === "live") {
      const guarded = withFallback(knownToFixtures(onlyShowcase(chosen.adapter, showcaseIds()), fake), fake, slot.breaker);
      // The search stays outside the breaker while it has no live
      // implementation (#2): it answers from the fixtures anyway, and a
      // caller's malformed filter is not a CoStar failure.
      slot.selected = { ...chosen, adapter: { ...guarded, searchInventory: (filters) => chosen.adapter.searchInventory(filters) } };
    } else {
      slot.selected = chosen;
    }
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
