// Picks the live or the fake Vexcel adapter from the environment (SPEC §7)
// and exports the one interface. Live needs `VEXCEL_MODE` (or `HEIST_MODE`)
// set to `live` *and* both `VEXCEL_API_BASE` and `VEXCEL_API_KEY`; with
// either missing it falls back to the massing fixtures and says so. A
// building Vexcel has no coverage for, or whose imagery fails on its own, is
// answered by its massing while Vexcel stays live for the rest (the route
// adds `noCoverageFallback`). A failure of the network, a redirect, or
// several buildings failing in a row trips the breaker instead: from then on
// Vexcel stays on fixtures (`Breaker`), and the selection carries that `fallback`.
import { syncDemoEpoch } from "@/lib/demo-epoch";
import { fallbackMessage, withFallback, type Fallback } from "@/lib/fallback";
import { missingForLive, serviceModes, type ServiceMode } from "@/lib/mode";
import { resetServerSlot, serverSlot } from "@/lib/server-breakers";
import { createFakeVexcel } from "./fake";
import { createLiveVexcel } from "./live";
import type { VexcelAdapter } from "./types";

export type { AerialImage, VexcelAdapter } from "./types";

type Env = Record<string, string | undefined>;

export interface VexcelSelection {
  adapter: VexcelAdapter;
  /** Which implementation answers. */
  mode: ServiceMode;
  /** One line saying why, for logs and the mode chip's tooltip. */
  reason: string;
  /** Set once a live call has failed and the fixtures took over. */
  fallback?: Fallback;
}

/**
 * The fallback for one building served as its massing while Vexcel is live.
 * Its id is the building's, so the browser toasts it once a session however
 * often the Scout loads it, and the mode chip stops saying live.
 */
export function noCoverageFallback(buildingId: string): Fallback {
  return { service: "vexcel", id: `vexcel-no-scan-${buildingId}`, message: fallbackMessage("vexcel", "no-scan") };
}

export function selectVexcel(env: Env): VexcelSelection {
  const requested = serviceModes(env).vexcel;
  if (requested === "fake") {
    return { adapter: createFakeVexcel(), mode: "fake", reason: "Vexcel: fixtures (fake mode)" };
  }
  const missing = missingForLive("vexcel", env);
  if (missing.length > 0) {
    return {
      adapter: createFakeVexcel(),
      mode: "fake",
      reason: `Vexcel: fixtures (live mode, but ${missing.join(" and ")} not set)`,
    };
  }
  // Live imagery is fetched at the fixture massing's own block, and the
  // massing's hand-placed entries are pinned onto it, until the CoStar kit
  // can say where a real building stands (issue 29).
  const live = createLiveVexcel({
    base: env.VEXCEL_API_BASE,
    key: env.VEXCEL_API_KEY,
    massing: (id) => fake.getAerial(id),
  });
  return {
    adapter: {
      // A building Vexcel has no coverage for, or that failed on its own,
      // gets its massing, and Vexcel stays live for the rest.
      getAerial: async (id) => (await live.getAerial(id)) ?? fake.getAerial(id),
      getImage: (id, dir) => live.getImage(id, dir),
    },
    mode: "live",
    reason: "Vexcel: live",
  };
}

const fake = createFakeVexcel();
// The breaker and the selection are process-wide (`serverSlot`), shared by
// every bundle that loads this module: the routes, the pages and AppShell.
const slot = serverSlot<VexcelSelection>("vexcel");

/**
 * The process-wide Vexcel adapter: the mode is read once, on first use.
 * `forced` (the demo settings' switch) answers from the fixtures without
 * touching the live service. Read `mode` and `fallback` after a call to know
 * what that call served.
 */
export function getVexcel(options: { forced?: boolean } = {}): VexcelSelection {
  // A new demo epoch (`npm run demo:reset`) resets the breaker here too, not
  // only when a page renders.
  syncDemoEpoch();
  if (options.forced) return { adapter: fake, mode: "fake", reason: "Vexcel: fixtures (forced in demo settings)" };
  if (!slot.selected) {
    const chosen = selectVexcel(process.env);
    slot.selected = chosen.mode === "live" ? { ...chosen, adapter: withFallback(chosen.adapter, fake, slot.breaker) } : chosen;
    console.info(slot.selected.reason);
  }
  if (slot.breaker.tripped) {
    return { adapter: fake, mode: "fake", reason: "Vexcel: fixtures (a live call failed)", fallback: slot.breaker.tripped };
  }
  return slot.selected;
}

/** Forgets the selection and any failure, so the next use reads the environment again. */
export function resetVexcel(): void {
  resetServerSlot("vexcel");
}
