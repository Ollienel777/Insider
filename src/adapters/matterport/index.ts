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
// fallback is reported to the mode chip and toasted once. The connection is
// bounded (live.ts), so a player that never loads costs one timeout.
//
// For a local live test, `NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE` points a
// building at a model id without committing it (kit terms: no model id from
// the kit enters the repo). It is honoured outside production builds only;
// see `modelOverride`.
"use client";

import { isForced, reportFallback, reportLive } from "@/lib/demo-status";
import { fallbackMessage, newFallback, type Fallback } from "@/lib/fallback";
import { missingForLive, serviceModes, type ServiceMode } from "@/lib/mode";
import { createFakeMatterport } from "./fake";
import { connectInsideView, createLiveMatterport, type InsideView } from "./live";
import type { MatterportAdapter } from "./types";
import type { Building } from "@/domain";

export type { MatterportAdapter } from "./types";
export type { InsideView } from "./live";
export { F1_DEMO } from "./fake";

type Env = Record<string, string | undefined>;

export interface MatterportSelection {
  adapter: MatterportAdapter;
  /** Which implementation was chosen. */
  mode: ServiceMode;
  /** One line saying why, for logs and the mode chip's tooltip. */
  reason: string;
}

/**
 * The dev-only model id override, as building id → model id. The variable
 * holds either a bare model id, which points every building at it, or
 * `buildingId=modelId` pairs separated by commas. Empty in a production build
 * (`NODE_ENV=production`), so `next build` for the demo ignores it.
 */
export function modelOverride(env: Env): { all?: string; byBuilding: Record<string, string> } {
  const byBuilding: Record<string, string> = {};
  const value = env.NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE?.trim();
  if (!value || env.NODE_ENV === "production") return { byBuilding };
  if (!value.includes("=")) return { all: value, byBuilding };
  for (const pair of value.split(",")) {
    const [building, model] = pair.split("=").map((part) => part.trim());
    if (building && model) byBuilding[building] = model;
  }
  return { byBuilding };
}

/** The model id the live adapter loads for `building`: the override's, else the building's own. */
export function scanModelId(building: Pick<Building, "id" | "matterportModelId">, env: Env = matterportEnv()): string | undefined {
  const override = modelOverride(env);
  return (Object.hasOwn(override.byBuilding, building.id) ? override.byBuilding[building.id] : override.all) ?? building.matterportModelId;
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
  const live = createLiveMatterport({ sdkKey });
  const adapter: MatterportAdapter = {
    loadFloor: (building) => live.loadFloor({ ...building, matterportModelId: scanModelId(building, env) }),
  };
  return { adapter, mode: "live", reason: "Matterport: live" };
}

/**
 * The Matterport variables the browser bundle can read. Each is written out
 * in full so Next.js inlines it at build time.
 */
export function matterportEnv(): Env {
  return {
    NEXT_PUBLIC_MATTERPORT_MODE: process.env.NEXT_PUBLIC_MATTERPORT_MODE,
    NEXT_PUBLIC_MATTERPORT_SDK_KEY: process.env.NEXT_PUBLIC_MATTERPORT_SDK_KEY,
    NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE: process.env.NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE,
    NODE_ENV: process.env.NODE_ENV,
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
        throw new Error("no floor came back for the building's scan");
      } catch (error) {
        failed = newFallback("matterport", (error as { name?: string } | null)?.name === "TimeoutError" ? "timeout" : "failed");
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
    const env = { HEIST_MODE: heistMode, ...matterportEnv() };
    const chosen = selectMatterport(env);
    if (chosen.mode === "live") {
      const guarded = withFixtureFloor(chosen.adapter, fake, reportFallback, () => reportLive("matterport"));
      // The override counts as the building's scan, so an overridden fixture building goes live.
      const adapter: MatterportAdapter = {
        loadFloor: (building) => guarded.loadFloor({ ...building, matterportModelId: scanModelId(building, env) }),
      };
      selected = { ...chosen, adapter };
    } else {
      selected = chosen;
    }
    console.info(selected.reason);
  }
  return selected;
}

/**
 * The Inside view for `building`, when this page plays on a live scan of it:
 * opens a visible Showcase player in `parent` (SPEC §4.5: it only moves the
 * camera). Null when Matterport is not live or the building has no scan, so
 * the caller shows no panel; the Run screen also shows it only on a floor
 * that came from the scan.
 */
export function insideViewFor(
  building: Pick<Building, "id" | "matterportModelId">,
  heistMode?: string,
): ((parent: HTMLElement) => Promise<InsideView>) | null {
  if (getMatterport(heistMode).mode !== "live") return null;
  const env = matterportEnv();
  const sdkKey = env.NEXT_PUBLIC_MATTERPORT_SDK_KEY;
  const modelId = scanModelId(building, env);
  if (!sdkKey || !modelId) return null;
  return (parent) => connectInsideView(parent, modelId, sdkKey);
}
