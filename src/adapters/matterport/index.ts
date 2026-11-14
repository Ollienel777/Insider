// Picks the live or the fake Matterport adapter (SPEC §7) and exports the one
// interface. Browser only (SPEC §4.5): import it from client components;
// client-only.test.ts fails on any other importer.
//
// Live needs `NEXT_PUBLIC_MATTERPORT_MODE` (or `HEIST_MODE`) set to `live`
// *and* `NEXT_PUBLIC_MATTERPORT_SDK_KEY`; with the key missing it falls back
// to the fixtures and says so.
//
// The browser sees only `NEXT_PUBLIC_*` variables, so `HEIST_MODE` does not
// reach it on its own. A caller that wants `HEIST_MODE=live` to switch
// Matterport on passes the server's value in (`getMatterport(heistMode)`);
// the mode chip makes the same call (`matterportMode`), so it reports what
// this browser actually loads.
//
// Live, a failed load or a building with no `matterportModelId` gets the
// fixture floor instead of no board (SPEC §2: fake mode is every beat's
// fallback). A failure keeps Matterport on fixtures for the page, and each
// fallback is reported to the mode chip and toasted once.
"use client";

import { isForced, reportFallback, reportLive } from "@/lib/demo-status";
import { fallbackMessage, newFallback, type Fallback } from "@/lib/fallback";
import { missingForLive, serviceModes, type ServiceMode } from "@/lib/mode";
import { createFakeMatterport } from "./fake";
import { createLiveMatterport } from "./live";
import type { MatterportAdapter } from "./types";

export type { MatterportAdapter } from "./types";
export { F1_DEMO } from "./fake";

type Env = Record<string, string | undefined>;

export interface MatterportSelection {
  adapter: MatterportAdapter;
  /** Which implementation was chosen. */
  mode: ServiceMode;
  /** One line saying why, for logs and the mode chip's tooltip. */
  reason: string;
}

export function selectMatterport(env: Env): MatterportSelection {
  if (serviceModes(env).matterport === "fake") {
    return { adapter: createFakeMatterport(), mode: "fake", reason: "Matterport: fixtures (fake mode)" };
  }
  const sdkKey = env.NEXT_PUBLIC_MATTERPORT_SDK_KEY;
  if (!sdkKey || missingForLive("matterport", env).length > 0) {
    return {
      adapter: createFakeMatterport(),
      mode: "fake",
      reason: "Matterport: fixtures (live mode, but NEXT_PUBLIC_MATTERPORT_SDK_KEY not set)",
    };
  }
  return { adapter: createLiveMatterport({ sdkKey }), mode: "live", reason: "Matterport: live" };
}

/**
 * The Matterport variables the browser bundle can read. Each is written out
 * in full so Next.js inlines it at build time.
 */
export function matterportEnv(): Env {
  return {
    NEXT_PUBLIC_MATTERPORT_MODE: process.env.NEXT_PUBLIC_MATTERPORT_MODE,
    NEXT_PUBLIC_MATTERPORT_SDK_KEY: process.env.NEXT_PUBLIC_MATTERPORT_SDK_KEY,
  };
}

/**
 * The fallback for a building with no scan. Its id is the building's, so the
 * browser toasts it once a session however often the board loads.
 */
export function noScanFallback(buildingId: string): Fallback {
  return { service: "matterport", id: `matterport-no-scan-${buildingId}`, message: fallbackMessage("matterport", "no-scan") };
}

/**
 * `live` guarded: a load that throws, or that comes back with no floor, is
 * answered by `fake`'s fixture floor, and `onFallback` hears of it; a
 * building with no scan (no `matterportModelId`) is too, with its own
 * once-per-building fallback (`noScanFallback`). After a failure every load
 * goes to `fake`, so a dead connection costs one timeout, not one per screen.
 * A building with no scan does not stop the next building trying live, and a
 * live floor tells `onLive`, so the chip goes back to live.
 */
export function withFixtureFloor(
  live: MatterportAdapter,
  fake: MatterportAdapter,
  onFallback: (fallback: Fallback) => void,
  onLive: () => void = () => {},
): MatterportAdapter {
  let failed: Fallback | null = null;
  return {
    async loadFloor(building) {
      if (failed) return fake.loadFloor(building);
      if (!building.matterportModelId) {
        onFallback(noScanFallback(building.id));
        return fake.loadFloor(building);
      }
      try {
        const floor = await live.loadFloor(building);
        if (floor) {
          onLive();
          return floor;
        }
        // A building that has a scan, but no floor came back: a failure, not "no scan".
        throw new Error(`no floor for model ${building.matterportModelId}`);
      } catch (error) {
        failed = newFallback("matterport", "failed");
        console.warn(`Matterport: fixtures from now on (live load failed: ${(error as Error)?.message ?? String(error)})`);
        onFallback(failed);
        return fake.loadFloor(building);
      }
    },
  };
}

/** What this browser's Matterport adapter serves by configuration: the mode chip's view of it. */
export function matterportMode(heistMode?: string): ServiceMode {
  return selectMatterport({ HEIST_MODE: heistMode, ...matterportEnv() }).mode;
}

const fake = createFakeMatterport();
let selected: MatterportSelection | undefined;

/**
 * The page's Matterport adapter: the mode is read once, on first use.
 * `heistMode` is the server's `HEIST_MODE`, when the caller has it. Forced to
 * fixtures in the demo settings, it answers from the fixtures.
 */
export function getMatterport(heistMode?: string): MatterportSelection {
  if (isForced("matterport")) {
    return { adapter: fake, mode: "fake", reason: "Matterport: fixtures (forced in demo settings)" };
  }
  if (!selected) {
    const chosen = selectMatterport({ HEIST_MODE: heistMode, ...matterportEnv() });
    selected = chosen.mode === "live" ? { ...chosen, adapter: withFixtureFloor(chosen.adapter, fake, reportFallback, () => reportLive("matterport")) } : chosen;
    console.info(selected.reason);
  }
  return selected;
}
