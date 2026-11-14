import { afterEach, describe, expect, it, vi } from "vitest";
import { onlyShowcase } from "@/adapters/costar";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import { buildState, clearKitLevels } from "@/agents/builder/live-levels";
import { warmShowcase } from "@/agents/builder/warm-showcase";
import { readCachedLevel } from "@/agents/builder/cache";
import type { CoStarAdapter } from "@/adapters/costar/types";
import type { Building } from "@/domain";
import { parseShowcase, showcaseIds, showcaseMission } from "./showcase";

const f1 = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
// Fictional kit buildings: F1's fields under kit-style ids.
const kitA: Building = { ...f1, id: "900001", name: "Testwood Tower", source: "costar" };
const kitB: Building = { ...f1, id: "900002", name: "Sample Lofts", source: "costar" };

async function fakeBuild(buildingId: string, missionId: string) {
  const level = (await readCachedLevel("F1", missionId))!;
  return { manifest: { ...level.manifest, buildingId }, trace: { ...level.trace, buildingId }, summary: "", turns: [] };
}

afterEach(() => clearKitLevels());

describe("SHOWCASE_LEVELS (#93)", () => {
  it("reads building:mission pairs, and skips a malformed one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseShowcase(" 900001:romaine-1974 , bad, 900002:sunset-1986:x, ../x:romaine-1974,900002:sunset-1986")).toEqual([
      { buildingId: "900001", missionId: "romaine-1974" },
      { buildingId: "900002", missionId: "sunset-1986" },
    ]);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("has no list, so every kit building shows, when it is unset", () => {
    expect(showcaseIds({})).toBeNull();
    expect(showcaseMission("900001", {})).toBeNull();
    expect(showcaseMission("900001", { SHOWCASE_LEVELS: "900001:romaine-1974" })).toBe("romaine-1974");
  });

  it("shows only the showcase's kit buildings, by list and by id", async () => {
    const live: CoStarAdapter = {
      listBuildings: async () => [kitA, kitB],
      getBuilding: async (id) => [kitA, kitB].find((b) => b.id === id) ?? null,
      getAvailableSpace: async (id) => ([kitA, kitB].find((b) => b.id === id) ? [] : null),
      searchInventory: async () => ({ properties: [], source: "fixture" }) as never,
    };
    const shown = onlyShowcase(live, new Set(["900001"]));
    expect((await shown.listBuildings("LA")).map((b) => b.id)).toEqual(["900001"]);
    expect(await shown.getBuilding("900002")).toBeNull();
    expect(await shown.getAvailableSpace("900002")).toBeNull();
    expect((await shown.getBuilding("900001"))?.id).toBe("900001");
    expect(onlyShowcase(live, null)).toBe(live);
  });

  it("builds each showcase level when the server starts, and carries on past a failure", async () => {
    const log: string[] = [];
    const built = await warmShowcase({
      entries: [
        { buildingId: "900001", missionId: "romaine-1974" },
        { buildingId: "999999", missionId: "romaine-1974" },
        { buildingId: "900002", missionId: "romaine-1974" },
      ],
      find: async (id) => [kitA, kitB].find((b) => b.id === id) ?? null,
      build: fakeBuild as never,
      liveModel: true,
      log: (line) => log.push(line),
    });
    expect(built).toBe(2);
    expect(buildState("900001", "romaine-1974")).toEqual({ status: "built" });
    expect(buildState("900002", "romaine-1974")).toEqual({ status: "built" });
    expect(log.some((l) => l.includes("999999") && l.includes("skipped"))).toBe(true);
  });

  it("builds nothing ahead when the model is not live", async () => {
    const build = vi.fn(fakeBuild);
    const built = await warmShowcase({
      entries: [{ buildingId: "900001", missionId: "romaine-1974" }],
      find: async () => kitA,
      build: build as never,
      liveModel: false,
      log: () => {},
    });
    expect(built).toBe(0);
    expect(build).not.toHaveBeenCalled();
  });
});
