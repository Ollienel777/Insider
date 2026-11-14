// Runs the Level Builder for a CoStar kit building and keeps the level in
// the on-demand store (#93). Apart from `live-levels.ts` so only the build
// route loads the Builder and its agent packages, never a screen.
//
// A build is a live deep-agent run that costs model calls, and the build
// route is reachable by anyone on the demo server's network. So a build has a
// deadline, at most `MAX_BUILDS` run at once, and a level that just failed
// waits `RETRY_AFTER_MS` before it is tried again. What a failed build says is
// a fixed line per kind of failure, never the raw error (which can carry a
// manifest's values or a provider's message); the raw error goes to the log.
import { ZodError } from "zod";
import { safeErrorMessage } from "@/adapters/llm";
import { buildLevel, LevelBuildError, type BuildOptions } from "./builder";
import type { CachedLevel } from "./cache";
import { buildsOnDemand, canBuildFor, levelKey, store } from "./live-levels";
import type { Building } from "@/domain";

export type Build = (buildingId: string, missionId: string, options?: BuildOptions) => ReturnType<typeof buildLevel>;

/** How long one build may run before it is stopped and marked failed. A live build takes about 2.5 min. */
export const BUILD_DEADLINE_MS = 240_000;
/** How many builds may run at once, across every building and mission. */
export const MAX_BUILDS = 2;
/** How long a level that failed waits before it may be built again. */
export const RETRY_AFTER_MS = 30_000;

/** A build refused before it started: too many running, or a failed level tried again too soon. */
export class BuildRefused extends Error {
  constructor(
    message: string,
    /** Seconds until a retry may succeed. */
    readonly retryAfterS: number,
  ) {
    super(message);
    this.name = "BuildRefused";
  }
}

/** A build stopped at its deadline. */
class BuildTimedOut extends Error {}

/** What a failed build says on screen: a fixed line by kind, never the raw error. */
export function publicBuildError(error: unknown): string {
  if (error instanceof BuildTimedOut) return `the Level Builder ran past ${BUILD_DEADLINE_MS / 60_000} minutes and was stopped`;
  if (error instanceof ZodError) return "the Level Builder's level failed its schema check";
  if (error instanceof LevelBuildError) return "the Level Builder's model run failed before it wrote a level";
  return "the Level Builder failed";
}

export interface BuildKitOptions {
  build?: Build;
  deadlineMs?: number;
  now?: () => number;
  /** Skip the cap on builds at once: the showcase warm at server start, which builds one at a time. */
  uncapped?: boolean;
}

/**
 * Builds a kit building's level for `missionId` and keeps it in memory. A
 * second call while one runs waits on the same build; a call after a failure
 * tries again once `RETRY_AFTER_MS` has passed. Rejects with `BuildRefused`
 * when the build can't start now, and otherwise with the build's own error
 * (its screen line is `publicBuildError`).
 */
export function buildKitLevel(
  building: Pick<Building, "id" | "source" | "city">,
  missionId: string,
  options: BuildKitOptions = {},
): Promise<CachedLevel> {
  const { build = buildLevel, deadlineMs = BUILD_DEADLINE_MS, now = Date.now, uncapped = false } = options;
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
  if (entry?.status === "failed" && now() - entry.at < RETRY_AFTER_MS) {
    const wait = Math.ceil((RETRY_AFTER_MS - (now() - entry.at)) / 1000);
    return Promise.reject(new BuildRefused(`${entry.error}. Try again in ${wait} s`, wait));
  }
  const running = [...store.values()].filter((e) => e.status === "building").length;
  if (!uncapped && running >= MAX_BUILDS) {
    return Promise.reject(new BuildRefused(`${running} levels are already building; try again in a minute`, 60));
  }

  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop.abort();
      reject(new BuildTimedOut(`the build of ${key} ran past ${deadlineMs} ms`));
    }, deadlineMs);
  });
  // Through a `then`, so a build that throws at once still ends the race (and clears the timer).
  const run = Promise.resolve().then(() => build(building.id, missionId, { signal: stop.signal }));
  const promise = Promise.race([run, deadline])
    .then(
      ({ manifest, trace }) => {
        const level: CachedLevel = { manifest, trace };
        store.set(key, { status: "built", level });
        return level;
      },
      (error: unknown) => {
        console.error(`[level] on-demand build of ${key} failed: ${safeErrorMessage(error)}`);
        store.set(key, { status: "failed", error: publicBuildError(error), at: now() });
        throw error;
      },
    )
    .finally(() => clearTimeout(timer));
  store.set(key, { status: "building", promise });
  return promise;
}
