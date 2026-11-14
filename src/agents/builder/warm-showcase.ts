// Builds the showcase's levels when the server starts (#93), one at a time,
// so a showcase building is playable before anyone opens it and no one waits
// on the Level Builder on stage. Each level lands in the on-demand store, in
// memory; nothing is written to disk. A build that fails is logged, and that
// building's Dossier still offers "Build this level".
import { getCoStar } from "@/adapters/costar";
import { configuredModes } from "@/lib/mode";
import { showcase, type ShowcaseEntry } from "@/lib/showcase";
import type { Building } from "@/domain";
import { buildKitLevel, type Build } from "./build-on-demand";

export interface WarmOptions {
  entries?: ShowcaseEntry[];
  find?: (id: string) => Promise<Building | null>;
  build?: Build;
  /** Whether the model is live; a fake model has no recorded run for a kit building. */
  liveModel?: boolean;
  log?: (line: string) => void;
}

/** Builds every showcase level in turn; resolves with how many were built. */
export async function warmShowcase(options: WarmOptions = {}): Promise<number> {
  const entries = options.entries ?? showcase();
  const log = options.log ?? ((line: string) => console.info(line));
  if (entries.length === 0) return 0;
  if (!(options.liveModel ?? configuredModes(process.env).llm === "live")) {
    log("Showcase: the model is not live, so no showcase level is built ahead");
    return 0;
  }
  const find = options.find ?? ((id: string) => getCoStar().adapter.getBuilding(id));
  let built = 0;
  for (const { buildingId, missionId } of entries) {
    const started = Date.now();
    try {
      const building = await find(buildingId);
      if (!building) {
        log(`Showcase: CoStar has no building ${buildingId}; skipped`);
        continue;
      }
      await buildKitLevel(building, missionId, options.build);
      built += 1;
      log(`Showcase: ${buildingId} (${missionId}) is ready, built in ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (error) {
      log(`Showcase: ${buildingId} (${missionId}) failed to build: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return built;
}
