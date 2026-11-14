import { existsSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import type { Building } from "@/domain";
import { ZodError } from "zod";
import { BuildRefused, buildKitLevel, MAX_BUILDS, publicBuildError, RETRY_AFTER_MS, type Build } from "./build-on-demand";
import { LevelBuildError } from "./builder";
import { LEVELS_DIR, readCachedLevel } from "./cache";
import { buildState, builtMissions, buildsOnDemand, clearKitLevels, levelFor, readLevel } from "./live-levels";

const f1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
// A fictional kit building: F1's fields under a kit-style id.
const kit: Building = { ...f1, id: "900001", name: "Testwood Tower", source: "costar" };

// A build that returns F1's committed level, relabelled for the kit building, as the Builder would.
async function fakeBuild(buildingId: string, missionId: string) {
  const level = (await readCachedLevel("F1", missionId))!;
  return {
    manifest: { ...level.manifest, buildingId },
    trace: { ...level.trace, buildingId },
    summary: "",
    turns: [],
  };
}

afterEach(() => {
  clearKitLevels();
  vi.restoreAllMocks();
});

describe("on-demand levels for kit buildings (#93)", () => {
  it("builds only kit buildings, never a fixture", async () => {
    expect(buildsOnDemand(kit)).toBe(true);
    expect(buildsOnDemand(f1)).toBe(false);
    // A fixture id is a fixture even if it is marked as a kit record.
    expect(buildsOnDemand({ id: "F1", source: "costar" })).toBe(false);
    await expect(buildKitLevel(f1, "romaine-1974", { build: fakeBuild as Build })).rejects.toThrow(/not a kit building/);
  });

  it("refuses a mission that is not staged in the building's city", async () => {
    await expect(buildKitLevel(kit, "paper-trail-2001", { build: fakeBuild as Build })).rejects.toThrow(/not staged/);
  });

  it("has no level for a kit building until it is built, then serves it from memory", async () => {
    expect(await levelFor(kit, "romaine-1974")).toBeNull();
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "none" });

    await buildKitLevel(kit, "romaine-1974", { build: fakeBuild as Build });

    const level = await levelFor(kit, "romaine-1974");
    expect(level?.manifest.buildingId).toBe(kit.id);
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "built" });
    expect(builtMissions(kit.id)).toEqual(["romaine-1974"]);
    // Another mission of the same building is still unbuilt.
    expect(await levelFor(kit, "sunset-1986")).toBeNull();
  });

  it("writes nothing to disk", async () => {
    const before = readdirSync(LEVELS_DIR).sort();
    await buildKitLevel(kit, "romaine-1974", { build: fakeBuild as Build });
    expect(readdirSync(LEVELS_DIR).sort()).toEqual(before);
    expect(existsSync(`${LEVELS_DIR}/${kit.id}.romaine-1974.json`)).toBe(false);
  });

  it("runs the Builder once for two requests at the same time", async () => {
    const build = vi.fn(fakeBuild);
    await Promise.all([buildKitLevel(kit, "romaine-1974", { build: build as Build }), buildKitLevel(kit, "romaine-1974", { build: build as Build })]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("records a failed build by kind, never its raw error, and tries again once the wait is over", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let clock = 1_000_000;
    const now = () => clock;
    const failing = vi.fn(async () => {
      throw new Error("provider said: key sk-secret rejected");
    });
    await expect(buildKitLevel(kit, "romaine-1974", { build: failing as unknown as Build, now })).rejects.toThrow("sk-secret");
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "failed", error: "the Level Builder failed" });
    expect(await levelFor(kit, "romaine-1974")).toBeNull();

    // Straight away, the same level is refused: a failed key does not retry in a loop (#97 M4).
    await expect(buildKitLevel(kit, "romaine-1974", { build: fakeBuild as Build, now })).rejects.toBeInstanceOf(BuildRefused);
    clock += RETRY_AFTER_MS;
    await buildKitLevel(kit, "romaine-1974", { build: fakeBuild as Build, now });
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "built" });
  });

  it("says what kind of failure a build was, without the manifest or the model's words (#97 M2)", () => {
    expect(publicBuildError(new ZodError([]))).toBe("the Level Builder's level failed its schema check");
    expect(publicBuildError(new LevelBuildError("model said: secret", { buildingId: "x" } as never))).toMatch(/model run failed/);
    expect(publicBuildError(new Error("anything"))).toBe("the Level Builder failed");
  });

  it("stops a build at its deadline, aborts the model run, and marks it failed (#97 M3)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    const stalled = vi.fn((_id: string, _m: string, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise<never>(() => {});
    });
    await expect(buildKitLevel(kit, "romaine-1974", { build: stalled as unknown as Build, deadlineMs: 20 })).rejects.toThrow(/ran past/);
    expect(signal?.aborted).toBe(true);
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "failed", error: expect.stringMatching(/ran past 4 minutes/) });
  });

  it("runs at most MAX_BUILDS builds at once, and refuses another until one ends (#97 M4)", async () => {
    const release: (() => void)[] = [];
    const slow = vi.fn(async (buildingId: string, missionId: string) => {
      await new Promise<void>((resolve) => release.push(resolve));
      return fakeBuild(buildingId, missionId);
    });
    const ids = ["900001", "900002", "900003"];
    const running = ids.slice(0, MAX_BUILDS).map((id) => buildKitLevel({ ...kit, id }, "romaine-1974", { build: slow as Build }));
    await expect(buildKitLevel({ ...kit, id: ids[MAX_BUILDS] }, "romaine-1974", { build: slow as Build })).rejects.toBeInstanceOf(BuildRefused);
    // A second request for a level already building joins it, and is not refused.
    const joined = buildKitLevel({ ...kit, id: ids[0] }, "romaine-1974", { build: slow as Build });
    await vi.waitFor(() => expect(release).toHaveLength(MAX_BUILDS));
    release.forEach((go) => go());
    await Promise.all([...running, joined]);
    expect(slow).toHaveBeenCalledTimes(MAX_BUILDS);
    await buildKitLevel({ ...kit, id: ids[MAX_BUILDS] }, "romaine-1974", { build: fakeBuild as Build });
  });

  it("serves a built level by id, for the Crew and the Chief, and a fixture's from disk", async () => {
    expect(await readLevel(kit.id, "romaine-1974")).toBeNull();
    await buildKitLevel(kit, "romaine-1974", { build: fakeBuild as Build });
    expect((await readLevel(kit.id, "romaine-1974"))?.manifest.buildingId).toBe(kit.id);
    expect((await readLevel("F1", "romaine-1974"))?.manifest.buildingId).toBe("F1");
  });

  it("still reads a fixture building's committed level", async () => {
    expect((await levelFor(f1, "romaine-1974"))?.manifest.buildingId).toBe("F1");
  });
});
