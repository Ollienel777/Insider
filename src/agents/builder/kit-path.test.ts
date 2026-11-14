// The recorded kit path (#95): the fictional test kit's building, built by
// the Level Builder from its recorded script in fake mode, then placed on the
// stand-in floor the Run gives a kit building with no scan to play. This is
// the path the kit smoke spec walks; here it is checked without a browser.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getCoStar, resetCoStar } from "@/adapters/costar";
import { SMOKE_KIT_BUILDING } from "@/adapters/costar/test-kit";
import { createFakeMatterport } from "@/adapters/matterport/fake";
import { crewContext } from "@/agents/crew/prompt";
import { loadCrewRecording } from "@/agents/crew/recorded";
import { placeLevel } from "@/level/placer";
import { placedFloor, recordLabel } from "@/lib/record-label";
import { buildKitLevel } from "./build-on-demand";
import { LEVELS_DIR } from "./cache";
import { clearKitLevels, levelFor } from "./live-levels";

const MISSION = "romaine-1974";

beforeAll(() => {
  vi.stubEnv("HEIST_MODE", "fake");
  vi.stubEnv("LLM_MODE", "fake");
  vi.stubEnv("COSTAR_MODE", "fake");
  vi.stubEnv("VEXCEL_MODE", "fake");
  vi.stubEnv("HEIST_TEST_KIT", "1");
  vi.spyOn(console, "info").mockImplementation(() => {});
  resetCoStar();
});
afterAll(() => {
  clearKitLevels();
  resetCoStar();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the fictional kit building, end to end in fake mode", () => {
  it("builds from the recorded script, from its own record, into memory only", async () => {
    const before = readdirSync(LEVELS_DIR);
    const building = (await getCoStar().adapter.getBuilding(SMOKE_KIT_BUILDING))!;
    expect(building.source).toBe("costar");

    const { manifest, trace } = await buildKitLevel(building, MISSION);
    expect(manifest.buildingId).toBe(SMOKE_KIT_BUILDING);
    expect(trace.model).toContain("builder-900101-romaine-1974");
    expect(manifest.securityProfile).toMatchObject({ era: "analog", guardCount: 3 });
    // The rules cite the kit record's own fields and values.
    const costar = manifest.provenance.filter((p) => p.layer === "costar");
    expect(costar).toContainEqual(expect.objectContaining({ field: "yearBuilt", value: 1968 }));
    expect(costar).toContainEqual(expect.objectContaining({ field: "buildingClass", value: "B" }));
    expect(costar.find((p) => p.field === "availableSpace")?.value).toMatch(/^floor 6: /);

    expect(await levelFor(building, MISSION)).toMatchObject({ manifest: { buildingId: SMOKE_KIT_BUILDING } });
    // Nothing derived from a kit record reaches the disk.
    expect(readdirSync(LEVELS_DIR)).toEqual(before);
    expect(existsSync(path.join(LEVELS_DIR, `${SMOKE_KIT_BUILDING}.${MISSION}.json`))).toBe(false);
  });

  it("places on the stand-in floor, labelled as a stand-in, with its three guards", async () => {
    const building = (await getCoStar().adapter.getBuilding(SMOKE_KIT_BUILDING))!;
    const level = (await levelFor(building, MISSION))!;
    const floor = (await createFakeMatterport().loadFloor(building))!;
    expect(floor.source).toBe("fixture");
    const placed = placeLevel(level.manifest, floor, 7);
    expect(placed.guards).toHaveLength(3);
    expect(placed.entries.length).toBeGreaterThan(0);
    expect(recordLabel(building.source, placedFloor(floor.source))).toBe("Real CoStar record · stand-in floor plan");
  });

  it("has a recorded crew reply naming only its level's zones, so the smoke can brief the crew", async () => {
    const building = (await getCoStar().adapter.getBuilding(SMOKE_KIT_BUILDING))!;
    const level = (await levelFor(building, MISSION))!;
    const ids = new Set(crewContext(level.manifest).zones.map((z) => z.id));
    const recording = (await loadCrewRecording(SMOKE_KIT_BUILDING))!;
    for (const reply of recording.replies) {
      for (const step of reply.plan.steps) expect(ids.has(step.zoneId), `${reply.id}: ${step.zoneId}`).toBe(true);
    }
  });
});
