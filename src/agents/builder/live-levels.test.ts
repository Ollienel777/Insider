import { existsSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import type { Building } from "@/domain";
import { buildKitLevel, type Build } from "./build-on-demand";
import { LEVELS_DIR, readCachedLevel } from "./cache";
import { buildState, builtMissions, buildsOnDemand, clearKitLevels, levelFor } from "./live-levels";

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

afterEach(() => clearKitLevels());

describe("on-demand levels for kit buildings (#93)", () => {
  it("builds only kit buildings, never a fixture", async () => {
    expect(buildsOnDemand(kit)).toBe(true);
    expect(buildsOnDemand(f1)).toBe(false);
    // A fixture id is a fixture even if it is marked as a kit record.
    expect(buildsOnDemand({ id: "F1", source: "costar" })).toBe(false);
    await expect(buildKitLevel(f1, "romaine-1974", fakeBuild as Build)).rejects.toThrow(/not a kit building/);
  });

  it("refuses a mission that is not staged in the building's city", async () => {
    await expect(buildKitLevel(kit, "paper-trail-2001", fakeBuild as Build)).rejects.toThrow(/not staged/);
  });

  it("has no level for a kit building until it is built, then serves it from memory", async () => {
    expect(await levelFor(kit, "romaine-1974")).toBeNull();
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "none" });

    await buildKitLevel(kit, "romaine-1974", fakeBuild as Build);

    const level = await levelFor(kit, "romaine-1974");
    expect(level?.manifest.buildingId).toBe(kit.id);
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "built" });
    expect(builtMissions(kit.id)).toEqual(["romaine-1974"]);
    // Another mission of the same building is still unbuilt.
    expect(await levelFor(kit, "sunset-1986")).toBeNull();
  });

  it("writes nothing to disk", async () => {
    const before = readdirSync(LEVELS_DIR).sort();
    await buildKitLevel(kit, "romaine-1974", fakeBuild as Build);
    expect(readdirSync(LEVELS_DIR).sort()).toEqual(before);
    expect(existsSync(`${LEVELS_DIR}/${kit.id}.romaine-1974.json`)).toBe(false);
  });

  it("runs the Builder once for two requests at the same time", async () => {
    const build = vi.fn(fakeBuild);
    await Promise.all([buildKitLevel(kit, "romaine-1974", build as Build), buildKitLevel(kit, "romaine-1974", build as Build)]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("records a failed build with what failed, and tries again on the next request", async () => {
    const failing = vi.fn(async () => {
      throw new Error("the model timed out");
    });
    await expect(buildKitLevel(kit, "romaine-1974", failing as unknown as Build)).rejects.toThrow("the model timed out");
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "failed", error: "the model timed out" });
    expect(await levelFor(kit, "romaine-1974")).toBeNull();

    await buildKitLevel(kit, "romaine-1974", fakeBuild as Build);
    expect(buildState(kit.id, "romaine-1974")).toEqual({ status: "built" });
  });

  it("still reads a fixture building's committed level", async () => {
    expect((await levelFor(f1, "romaine-1974"))?.manifest.buildingId).toBe("F1");
  });
});
