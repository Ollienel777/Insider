// Runs the Level Builder for a CoStar kit building and keeps the level in
// the on-demand store (#93). Apart from `live-levels.ts` so only the build
// route loads the Builder and its agent packages, never a screen.
import { buildLevel, LevelBuildError } from "./builder";
import type { CachedLevel } from "./cache";
import { buildsOnDemand, canBuildFor, levelKey, store } from "./live-levels";
import type { Building } from "@/domain";

export type Build = typeof buildLevel;

/**
 * Builds a kit building's level for `missionId` and keeps it in memory. A
 * second call while one runs waits on the same build; a call after a failure
 * tries again. Throws `LevelBuildError` when the Builder fails.
 */
export function buildKitLevel(
  building: Pick<Building, "id" | "source" | "city">,
  missionId: string,
  build: Build = buildLevel,
): Promise<CachedLevel> {
  if (!buildsOnDemand(building)) {
    return Promise.reject(new Error(`${building.id} is not a kit building; its level is built ahead of the demo`));
  }
  if (!canBuildFor(building, missionId)) {
    return Promise.reject(new Error(`mission ${missionId} is not staged in ${building.city}`));
  }
  const key = levelKey(building.id, missionId);
  const entry = store.get(key);
  if (entry?.status === "built") return Promise.resolve(entry.level);
  if (entry?.status === "building") return entry.promise;

  const promise = build(building.id, missionId).then(
    ({ manifest, trace }) => {
      const level: CachedLevel = { manifest, trace };
      store.set(key, { status: "built", level });
      return level;
    },
    (error: unknown) => {
      const message = error instanceof LevelBuildError || error instanceof Error ? error.message : String(error);
      store.set(key, { status: "failed", error: message });
      throw error;
    },
  );
  store.set(key, { status: "building", promise });
  return promise;
}

