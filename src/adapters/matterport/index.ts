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
// Matterport on passes the server's value in (`getMatterport(heistMode)`).
"use client";

import { serviceModes, type ServiceMode } from "@/lib/mode";
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
  if (!sdkKey) {
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

let selected: MatterportSelection | undefined;

/**
 * The page's Matterport adapter: the mode is read once, on first use.
 * `heistMode` is the server's `HEIST_MODE`, when the caller has it.
 */
export function getMatterport(heistMode?: string): MatterportSelection {
  if (!selected) {
    selected = selectMatterport({ HEIST_MODE: heistMode, ...matterportEnv() });
    console.info(selected.reason);
  }
  return selected;
}
